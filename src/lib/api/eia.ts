import type { GasPriceData } from '@/types'
import { STATE_LEVEL_CODES } from '@/lib/mappings/eia-gas'
import { selectGasLookup } from '@/lib/resolution/ladders'
import { fetchBlsGasSeries } from './bls-gas'
import { displayedChange } from '@/lib/baseline'

const EIA_API_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'

/** Inauguration day. Gas baseline = last weekly reading on or before this date. */
export const GAS_BASELINE_DATE = '2025-01-20'
/** A baseline reading older than this is not accepted (weekly series → at most 1 week back). */
const GAS_BASELINE_EARLIEST = '2025-01-06'

export const EIA_TIMEOUT_MS = 8000
/** Weekly data older than this is flagged stale (but still served). */
export const GAS_STALE_AFTER_MS = 10 * 24 * 60 * 60 * 1000

/**
 * EIA product code: EPMR = Regular Gasoline (all formulations). The previous
 * EPM0 ("all grades") averaged in midgrade/premium and ran ~10–15¢ above the
 * regular price people see on signs. Verified 2026-10-02 that EPMR is published
 * weekly back to 2016 for every duoarea getGasLookup() can return (10 cities,
 * 9 states, R1X/R1Y/R1Z/R20/R30/R40/R50/R5XCA, NUS).
 */
export const EIA_GAS_PRODUCT = 'EPMR'

/** Cache key prefix includes the product so a product change can never serve old-product data. */
const GAS_KEY_PREFIX = `eia:gas:${EIA_GAS_PRODUCT.toLowerCase()}`

export const NATIONAL_GAS_CACHE_KEY = `${GAS_KEY_PREFIX}:national`

/** EIA series ID for a duoarea, e.g. EMM_EPMR_PTE_NUS_DPG. */
export function eiaGasSeriesId(duoarea: string): string {
  return `EMM_${EIA_GAS_PRODUCT}_PTE_${duoarea.toUpperCase()}_DPG`
}

// --- Lookup ---

export interface GasLookupResult {
  /**
   * 'eia' = EIA weekly retail regular gasoline; 'bls' = BLS CPI average price, regular gasoline (monthly);
   * 'dcra' / 'daco' = static (bundled) Alaska community survey / Puerto Rico DACO series (src/lib/static-gas.ts),
   * never fetched through the cache.
   */
  source: 'eia' | 'bls' | 'dcra' | 'daco'
  frequency: 'weekly' | 'monthly' | 'semiannual'
  /** EIA duoarea (source 'eia'), BLS CPI area code (source 'bls'), or a static source's community / area. */
  areaCode: string
  /** EIA duoarea; set only for source 'eia'. */
  duoarea?: string
  /** BLS area name (source 'bls'), e.g. "Philadelphia-Camden-Wilmington". */
  areaName?: string
  /** Upstream series id: EMM_EPMR_PTE_{duoarea}_DPG (EIA) or APU{area}74714 (BLS). */
  seriesId: string
  geoLevel: string
  /** Geographic granularity: 1 city/metro, 2 state (or HI/AK stand-in), 3 PADD/national. */
  tier: 1 | 2 | 3
  cacheKey: string
  /**
   * true: a HI / AK zip outside the Honolulu / Anchorage CBSA. No EIA or BLS series covers it, so
   * the Honolulu / Anchorage series stands in (labeled as such; local prices are typically higher).
   */
  standIn?: boolean
}

// Fixed facts about EIA PADD duoarea codes (independent of which code each
// state is mapped to in eia-gas.ts), so a code always gets the same key + label.
const PADD_CODES: Record<string, { key: string; label: string }> = {
  R10: { key: '1', label: 'East Coast (PADD 1) avg' },
  R1X: { key: '1A', label: 'New England (PADD 1A) avg' },
  R1Y: { key: '1B', label: 'Central Atlantic (PADD 1B) avg' },
  R1Z: { key: '1C', label: 'Lower Atlantic (PADD 1C) avg' },
  R20: { key: '2', label: 'Midwest (PADD 2) avg' },
  R30: { key: '3', label: 'Gulf Coast (PADD 3) avg' },
  R40: { key: '4', label: 'Rocky Mountain (PADD 4) avg' },
  R50: { key: '5', label: 'West Coast (PADD 5) avg' },
  R5XCA: { key: '5XCA', label: 'West Coast excl. California (PADD 5) avg' },
}

