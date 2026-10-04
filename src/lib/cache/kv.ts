// Cache adapter: uses Upstash Redis when env vars are set, in-memory Map otherwise
// Tests and local dev without Upstash get the in-memory fallback

import { Redis } from '@upstash/redis'

/** The subset of the Upstash client this module uses (lets tests inject a fake). */
export interface KvClient {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, opts: { ex: number; nx?: boolean }): Promise<unknown>
  del(...keys: string[]): Promise<unknown>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
}

let redisClient: KvClient | null = null
/** undefined = no override; null = force in-memory; client = use it. Tests only. */
let clientOverride: KvClient | null | undefined

/** Per-call Redis budget: one attempt + one quick retry must finish inside this. */
export const REDIS_CALL_TIMEOUT_MS = 1000
/** After REDIS_DOWN_AFTER_FAILURES consecutive failures, skip Redis entirely for this long. */
export const REDIS_DOWN_COOLDOWN_MS = 5_000
/** One slow call is a latency blip, not an outage: only this many failures in a row mark Redis down. */
export const REDIS_DOWN_AFTER_FAILURES = 3
/** In-process copy of recently read/written envelopes, served while Redis errors or is marked down. */
export const LRU_MAX_ENTRIES = 500

let redisDownUntil = 0
let consecutiveFailures = 0
let failClosedLogged = false
let missingKvLogged = false
let callTimeoutMs = REDIS_CALL_TIMEOUT_MS
let downCooldownMs = REDIS_DOWN_COOLDOWN_MS

/**
 * Batch jobs (scripts/refresh-cache.ts) are not latency-sensitive: they use a
 * longer per-call timeout and no cool-down, so slow writes never skip the
 * following writes. Runtime code never calls this.
 */
export function configureRedisTimeouts(opts: { callTimeoutMs?: number; downCooldownMs?: number }): void {
  if (opts.callTimeoutMs !== undefined) callTimeoutMs = opts.callTimeoutMs
  if (opts.downCooldownMs !== undefined) downCooldownMs = opts.downCooldownMs
}

const kvEnvPresent = () => !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN

/** Deployed (Vercel) or `next start`: a missing Redis is a misconfiguration, not local dev. */
export function isProductionRuntime(): boolean {
  return !!process.env.VERCEL || process.env.NODE_ENV === 'production'
}

function getRedis(): KvClient | null {
  if (clientOverride !== undefined) return clientOverride
  if (process.env.NODE_ENV === 'test' || !kvEnvPresent()) {
    return null
  }
  if (!redisClient) {
    redisClient = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN!,
      // Default is 5 retries with exponential backoff (~4s per call during an
      // outage). One fast retry, and every request aborted after ~1s.
      retry: { retries: 1, backoff: () => 50 },
      signal: () => AbortSignal.timeout(callTimeoutMs),
    }) as unknown as KvClient
  }
  return redisClient
}

export class RedisUnavailableError extends Error {
  constructor(reason: string) {
    super(`Redis unavailable: ${reason}`)
    this.name = 'RedisUnavailableError'
  }
}

/** true while recent consecutive Redis failures have put the client in its cool-down window. */
export function isRedisMarkedDown(now: number = Date.now()): boolean {
  return now < redisDownUntil
}

/**
 * Run one Redis command with a hard timeout. REDIS_DOWN_AFTER_FAILURES
 * consecutive failures mark Redis down for REDIS_DOWN_COOLDOWN_MS; while down,
 * calls throw immediately without touching the network, so an outage costs
 * ~1s per call only until the breaker trips. Every failure (reads and writes) counts; only a
 * successful read resets the count — a write that succeeds while reads keep timing out (e.g. the
 * SET after a cache-miss fetch) must not keep the breaker from tripping.
 */
