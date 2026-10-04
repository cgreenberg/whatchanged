// Preload-everything cache refresh (run by scripts/refresh-cache.ts from the
// refresh-cache GitHub Action). Fetches EVERY series the app can request and
// writes it with the runtime's own parsers, validators, cache keys, TTLs and
// envelope format (writeEnvelope), so user requests are cache hits and the
// runtime path almost never calls BLS/EIA.
//
// Upstream use for a full refresh (prices only; county unemployment/LAUS is no
// longer fetched at runtime):
//   - BLS: CPI in batches of 15 areas × 3 items (food at home, shelter, rent of
//     primary residence) + the 2 national overlay items = 47 series (the batch
//     carrying the national area adds its rent series: 48); the BLS monthly gas
//     series (APU{area}74714, 17) fill the spare room in those batches (≤ 50
//     series per POST) → 3 BLS calls for a full refresh
//   - Gas: one EIA GET per EIA duoarea (~27 calls)
//   - Electricity: every state + US in ONE paged EIA query (≈ 7,900 rows → 2 calls)

import zipCountyData from '@/lib/data/zip-county.json'
import { lookupZip } from '@/lib/data/zip-lookup'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import { writeEnvelope, setCached, missingKey, MISSING_TTL } from '@/lib/cache/kv'
import { fetchBlsSeries, type BlsRawPoint } from './bls-common'
import { cpiSeriesIds, cpiCacheKey, parseCpiResponse, NATIONAL_CPI_AREA } from './bls-cpi'
import { fetchGasSeries, getGasLookup, type GasLookupResult, type GasSeriesData } from './eia'
import { parseBlsGasSeries } from './bls-gas'
import { isValidCpi, isValidGasSeries, isValidElectricity } from './validate'
import {
  buildElectricityByState,
  electricityCacheKey,
  fetchElectricityRows,
  hasElectricitySeries,
  NATIONAL_ELECTRICITY,
  type EiaElectricityRow,
} from './eia-electricity'
import {
  CPI_TTL,
  ELECTRICITY_TTL,
  gasTtlFor,
  NATIONAL_CPI,
  NATIONAL_GAS_LOOKUP,
  BLS_NATIONAL_GAS_LOOKUP,
  type CpiArea,
} from './cached-sources'

/** BLS API v2 with a registration key: max 50 series and 20 years per request. */
export const BLS_MAX_SERIES_PER_REQUEST = 50
/** Series per local CPI area: food at home, shelter, rent of primary residence. */
export const CPI_ITEMS_PER_AREA = 3
export const CPI_AREAS_PER_REQUEST = 15 // 15 × 3 items + 2 national overlay items (+1 national rent) ≤ 48 series

// --- Plan --------------------------------------------------------------------

export interface RefreshPlan {
  /** Every CPI area any county resolves to, plus national (runtime fallback). */
  cpiAreas: CpiArea[]
  /**
   * Every gas series any zip resolves to (EIA weekly and BLS monthly), plus each source's
   * national series (overlay + fallback) when any lookup of that source is present.
   */
  gasLookups: GasLookupResult[]
  /** Every state any zip resolves to that EIA publishes a residential electricity price for, plus 'US'. */
  electricityStates?: string[]
}

const ALL_ZIPS = Object.keys(zipCountyData as Record<string, unknown>)