/**
 * Derive tier, cache key and label from the EIA duoarea code itself, so the
 * same series always gets the same key and the label matches the geography:
 *   Y*   → city (tier 1)     eia:gas:epmr:city:{duoarea}
 *   S**  → state (tier 2)    eia:gas:epmr:state:{ST}
 *   R*   → PADD (tier 3)     eia:gas:epmr:pad:{pad}
 *   NUS  → national (tier 3) eia:gas:epmr:national
 */
export function describeDuoarea(duoarea: string, label?: string): GasLookupResult {
  const code = duoarea.toUpperCase()
  return { source: 'eia', frequency: 'weekly', areaCode: code, seriesId: eiaGasSeriesId(code), ...describeEiaCode(code, label) }
}

function describeEiaCode(code: string, label?: string): Pick<GasLookupResult, 'duoarea' | 'geoLevel' | 'tier' | 'cacheKey'> {
  if (code === 'NUS') {
    return { duoarea: 'NUS', geoLevel: 'National avg', tier: 3, cacheKey: NATIONAL_GAS_CACHE_KEY }
  }
  if (code.startsWith('Y')) {
    return { duoarea: code, geoLevel: label ?? `${code} area avg`, tier: 1, cacheKey: `${GAS_KEY_PREFIX}:city:${code}` }
  }
  if (/^S[A-Z]{2}$/.test(code)) {
    const st = code.slice(1)
    return {
      duoarea: code,
      geoLevel: label ?? STATE_LEVEL_CODES[st]?.label ?? `${st} state avg`,
      tier: 2,
      cacheKey: `${GAS_KEY_PREFIX}:state:${st}`,
    }
  }
  const padd = PADD_CODES[code]
  if (padd) {
    return { duoarea: code, geoLevel: padd.label, tier: 3, cacheKey: `${GAS_KEY_PREFIX}:pad:${padd.key}` }
  }
  if (code.startsWith('R')) {
    return { duoarea: code, geoLevel: label ?? `${code} avg`, tier: 3, cacheKey: `${GAS_KEY_PREFIX}:pad:${code.slice(1)}` }
  }
  // Unknown code shape — treat as regional, keyed by code
  return { duoarea: code, geoLevel: label ?? `${code} avg`, tier: 3, cacheKey: `${GAS_KEY_PREFIX}:area:${code}` }
}

/**
 * The gas series for a place (most local first). The tiers live in the gas ladder
 * (src/lib/resolution/ladders.ts): this is its first applicable rung. `eiaOnly` = the BLS-outage
 * fallback: the first applicable EIA rung (state / PADD; U.S. for HI/AK).
 */
export function getGasLookup(
  stateAbbr: string,
  cpiAreaCode?: string,
  countyFips?: string,
  opts: { eiaOnly?: boolean } = {}
): GasLookupResult {
  return selectGasLookup({ stateAbbr, cpiAreaCode, countyFips }, opts)
}

// --- Parsing ---

export interface EiaRawPoint {
  period: string
  value: string | number | null
  duoarea?: string
  'area-name'?: string
  [key: string]: unknown
}

export interface GasSeriesData {
  current: number
  latestDate: string
  baseline: number
  baselineDate: string
  change: number
  series: Array<{ date: string; price: number }>
  regionName: string
  /** BLS monthly only: months (YYYY-MM) inside the series BLS did not publish (chart gaps). */
  unpublished?: string[]
}

/**
 * Pure parser for EIA weekly gas data (exported for tests).
 * baseline = last weekly reading on or before 2025-01-20 (and no earlier than
 * 2025-01-06); latest = most recent valid reading. Throws if either is missing.
 */
