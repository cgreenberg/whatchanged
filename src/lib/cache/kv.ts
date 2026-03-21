// Cache adapter: uses Upstash Redis when env vars are set, in-memory Map otherwise
// Tests and local dev without Upstash get the in-memory fallback

import { Redis } from '@upstash/redis'

let redisClient: Redis | null = null

function getRedis(): Redis | null {
  if (process.env.NODE_ENV === 'test' || !process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null
  }
  if (!redisClient) {
    redisClient = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN!,
    })
  }
  return redisClient
}

// In-memory fallback for test/local dev without Redis
const memCache = new Map<string, { value: unknown; expiresAt: number }>()

export async function getCached<T>(key: string): Promise<T | null> {
  const redis = getRedis()
  if (redis) {
    const val = await redis.get<T>(key)
    return val ?? null
  }
  const entry = memCache.get(key)
  if (!entry || Date.now() > entry.expiresAt) return null
  return entry.value as T
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const redis = getRedis()
  if (redis) {
    await redis.set(key, value, { ex: ttlSeconds })
    return
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

export function clearMemCache() {
  memCache.clear()
}

export async function getCachedOrFetch<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
  negativeTtl = 300 // cache failures for 5 min to avoid hammering broken APIs
): Promise<{ data: T; cacheHit: boolean }> {
  try {
    const cached = await getCached<T>(key)
    if (cached !== null) {
      return { data: cached, cacheHit: true }
    }
    // Check negative cache — if this key recently failed, don't retry
    const failed = await getCached<boolean>(`${key}:failed`)
    if (failed) {
      throw new Error(`Negative cache hit for ${key}`)
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Negative cache hit')) throw e
    console.error(`KV read failed for ${key}:`, e)
  }

  try {
    const data = await fetchFn()
    try {
      await setCached(key, data, ttlSeconds)
    } catch (e) {
      console.error(`KV write failed for ${key}:`, e)
    }
    return { data, cacheHit: false }
  } catch (fetchErr) {
    // Cache the failure so we don't retry for negativeTtl seconds
    try {
      await setCached(`${key}:failed`, true, negativeTtl)
    } catch {}
    throw fetchErr
  }
}
