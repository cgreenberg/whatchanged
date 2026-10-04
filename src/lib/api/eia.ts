import type { GasPriceData } from '@/types'
import {
  CPI_TO_EIA_CITY,
  COUNTY_EIA_CITY_OVERRIDES,
  STATE_LEVEL_CODES,
  STATE_TO_PAD,
  PAD_NAMES,
  PAD_DUOAREA,
} from '@/lib/mappings/eia-gas'

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
  duoarea: string
  geoLevel: string
  tier: 1 | 2 | 3
  cacheKey: string
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

export function getGasLookup(
  stateAbbr: string,
  cpiAreaCode?: string,
  countyFips?: string
): GasLookupResult {
  // Tier 1a: county FIPS overrides (may point at a city, state or PADD series)
  if (countyFips) {
    const override = COUNTY_EIA_CITY_OVERRIDES[countyFips]
    if (override) return describeDuoarea(override.duoarea, override.label)
  }

  // Tier 1b: CPI metro → EIA city
  if (cpiAreaCode) {
    const city = CPI_TO_EIA_CITY[cpiAreaCode]
    if (city) return describeDuoarea(city.duoarea, city.label)
  }

  const upper = stateAbbr.toUpperCase()

  // Tier 2: state-level
  const state = STATE_LEVEL_CODES[upper]
  if (state) return describeDuoarea(state.duoarea, state.label)

  // Tier 3: PAD district / sub-district
  const pad = STATE_TO_PAD[upper]
  if (pad !== undefined) {
    const duoarea = PAD_DUOAREA[pad] ?? `R${pad}0`
    return describeDuoarea(duoarea, `${PAD_NAMES[pad]} avg`)
  }

  // National fallback
  return describeDuoarea('NUS')
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
    change: parseFloat((latest.price - baselinePoint.price).toFixed(3)),
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
  return {
    current: s.current,
    baseline: s.baseline,
    change: s.change,
    baselineDate: s.baselineDate,
    latestDate: s.latestDate,
    region: lookup.duoarea === 'NUS' ? 'National avg' : s.regionName,
    geoLevel: lookup.geoLevel,
    isNationalFallback: extra.isNationalFallback ?? lookup.duoarea === 'NUS',
    duoarea: lookup.duoarea,
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
  return toGasPriceData(lookup, await fetchGasSeries(lookup.duoarea))
}