async function redisCall<T>(redis: KvClient, op: (r: KvClient) => Promise<T>, kind: 'read' | 'write' = 'write'): Promise<T> {
  if (isRedisMarkedDown()) throw new RedisUnavailableError('cooling down after a recent failure')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RedisUnavailableError(`timed out after ${callTimeoutMs}ms`)), callTimeoutMs)
  })
  try {
    const result = await Promise.race([op(redis), timeout])
    if (kind === 'read') consecutiveFailures = 0
    return result
  } catch (e) {
    consecutiveFailures++
    if (downCooldownMs > 0 && consecutiveFailures >= REDIS_DOWN_AFTER_FAILURES) {
      if (!isRedisMarkedDown()) {
        console.error(
          `Redis failed ${consecutiveFailures}x in a row; skipping Redis for ${downCooldownMs / 1000}s:`,
          e instanceof Error ? e.message : e
        )
      }
      redisDownUntil = Date.now() + downCooldownMs
    }
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Test hook: inject a KV client (e.g. one that throws, to simulate a Redis outage). Pass undefined to reset. */
export function __setKvClientForTests(client: KvClient | null | undefined): void {
  clientOverride = client
  redisDownUntil = 0
  consecutiveFailures = 0
  lru.clear()
}

/** Test hook: clear the "Redis down" cool-down and the missing-KV log latch. */
export function __resetRedisHealthForTests(): void {
  redisDownUntil = 0
  consecutiveFailures = 0
  missingKvLogged = false
  failClosedLogged = false
  lru.clear()
  callTimeoutMs = REDIS_CALL_TIMEOUT_MS
  downCooldownMs = REDIS_DOWN_COOLDOWN_MS
}

/** true when values are stored in Upstash Redis (not the in-memory fallback). */
export function isRedisConfigured(): boolean {
  return getRedis() !== null
}

// In-memory fallback for test/local dev without Redis
const memCache = new Map<string, { value: unknown; expiresAt: number }>()

// In-process stampede protection: concurrent callers for the same key share one fetch.
const inflight = new Map<string, Promise<CachedResult<unknown>>>()

// In-process LRU of envelopes this instance read from / wrote to Redis
// (Redis mode only). Not a second cache tier: it is consulted only when a
// Redis call errors or Redis is marked down, so a Redis blip or outage keeps
// serving recently seen data instead of falling through to upstream.
// Map preserves insertion order; re-inserting on access makes it an LRU.
const lru = new Map<string, { env: CacheEnvelope<unknown>; expiresAt: number }>()

function lruPut(key: string, env: CacheEnvelope<unknown>, expiresAt: number): void {
  if (!(expiresAt > Date.now())) return
  lru.delete(key)
  lru.set(key, { env, expiresAt })
  while (lru.size > LRU_MAX_ENTRIES) lru.delete(lru.keys().next().value as string)
}

function lruGet<T>(key: string): CacheEnvelope<T> | null {
  const hit = lru.get(key)
  if (!hit) return null
  lru.delete(key)
  if (Date.now() > hit.expiresAt) return null
  lru.set(key, hit)
  return hit.env as CacheEnvelope<T>
}

/** Expiry of an envelope stored with `ttlSeconds` (TTLs are set at write time ≈ fetchedAt). */
const envelopeExpiry = (env: CacheEnvelope<unknown>, ttlSeconds: number) => Date.parse(env.fetchedAt) + ttlSeconds * 1000

export async function getCached<T>(key: string): Promise<T | null> {
  const redis = getRedis()
  if (redis) {
    const val = await redisCall(redis, (r) => r.get<T>(key), 'read')
    return val ?? null
  }
  const entry = memCache.get(key)
  if (!entry || Date.now() > entry.expiresAt) return null
  return entry.value as T
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const redis = getRedis()
  if (redis) {
    await redisCall(redis, (r) => r.set(key, value, { ex: Math.max(1, Math.round(ttlSeconds)) }))
    return
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

export async function deleteCached(key: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    await redisCall(redis, (r) => r.del(key))
    return
  }
  memCache.delete(key)
}

export function clearMemCache() {
  memCache.clear()
  inflight.clear()
  lru.clear()
  consecutiveFailures = 0
  breakerLog.bls.length = 0
  breakerLog.eia.length = 0
  redisDownUntil = 0
}

// --- Envelope format -------------------------------------------------------
//
// Values written by getCachedOrFetch are wrapped in an envelope that records
// when the upstream data was actually fetched. Entries without the envelope
// (written by older code or by ad-hoc scripts) are treated as cache misses.

export const CACHE_SCHEMA_VERSION = 2

export interface CacheEnvelope<T> {
  __v: number
  fetchedAt: string // ISO timestamp of the upstream fetch
  data: T
}

function isEnvelope<T>(value: unknown): value is CacheEnvelope<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as CacheEnvelope<T>).__v === CACHE_SCHEMA_VERSION &&
    typeof (value as CacheEnvelope<T>).fetchedAt === 'string' &&
    'data' in (value as object)
  )
}