export function buildSeriesFromData(data: EiaRawPoint[]): GasSeriesData {
  const series = [...data]
    .filter((d) => d && typeof d.period === 'string')
    .filter((d) => d.value !== null && d.value !== '--' && d.value !== '' && Number.isFinite(Number(d.value)))
    .map((d) => ({ date: d.period.slice(0, 10), price: Number(d.value) }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!series.length) {
    throw new Error('No valid price data after filtering')
  }

  const latest = series[series.length - 1]

  let baselinePoint: { date: string; price: number } | null = null
  for (const p of series) {
    if (p.date > GAS_BASELINE_DATE) break
    if (p.date >= GAS_BASELINE_EARLIEST) baselinePoint = p
  }
  if (!baselinePoint) {
    throw new Error('No EIA reading on or within a week before 2025-01-20')
  }

  const first = data[0]
  const regionName = (first?.['area-name'] as string | undefined) ?? first?.duoarea ?? 'Unknown'

  return {
    current: latest.price,
    latestDate: latest.date,
    baseline: baselinePoint.price,
    baselineDate: baselinePoint.date,
    change: displayedChange(latest.price, baselinePoint.price),
    series,
    regionName,
  }
}

export function isGasStale(latestDate: string, now = Date.now()): boolean {
  const t = new Date(latestDate).getTime()
  return !Number.isFinite(t) || now - t > GAS_STALE_AFTER_MS
}

// --- Fetching ---

async function fetchEiaData(duoarea: string, apiKey: string, timeoutMs = EIA_TIMEOUT_MS): Promise<EiaRawPoint[]> {
  const params = new URLSearchParams({
    api_key: apiKey,
    frequency: 'weekly',
    'data[0]': 'value',
    'facets[product][]': EIA_GAS_PRODUCT,
    'facets[duoarea][]': duoarea,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    length: '520',
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${EIA_API_BASE}?${params.toString()}`, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`EIA API error: ${response.status} ${response.statusText}`)
    }
    const json = await response.json()
    const data: EiaRawPoint[] = json?.response?.data ?? []
    if (!data.length) {
      throw new Error(`No EIA gas price data returned for duoarea ${duoarea}`)
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

/** Fetch + parse one EIA weekly retail regular-gasoline series (product EPMR). */
export async function fetchGasSeries(duoarea: string, opts: { timeoutMs?: number } = {}): Promise<GasSeriesData> {
  const apiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'
  return buildSeriesFromData(await fetchEiaData(duoarea, apiKey, opts.timeoutMs))
}

/** Build the API-facing GasPriceData for a lookup from parsed series data. */
export function toGasPriceData(
  lookup: GasLookupResult,
  s: GasSeriesData,
  extra: { nationalSeries?: Array<{ date: string; price: number }>; isNationalFallback?: boolean } = {}
): GasPriceData {
  const isNational = lookup.duoarea === 'NUS' || (lookup.source === 'bls' && lookup.areaCode === '0000')
  return {
    current: s.current,
    baseline: s.baseline,
    change: s.change,
    baselineDate: s.baselineDate,
    latestDate: s.latestDate,
    region: isNational ? 'National avg' : s.regionName,
    geoLevel: lookup.geoLevel,
    isNationalFallback: extra.isNationalFallback ?? isNational,
    source: lookup.source,
    frequency: lookup.frequency,
    seriesId: lookup.seriesId,
    ...(lookup.duoarea ? { duoarea: lookup.duoarea } : {}),
    ...(lookup.source === 'bls' ? { blsArea: lookup.areaCode, areaName: lookup.areaName } : {}),
    ...(lookup.standIn ? { standIn: true } : {}),
    ...(s.unpublished?.length ? { unpublished: s.unpublished } : {}),
    tier: lookup.tier,
    series: s.series,
    ...(extra.nationalSeries ? { nationalSeries: extra.nationalSeries } : {}),
  }
}

/**
 * Fetch the PRIMARY gas series for a location (no national fallback, no
 * national overlay — the snapshot composes those from the shared national key).
 */
export async function fetchGasPrice(
  stateAbbr: string,
  cpiAreaCode?: string,
  countyFips?: string
): Promise<GasPriceData> {
  const lookup = getGasLookup(stateAbbr, cpiAreaCode, countyFips)
  return toGasPriceData(lookup, await fetchLookupSeries(lookup))
}

/** Fetch + parse the series behind a lookup from its own source (EIA weekly or BLS monthly). */
export function fetchLookupSeries(lookup: GasLookupResult, opts: { timeoutMs?: number } = {}): Promise<GasSeriesData> {
  return lookup.source === 'bls'
    ? fetchBlsGasSeries(lookup.areaCode, opts)
    : fetchGasSeries(lookup.duoarea ?? lookup.areaCode, opts)
}
