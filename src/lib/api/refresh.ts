// Preload-everything cache refresh (run by scripts/refresh-cache.ts from the
// refresh-cache GitHub Action). Fetches EVERY series the app can request and
// writes it with the runtime's own parsers, validators, cache keys, TTLs and
// envelope format (writeEnvelope), so user requests are cache hits and the
// runtime path almost never calls BLS/EIA.
//
// Upstream use for a full refresh:
//   - LAUS: one BLS POST per 49 areas (+ the shared national series = 50, the
//     BLS v2 per-request maximum with a key), ~66 calls for ~3,230 areas
//   - CPI:  one BLS POST per 15 areas (45 series + 3 national = 48), 3 calls
//   - Gas:  one EIA GET per duoarea (~28 calls)

import zipCountyData from '@/lib/data/zip-county.json'
import { lookupZip } from '@/lib/data/zip-lookup'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import { getLausAreaForCounty, resolveLausArea } from '@/lib/mappings/laus-area'
import { writeEnvelope, setCached, missingKey, MISSING_TTL } from '@/lib/cache/kv'
import { fetchBlsSeries, type BlsRawPoint } from './bls-common'
import { buildSeriesId, parseUnemploymentResponse, NATIONAL_UNEMPLOYMENT_SERIES } from './bls'
import { cpiSeriesIds, cpiCacheKey, parseCpiResponse, NATIONAL_CPI_AREA } from './bls-cpi'
import { fetchGasSeries, getGasLookup, type GasLookupResult, type GasSeriesData } from './eia'
import { isValidUnemployment, isValidCpi, isValidGasSeries } from './validate'
import {
  unemploymentCacheKey,
  UNEMPLOYMENT_TTL,
  CPI_TTL,
  GAS_TTL,
  NATIONAL_CPI,
  NATIONAL_GAS_LOOKUP,
  type CpiArea,
} from './cached-sources'

/** BLS API v2 with a registration key: max 50 series and 20 years per request. */
export const BLS_MAX_SERIES_PER_REQUEST = 50
export const LAUS_AREAS_PER_REQUEST = BLS_MAX_SERIES_PER_REQUEST - 1 // + national LNU04000000
export const CPI_AREAS_PER_REQUEST = 15 // 15 × 3 items + 3 national items = 48 series

// --- Plan --------------------------------------------------------------------

export interface RefreshPlan {
  /** Every LAUS area FIPS any zip (or county) resolves to — incl. CT planning regions, PR municipios. */
  lausAreas: string[]
  /** Every CPI area any county resolves to, plus national (runtime fallback). */
  cpiAreas: CpiArea[]
  /** Every EIA gas series any zip resolves to, plus national (overlay + fallback). */
  gasLookups: GasLookupResult[]
}

const ALL_ZIPS = Object.keys(zipCountyData as Record<string, unknown>)