/**
 * Runtime TTLs. The refresh-cache GitHub Action (scripts/refresh-cache.ts)
 * rewrites every key weekly plus after each BLS release, so these are set
 * LONGER than the refresh interval: keys never expire between refreshes, and
 * a user request should essentially never miss.
 */
export const TTL_BLS = 60 * 60 * 24 * 21 // 21 days
export const TTL_EIA = 60 * 60 * 24 * 10 // 10 days
/** Last-good copies outlive several missed refreshes. */
export const LAST_GOOD_TTL = 60 * 60 * 24 * 45 // 45 days
export const lastGoodKey = (key: string) => `${key}:lastgood`
export const failedKey = (key: string) => `${key}:failed`
/**
 * Written by scripts/refresh-cache.ts when upstream has no usable data for a
 * key (series not published, or fails sanity checks). The runtime honors it
 * and does not spend upstream budget re-fetching; the next successful write
 * (writeEnvelope) clears it.
 */
export const missingKey = (key: string) => `${key}:missing`
export const MISSING_TTL = TTL_BLS

/** Read an envelope (if present and well-formed) without fetching. */
export async function getCachedEnvelope<T>(key: string): Promise<CacheEnvelope<T> | null> {
  const raw = await getCached<unknown>(key)
  return isEnvelope<T>(raw) ? raw : null
}

export interface CachedResult<T> {
  data: T
  cacheHit: boolean
  /** When the upstream data was fetched (not when this request ran). */
  fetchedAt: string
  /** true when serving a last-good copy because the live fetch failed. */
  stale: boolean
}

export interface CacheOptions<T> {
  /** Seconds to remember a failed fetch before retrying (default 300). */
  negativeTtl?: number
  /** Return false to reject a value (cached or freshly fetched). */
  validate?: (data: T) => boolean
  /** Skip the cache read and always fetch. */
  forceRefresh?: boolean
  /** Charge the upstream fetch to this source's daily budget / circuit breaker. */
  budget?: UpstreamSource
}

export class ValidationError extends Error {
  constructor(key: string) {
    super(`Fetched data for ${key} failed validation`)
    this.name = 'ValidationError'
  }
}

/**
 * Store freshly fetched, already-validated data exactly as getCachedOrFetch
 * does: envelope under `key` (ttlSeconds) and `key:lastgood` (LAST_GOOD_TTL),
 * and clear any negative-cache entry. Shared by the runtime read-through path
 * and scripts/refresh-cache.ts so both produce identical keys and envelopes.
 */
export async function writeEnvelope<T>(
  key: string,
  data: T,
  ttlSeconds: number,
  fetchedAt: string = new Date().toISOString()
): Promise<CacheEnvelope<T>> {
  const envelope: CacheEnvelope<T> = { __v: CACHE_SCHEMA_VERSION, fetchedAt, data }
  if (getRedis()) {
    lruPut(key, envelope, envelopeExpiry(envelope, ttlSeconds))
    lruPut(lastGoodKey(key), envelope, envelopeExpiry(envelope, LAST_GOOD_TTL))
  }
  await Promise.all([
    setCached(key, envelope, ttlSeconds),
    setCached(lastGoodKey(key), envelope, LAST_GOOD_TTL),
    deleteCached(failedKey(key)),
    deleteCached(missingKey(key)),
  ])
  return envelope
}

// --- Upstream budget ---------------------------------------------------------
//
// All data is preloaded by scripts/refresh-cache.ts, so a runtime cache miss
// should be rare. Misses may still fetch upstream, but only within a GLOBAL
// daily budget (Redis INCR, shared by every serverless instance) so a crawler
// hitting thousands of uncached areas cannot drain the BLS 500/day key quota
// the refresh job needs. If Redis itself is unreachable: in production BLS
// fails closed (no runtime BLS calls; last-good / in-process copies or "Data
// unavailable"), while EIA and local dev use a per-instance hourly breaker.