/** Resolve zips exactly as the snapshot does (fetchSnapshot) and collect distinct cache targets. */
export function planRefresh(zips: string[] = ALL_ZIPS): RefreshPlan {
  const cpi = new Map<string, CpiArea>([[NATIONAL_CPI.areaCode, NATIONAL_CPI]])
  const gas = new Map<string, GasLookupResult>([[NATIONAL_GAS_LOOKUP.cacheKey, NATIONAL_GAS_LOOKUP]])
  const states = new Set<string>([NATIONAL_ELECTRICITY])
  for (const zip of zips) {
    const location = lookupZip(zip)
    if (!location) continue
    if (hasElectricitySeries(location.stateAbbr)) states.add(location.stateAbbr.toUpperCase())
    const area = getMetroCpiAreaForCounty(location.countyFips, location.stateAbbr)
    if (!cpi.has(area.areaCode)) cpi.set(area.areaCode, area)
    const lookup = getGasLookup(location.stateAbbr, area.areaCode, location.countyFips)
    if (!gas.has(lookup.cacheKey)) gas.set(lookup.cacheKey, lookup)
    if (lookup.source === 'bls') {
      // The snapshot's BLS-outage fallback (the zip's EIA weekly tier) must be warm too
      const eia = getGasLookup(location.stateAbbr, area.areaCode, location.countyFips, { eiaOnly: true })
      if (!gas.has(eia.cacheKey)) gas.set(eia.cacheKey, eia)
    }
  }
  if ([...gas.values()].some((l) => l.source === 'bls')) gas.set(BLS_NATIONAL_GAS_LOOKUP.cacheKey, BLS_NATIONAL_GAS_LOOKUP)
  return {
    cpiAreas: [...cpi.values()].sort((a, b) => a.areaCode.localeCompare(b.areaCode)),
    gasLookups: [...gas.values()].sort((a, b) => a.cacheKey.localeCompare(b.cacheKey)),
    electricityStates: [...states].sort(),
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** One BLS POST: CPI areas (their 3 items each, plus the 2 national overlay items) and BLS gas series. */
export interface BlsRequest {
  ids: string[]
  cpiAreas: CpiArea[]
  gas: GasLookupResult[]
}

/**
 * Pack every BLS series in the plan into as few POSTs as possible (≤ 50 series each):
 * CPI batches as before, then the BLS gas series fill the spare room, in new requests only
 * when every CPI batch is full.
 */
export function planBlsRequests(plan: RefreshPlan): BlsRequest[] {
  const nat = cpiSeriesIds(NATIONAL_CPI_AREA)
  const natIds = [nat.groceries, nat.shelter]
  const localCpi = plan.cpiAreas.filter((a) => a.areaCode !== NATIONAL_CPI_AREA)
  const hasNational = plan.cpiAreas.some((a) => a.areaCode === NATIONAL_CPI_AREA)
  const requests: BlsRequest[] = chunk(localCpi, CPI_AREAS_PER_REQUEST).map((batch, i) => ({
    ids: [
      ...batch.flatMap((a) => {
        const s = cpiSeriesIds(a.areaCode)
        return [s.groceries, s.shelter, s.rent]
      }),
      ...natIds,
      // The national area's own cache entry also carries its rent index
      ...(i === 0 && hasNational ? [nat.rent] : []),
    ],
    cpiAreas: i === 0 && hasNational ? [...batch, NATIONAL_CPI] : batch,
    gas: [],
  }))
  if (hasNational && !requests.length) requests.push({ ids: [...natIds, nat.rent], cpiAreas: [NATIONAL_CPI], gas: [] })
  for (const lookup of plan.gasLookups.filter((l) => l.source === 'bls')) {
    let req = requests.find((r) => r.ids.length < BLS_MAX_SERIES_PER_REQUEST)
    if (!req) {
      req = { ids: [], cpiAreas: [], gas: [] }
      requests.push(req)
    }
    if (!req.ids.includes(lookup.seriesId)) req.ids.push(lookup.seriesId)
    req.gas.push(lookup)
  }
  return requests
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
  /** All requested states' electricity rows in one (paged) EIA query (default: the live EIA API). */
  fetchElectricity?: (states: string[]) => Promise<{ rows: EiaElectricityRow[]; requests: number }>
  write: <T>(key: string, data: T, ttl: number) => Promise<unknown>
  /** Record that upstream has no usable data for `key`, so the runtime does not keep re-fetching it. */
  markMissing?: (key: string) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
  log: (msg: string) => void
}

export const defaultRefreshDeps: RefreshDeps = {
  fetchBls: (ids) => fetchBlsSeries(ids, { timeoutMs: 60_000, label: 'BLS refresh' }),
  fetchGas: (duoarea) => fetchGasSeries(duoarea, { timeoutMs: 30_000 }),
  fetchElectricity: (states) => fetchElectricityRows(states, { timeoutMs: 30_000 }),
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

  // BLS — CPI batched with the shared national series; BLS gas series fill the spare room.
  const blsRequests = planBlsRequests(plan)
  for (const [i, req] of blsRequests.entries()) {
    let seriesMap: Record<string, BlsRawPoint[]>
    try {
      seriesMap = await withRetry('bls', () => deps.fetchBls(req.ids))
    } catch (e) {
      report.failedBatches++
      for (const a of req.cpiAreas) record(cpiCacheKey(a.areaCode), 'error', msg(e))
      for (const g of req.gas) record(g.cacheKey, 'error', msg(e))
      continue
    }
    for (const area of req.cpiAreas) {
      const key = cpiCacheKey(area.areaCode)
      try {
        const data = parseCpiResponse(seriesMap, area)
        if (!isValidCpi(data)) record(key, 'invalid', 'failed sanity validation')
        else pending.push({ key, ttl: CPI_TTL, data })
      } catch (e) {
        record(key, /No groceries CPI data/.test(msg(e)) ? 'missing' : 'invalid', msg(e))
      }
    }
    for (const lookup of req.gas) {
      try {
        const data = parseBlsGasSeries(seriesMap[lookup.seriesId], lookup.areaName ?? lookup.areaCode)
        if (!isValidGasSeries(data)) record(lookup.cacheKey, 'invalid', 'failed sanity validation')
        else pending.push({ key: lookup.cacheKey, ttl: gasTtlFor(lookup), data })
      } catch (e) {
        record(lookup.cacheKey, /No BLS gas price data/.test(msg(e)) ? 'missing' : 'invalid', msg(e))
      }
    }
    deps.log(`  BLS request ${i + 1}/${blsRequests.length} (${req.cpiAreas.length} CPI areas, ${req.gas.length} gas series, ${req.ids.length} series)`)
    if (blsPauseMs) await deps.sleep(blsPauseMs)
  }

  // EIA gas — one request per duoarea, small concurrency.
  const eiaLookups = plan.gasLookups.filter((l) => l.source !== 'bls')
  await runBounded(eiaLookups, eiaConcurrency, async (lookup) => {
    try {
      const data = await withRetry('eia', () => deps.fetchGas(lookup.duoarea ?? lookup.areaCode))
      if (!isValidGasSeries(data)) record(lookup.cacheKey, 'invalid', 'failed sanity validation')
      else pending.push({ key: lookup.cacheKey, ttl: gasTtlFor(lookup), data })
    } catch (e) {
      record(lookup.cacheKey, 'error', msg(e))
    }
  })
  deps.log(`  EIA: ${eiaLookups.length} series`)

  // EIA electricity — every state + US in one paged query (counted per page).
  const elecStates = plan.electricityStates ?? []
  if (elecStates.length) {
    try {
      const fetchElectricity = deps.fetchElectricity ?? defaultRefreshDeps.fetchElectricity!
      const { rows, requests } = await withRetry('eia', () => fetchElectricity(elecStates))
      report.eiaCalls += Math.max(0, requests - 1)
      const parsed = buildElectricityByState(rows, elecStates)
      for (const st of elecStates) {
        const key = electricityCacheKey(st)
        const d = parsed[st]
        if (d instanceof Error) record(key, /No EIA residential electricity price/.test(d.message) ? 'missing' : 'invalid', msg(d))
        else if (!isValidElectricity(d)) record(key, 'invalid', 'failed sanity validation')
        else pending.push({ key, ttl: ELECTRICITY_TTL, data: d })
      }
    } catch (e) {
      for (const st of elecStates) record(electricityCacheKey(st), 'error', msg(e))
    }
    deps.log(`  EIA electricity: ${elecStates.length} states (incl. US)`)
  }

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

export type RefreshSource = 'cpi' | 'gas' | 'electricity'
const SOURCES: RefreshSource[] = ['cpi', 'gas', 'electricity']

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
  return plan.cpiAreas.length + plan.gasLookups.length + (plan.electricityStates?.length ?? 0)
}