/** Resolve zips exactly as the snapshot does (fetchSnapshot) and collect distinct cache targets. */
export function planRefresh(zips: string[] = ALL_ZIPS): RefreshPlan {
  const laus = new Set<string>()
  const cpi = new Map<string, CpiArea>([[NATIONAL_CPI.areaCode, NATIONAL_CPI]])
  const gas = new Map<string, GasLookupResult>([[NATIONAL_GAS_LOOKUP.cacheKey, NATIONAL_GAS_LOOKUP]])
  for (const zip of zips) {
    const location = lookupZip(zip)
    if (!location) continue
    laus.add(resolveLausArea(zip, location.countyFips).fips)
    laus.add(getLausAreaForCounty(location.countyFips).fips)
    const area = getMetroCpiAreaForCounty(location.countyFips, location.stateAbbr)
    if (!cpi.has(area.areaCode)) cpi.set(area.areaCode, area)
    const lookup = getGasLookup(location.stateAbbr, area.areaCode, location.countyFips)
    if (!gas.has(lookup.cacheKey)) gas.set(lookup.cacheKey, lookup)
  }
  return {
    lausAreas: [...laus].sort(),
    cpiAreas: [...cpi.values()].sort((a, b) => a.areaCode.localeCompare(b.areaCode)),
    gasLookups: [...gas.values()].sort((a, b) => a.cacheKey.localeCompare(b.cacheKey)),
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// --- Execution ---------------------------------------------------------------

export type ItemStatus = 'written' | 'missing' | 'invalid' | 'error'

export interface ItemResult {
  key: string
  status: ItemStatus
  error?: string
}

export interface RefreshReport {
  results: ItemResult[]
  blsCalls: number
  eiaCalls: number
  /** Batches that failed after all retries (every key in them is 'error'). */
  failedBatches: number
}

export interface RefreshDeps {
  fetchBls: (ids: string[]) => Promise<Record<string, BlsRawPoint[]>>
  fetchGas: (duoarea: string) => Promise<GasSeriesData>
  write: <T>(key: string, data: T, ttl: number) => Promise<unknown>
  /** Record that upstream has no usable data for `key`, so the runtime does not keep re-fetching it. */
  markMissing?: (key: string) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
  log: (msg: string) => void
}

export const defaultRefreshDeps: RefreshDeps = {
  fetchBls: (ids) => fetchBlsSeries(ids, { timeoutMs: 60_000, label: 'BLS refresh' }),
  fetchGas: (duoarea) => fetchGasSeries(duoarea, { timeoutMs: 30_000 }),
  write: (key, data, ttl) => writeEnvelope(key, data, ttl),
  markMissing: (key) => setCached(missingKey(key), true, MISSING_TTL),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (msg) => console.log(msg),
}

export interface RefreshOptions {
  /** Retries per upstream request after the first attempt (exponential backoff). Default 2. */
  retries?: number
  /** Base backoff in ms (doubles per retry). */
  backoffMs?: number
  /** Pause between consecutive BLS requests (politeness). */
  blsPauseMs?: number
  /** Concurrent EIA requests. */
  eiaConcurrency?: number
  /** Concurrent cache writes. */
  writeConcurrency?: number
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200)

/** BLS daily-threshold errors won't recover on retry; stop issuing BLS requests. */
const isQuotaError = (e: unknown) => /threshold|daily|limit/i.test(msg(e))

export async function runBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

export async function runRefresh(
  plan: RefreshPlan,
  deps: RefreshDeps = defaultRefreshDeps,
  options: RefreshOptions = {}
): Promise<RefreshReport> {
  const { retries = 2, backoffMs = 2000, blsPauseMs = 1000, eiaConcurrency = 2, writeConcurrency = 8 } = options
  const report: RefreshReport = { results: [], blsCalls: 0, eiaCalls: 0, failedBatches: 0 }
  let blsHalted: string | null = null

  async function withRetry<T>(kind: 'bls' | 'eia', fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (kind === 'bls') {
        if (blsHalted) throw new Error(`BLS halted: ${blsHalted}`)
        report.blsCalls++
      } else {
        report.eiaCalls++
      }
      try {
        return await fn()
      } catch (e) {
        lastErr = e
        if (kind === 'bls' && isQuotaError(e)) {
          blsHalted = msg(e)
          throw e
        }
        if (attempt < retries) await deps.sleep(backoffMs * 2 ** attempt)
      }
    }
    throw lastErr
  }

  type Pending = { key: string; ttl: number; data: unknown }
  const pending: Pending[] = []
  const record = (key: string, status: ItemStatus, error?: string) =>
    report.results.push(error ? { key, status, error } : { key, status })

  // LAUS unemployment — batched, sequential.
  const lausBatches = chunk(plan.lausAreas, LAUS_AREAS_PER_REQUEST)
  for (const [i, batch] of lausBatches.entries()) {
    const ids = batch.map(buildSeriesId)
    let seriesMap: Record<string, BlsRawPoint[]>
    try {
      seriesMap = await withRetry('bls', () => deps.fetchBls([...ids, NATIONAL_UNEMPLOYMENT_SERIES]))
    } catch (e) {
      report.failedBatches++
      for (const fips of batch) record(unemploymentCacheKey(fips), 'error', msg(e))
      continue
    }
    for (const fips of batch) {
      const key = unemploymentCacheKey(fips)
      if (!seriesMap[buildSeriesId(fips)]?.length) {
        record(key, 'missing', `BLS returned no data for ${buildSeriesId(fips)}`)
        continue
      }
      try {
        const data = parseUnemploymentResponse(seriesMap, fips)
        if (!isValidUnemployment(data)) record(key, 'invalid', 'failed sanity validation')
        else pending.push({ key, ttl: UNEMPLOYMENT_TTL, data })
      } catch (e) {
        record(key, 'invalid', msg(e))
      }
    }
    deps.log(`  LAUS batch ${i + 1}/${lausBatches.length} (${batch.length} areas)`)
    if (blsPauseMs) await deps.sleep(blsPauseMs)
  }

  // CPI — batched with the shared national series.
  const nat = cpiSeriesIds(NATIONAL_CPI_AREA)
  const natIds = [nat.groceries, nat.shelter, nat.energy]
  const localCpi = plan.cpiAreas.filter((a) => a.areaCode !== NATIONAL_CPI_AREA)
  const cpiBatches = chunk(localCpi, CPI_AREAS_PER_REQUEST)
  const hasNational = plan.cpiAreas.some((a) => a.areaCode === NATIONAL_CPI_AREA)
  if (hasNational && !cpiBatches.length) cpiBatches.push([])
  for (const [i, batch] of cpiBatches.entries()) {
    const ids = batch.flatMap((a) => {
      const s = cpiSeriesIds(a.areaCode)
      return [s.groceries, s.shelter, s.energy]
    })
    const areas = i === 0 && hasNational ? [...batch, NATIONAL_CPI] : batch
    let seriesMap: Record<string, BlsRawPoint[]>
    try {
      seriesMap = await withRetry('bls', () => deps.fetchBls([...ids, ...natIds]))
    } catch (e) {
      report.failedBatches++
      for (const a of areas) record(cpiCacheKey(a.areaCode), 'error', msg(e))
      continue
    }
    for (const area of areas) {
      const key = cpiCacheKey(area.areaCode)
      try {
        const data = parseCpiResponse(seriesMap, area)
        if (!isValidCpi(data)) record(key, 'invalid', 'failed sanity validation')
        else pending.push({ key, ttl: CPI_TTL, data })
      } catch (e) {
        record(key, /No groceries CPI data/.test(msg(e)) ? 'missing' : 'invalid', msg(e))
      }
    }
    deps.log(`  CPI batch ${i + 1}/${cpiBatches.length} (${areas.length} areas)`)
    if (blsPauseMs) await deps.sleep(blsPauseMs)
  }

  // EIA gas — one request per duoarea, small concurrency.
  await runBounded(plan.gasLookups, eiaConcurrency, async (lookup) => {
    try {
      const data = await withRetry('eia', () => deps.fetchGas(lookup.duoarea))
      if (!isValidGasSeries(data)) record(lookup.cacheKey, 'invalid', 'failed sanity validation')
      else pending.push({ key: lookup.cacheKey, ttl: GAS_TTL, data })
    } catch (e) {
      record(lookup.cacheKey, 'error', msg(e))
    }
  })
  deps.log(`  EIA: ${plan.gasLookups.length} series`)

  // Writes: key + key:lastgood, clears key:failed (same as a runtime fetch).
  await runBounded(pending, writeConcurrency, async (p) => {
    try {
      await deps.write(p.key, p.data, p.ttl)
      record(p.key, 'written')
    } catch (e) {
      record(p.key, 'error', `write failed: ${msg(e)}`)
    }
  })

  // Known-missing markers for keys upstream has no usable data for (not for
  // fetch errors, which may be transient). Best effort.
  if (deps.markMissing) {
    const gaps = report.results.filter((r) => r.status === 'missing' || r.status === 'invalid')
    await runBounded(gaps, writeConcurrency, async (r) => {
      try {
        await deps.markMissing!(r.key)
      } catch (e) {
        deps.log(`  marker write failed for ${r.key}: ${msg(e)}`)
      }
    })
  }

  return report
}

export function summarize(report: RefreshReport) {
  const count = (s: ItemStatus) => report.results.filter((r) => r.status === s).length
  return {
    written: count('written'),
    missing: count('missing'),
    invalid: count('invalid'),
    errors: count('error'),
    blsCalls: report.blsCalls,
    eiaCalls: report.eiaCalls,
    failedBatches: report.failedBatches,
  }
}

// --- Run guard + CLI args ------------------------------------------------------

/** Redis key holding the ISO time of the last fully successful full refresh. */
export const REFRESH_LAST_SUCCESS_KEY = 'refresh:last-success'
/** Two schedules can land on the same day (weekly + 16th/28th); skip a full run this soon after a success. */
export const REFRESH_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000
export const REFRESH_LAST_SUCCESS_TTL = 60 * 60 * 24 * 30
/** Redis key holding the ISO start time of the last full refresh attempt (successful or not). */
export const REFRESH_LAST_ATTEMPT_KEY = 'refresh:last-attempt'
/** A full run that started this recently (and may have failed) blocks another unforced one: caps BLS spend when crons coincide. */
export const REFRESH_ATTEMPT_INTERVAL_MS = 2 * 60 * 60 * 1000
export const REFRESH_LAST_ATTEMPT_TTL = 60 * 60 * 24

/** true → a full run should be skipped because one succeeded < 12h ago (unless forced). */
export function shouldSkipRecentRun(
  lastSuccess: unknown,
  now: Date,
  force: boolean,
  intervalMs: number = REFRESH_MIN_INTERVAL_MS
): boolean {
  if (force || typeof lastSuccess !== 'string') return false
  const t = Date.parse(lastSuccess)
  if (!Number.isFinite(t)) return false
  const age = now.getTime() - t
  return age >= 0 && age < intervalMs
}

export type RefreshSource = 'laus' | 'cpi' | 'gas'
const SOURCES: RefreshSource[] = ['laus', 'cpi', 'gas']

export interface RefreshArgs {
  dryRun: boolean
  force: boolean
  only?: RefreshSource
  zips?: string[]
}

/** Parse + validate CLI args. Returns an error string for unknown args, unknown --only values or malformed --zips. */
export function parseRefreshArgs(argv: string[]): RefreshArgs | { error: string } {
  const arg = (name: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit === undefined ? undefined : hit.slice(name.length + 3)
  }
  // Reject anything else (`--only gas`, `--dryrun`, stray values): a typo must
  // not silently turn into a full production refresh.
  const known = /^(--dry-run|--force|--only=.*|--zips=.*)$/
  const unknownArgs = argv.filter((a) => !known.test(a))
  if (unknownArgs.length) {
    return { error: `Unknown argument(s): ${unknownArgs.slice(0, 5).join(' ')} (use --dry-run, --force, --only=<source>, --zips=<a,b>)` }
  }
  const out: RefreshArgs = { dryRun: argv.includes('--dry-run'), force: argv.includes('--force') }
  const only = arg('only')
  if (only !== undefined) {
    if (!SOURCES.includes(only as RefreshSource)) return { error: `--only must be one of ${SOURCES.join(', ')} (got "${only}")` }
    out.only = only as RefreshSource
  }
  const zips = arg('zips')
  if (zips !== undefined) {
    const list = zips.split(',').map((z) => z.trim()).filter(Boolean)
    const bad = list.filter((z) => !/^\d{5}$/.test(z))
    if (!list.length) return { error: '--zips is empty' }
    if (bad.length) return { error: `--zips has malformed entries: ${bad.slice(0, 5).join(', ')}` }
    const unknown = list.filter((z) => !lookupZip(z))
    if (unknown.length === list.length) return { error: `--zips matched no known zip codes: ${unknown.slice(0, 5).join(', ')}` }
    out.zips = list
  }
  return out
}

/** Total number of upstream targets in a plan. */
export function planSize(plan: RefreshPlan): number {
  return plan.lausAreas.length + plan.cpiAreas.length + plan.gasLookups.length
}