/** 'nyserda' = data.ny.gov (keyless; its own small budget so it never spends EIA's). */
export type UpstreamSource = 'bls' | 'eia' | 'nyserda'

/** Positive integer from env; unset, empty, zero, negative or malformed → fallback. */
const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const v = Number(raw)
  return Number.isInteger(v) && v > 0 ? v : fallback
}

/** Max runtime (non-refresh) upstream calls per UTC day, across all instances. */
export function dailyBudget(source: UpstreamSource): number {
  if (source === 'nyserda') return envInt('NYSERDA_RUNTIME_DAILY_BUDGET', 50)
  return source === 'bls' ? envInt('BLS_RUNTIME_DAILY_BUDGET', 60) : envInt('EIA_RUNTIME_DAILY_BUDGET', 300)
}

/** Max upstream calls per instance per hour when the Redis budget counter is unreachable. */
export function breakerPerHour(source: UpstreamSource): number {
  return source === 'bls' ? 5 : source === 'nyserda' ? 5 : 20
}

export const budgetKey = (source: UpstreamSource, now: Date = new Date()) =>
  `budget:${source}:${now.toISOString().slice(0, 10)}`

const breakerLog: Record<UpstreamSource, number[]> = { bls: [], eia: [], nyserda: [] }

function breakerAllows(source: UpstreamSource, now: number): boolean {
  const log = breakerLog[source]
  while (log.length && now - log[0] > 3600_000) log.shift()
  if (log.length >= breakerPerHour(source)) return false
  log.push(now)
  return true
}

/**
 * Reserve one upstream call for `source`. true → caller may fetch.
 * Uses the shared Redis day counter; falls back to the in-process breaker
 * when Redis errors. In-memory mode (tests/local dev) counts in memCache.
 */
export async function tryAcquireUpstream(source: UpstreamSource, now: Date = new Date()): Promise<boolean> {
  const key = budgetKey(source, now)
  const cap = dailyBudget(source)
  const redis = getRedis()
  if (redis) {
    try {
      // Create the counter with its TTL atomically (SET NX EX), then INCR, so
      // a failure between the two can never leave a counter without expiry.
      await redisCall(redis, (r) => r.set(key, 0, { ex: 2 * 86400, nx: true }))
      const n = await redisCall(redis, (r) => r.incr(key))
      return n <= cap
    } catch (e) {
      if (!(e instanceof RedisUnavailableError)) {
        console.error(`KV budget counter unavailable (${key}):`, e instanceof Error ? e.message : e)
      }
      // The shared counter is the only thing that keeps N instances inside the
      // BLS 500/day key quota; never spend it blind in production.
      if (source === 'bls' && isProductionRuntime()) {
        if (!failClosedLogged) {
          failClosedLogged = true
          console.error('Redis unreachable in production: runtime BLS fetches disabled until it recovers (fail closed)')
        }
        return false
      }
      return breakerAllows(source, now.getTime())
    }
  }
  // Production without KV_* env: the in-memory counter is per instance and
  // would let every cold start spend BLS quota. Fail closed for BLS.
  if (clientOverride === undefined && isProductionRuntime() && !kvEnvPresent()) {
    if (!missingKvLogged) {
      missingKvLogged = true
      console.error('KV_REST_API_URL/KV_REST_API_TOKEN missing in production: runtime BLS fetches disabled (fail closed)')
    }
    if (source === 'bls') return false
  }
  const entry = memCache.get(key)
  const n = (entry && Date.now() <= entry.expiresAt ? (entry.value as number) : 0) + 1
  memCache.set(key, { value: n, expiresAt: Date.now() + 2 * 86400_000 })
  return n <= cap
}

/** Redis cool-down skips are expected during an outage (already logged once by redisCall). */
function logKvError(msg: string, e: unknown): void {
  if (e instanceof RedisUnavailableError) return
  console.error(`${msg}:`, e)
}

export class BudgetExceededError extends Error {
  constructor(key: string, source: UpstreamSource) {
    super(`Upstream ${source} budget exhausted; not fetching ${key}`)
    this.name = 'BudgetExceededError'
  }
}

async function readLastGood<T>(key: string, validate?: (data: T) => boolean): Promise<CachedResult<T> | null> {
  const ok = (env: CacheEnvelope<T> | null) => !!env && (!validate || validate(env.data))
  try {
    const env = await getCachedEnvelope<T>(lastGoodKey(key))
    if (env && ok(env)) {
      if (getRedis()) lruPut(lastGoodKey(key), env, envelopeExpiry(env, LAST_GOOD_TTL))
      return { data: env.data, cacheHit: true, fetchedAt: env.fetchedAt, stale: true }
    }
  } catch (e) {
    logKvError(`KV read failed for ${lastGoodKey(key)}`, e)
    const env = lruGet<T>(lastGoodKey(key)) ?? lruGet<T>(key)
    if (env && ok(env)) return { data: env.data, cacheHit: true, fetchedAt: env.fetchedAt, stale: true }
  }
  return null
}

/**
 * Read-through cache.
 * - Fresh envelope that passes `validate` → returned as a hit.
 * - Recently failed (negative cache) → last-good copy with stale=true, else throws.
 * - Otherwise fetches (deduplicated per key within this process), validates,
 *   stores under `key` (ttlSeconds) and `key:lastgood` (30 days).
 * - Fetch/validation failure → negative-caches for negativeTtl and serves the
 *   last-good copy with stale=true if there is one; otherwise rethrows.
 * - With `budget`, a fetch first reserves an upstream call; over budget →
 *   last-good copy (stale=true) if present, else BudgetExceededError.
 */
export async function getCachedOrFetch<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
  options: CacheOptions<T> = {}
): Promise<CachedResult<T>> {
  const { negativeTtl = 300, validate, forceRefresh = false, budget } = options

  if (!forceRefresh) {
    try {
      const env = await getCachedEnvelope<T>(key)
      if (env && (!validate || validate(env.data))) {
        if (getRedis()) lruPut(key, env, envelopeExpiry(env, ttlSeconds))
        return { data: env.data, cacheHit: true, fetchedAt: env.fetchedAt, stale: false }
      }
      const [failed, missing] = await Promise.all([
        getCached<boolean>(failedKey(key)),
        getCached<boolean>(missingKey(key)),
      ])
      if (failed || missing) {
        const lastGood = await readLastGood(key, validate)
        if (lastGood) return lastGood
        throw new Error(`Negative cache hit for ${key}${missing ? ' (no upstream data at last refresh)' : ''}`)
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Negative cache hit')) throw e
      logKvError(`KV read failed for ${key}`, e)
      // Redis errored or is marked down: serve this instance's copy if it has one.
      const env = lruGet<T>(key)
      if (env && (!validate || validate(env.data))) {
        return { data: env.data, cacheHit: true, fetchedAt: env.fetchedAt, stale: false }
      }
    }
  }

  const existing = inflight.get(key)
  if (existing) return existing as Promise<CachedResult<T>>

  const promise = (async (): Promise<CachedResult<T>> => {
    if (budget && !(await tryAcquireUpstream(budget))) {
      const lastGood = await readLastGood(key, validate)
      if (lastGood) return lastGood
      throw new BudgetExceededError(key, budget)
    }
    try {
      const data = await fetchFn()
      if (validate && !validate(data)) throw new ValidationError(key)
      const fetchedAt = new Date().toISOString()
      try {
        await writeEnvelope(key, data, ttlSeconds, fetchedAt)
      } catch (e) {
        logKvError(`KV write failed for ${key}`, e)
      }
      return { data, cacheHit: false, fetchedAt, stale: false }
    } catch (fetchErr) {
      try {
        await setCached(failedKey(key), true, negativeTtl)
      } catch {}
      const lastGood = await readLastGood(key, validate)
      if (lastGood) return lastGood
      throw fetchErr
    }
  })()

  inflight.set(key, promise as Promise<CachedResult<unknown>>)
  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}
