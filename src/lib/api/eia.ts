import type { GasPriceData } from '@/types'

const EIA_API_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'

const BASELINE_DATE = '2025-01-20'

// --- Tier 1: CPI metro area → EIA city duoarea ---

export const CPI_TO_EIA_CITY: Record<string, { duoarea: string; label: string }> = {
  'S48A': { duoarea: 'Y48SE', label: 'Seattle area avg' },
  'S37A': { duoarea: 'Y05LA', label: 'Los Angeles area avg' },
  'S49A': { duoarea: 'Y05SF', label: 'San Francisco area avg' },
  'S12A': { duoarea: 'Y35NY', label: 'New York City area avg' },
  'S11A': { duoarea: 'YBOS', label: 'Boston area avg' },
  'S24A': { duoarea: 'YORD', label: 'Chicago area avg' },
  'S35D': { duoarea: 'YDEN', label: 'Denver area avg' },
  'S35B': { duoarea: 'Y44HO', label: 'Houston area avg' },
  'S23B': { duoarea: 'YMIA', label: 'Miami area avg' },
}

export const COUNTY_EIA_CITY_OVERRIDES: Record<string, { duoarea: string; label: string }> = {
  '39035': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Cuyahoga County
  '39093': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Lorain County
  '39085': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Lake County
  '39055': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Geauga County
  '39103': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Medina County
}

// --- Tier 2: State-level EIA data (8 states) ---

export const STATE_LEVEL_CODES: Record<string, { duoarea: string; label: string }> = {
  WA: { duoarea: 'SWA', label: 'Washington state avg' },
  CA: { duoarea: 'SCA', label: 'California state avg' },
  CO: { duoarea: 'SCO', label: 'Colorado state avg' },
  FL: { duoarea: 'SFL', label: 'Florida state avg' },
  MN: { duoarea: 'SMN', label: 'Minnesota state avg' },
  NY: { duoarea: 'SNY', label: 'New York state avg' },
  OH: { duoarea: 'SOH', label: 'Ohio state avg' },
  TX: { duoarea: 'STX', label: 'Texas state avg' },
}

// --- Tier 3: PAD District (fallback) ---

export const STATE_TO_PAD: Record<string, number> = {
  // PAD 1 — East Coast
  ME: 1, NH: 1, VT: 1, MA: 1, RI: 1, CT: 1, NY: 1, NJ: 1, PA: 1,
  DE: 1, MD: 1, DC: 1, VA: 1, WV: 1, NC: 1, SC: 1, GA: 1, FL: 1,
  // PAD 2 — Midwest
  OH: 2, MI: 2, IN: 2, IL: 2, WI: 2, MN: 2, IA: 2, MO: 2, ND: 2,
  SD: 2, NE: 2, KS: 2, KY: 2, TN: 2, OK: 2,
  // PAD 3 — Gulf Coast
  TX: 3, LA: 3, MS: 3, AL: 3, AR: 3, NM: 3,
  // PAD 4 — Rocky Mountain
  MT: 4, ID: 4, WY: 4, CO: 4, UT: 4,
  // PAD 5 — West Coast
  WA: 5, OR: 5, CA: 5, NV: 5, AZ: 5, AK: 5, HI: 5,
}

export const PAD_NAMES: Record<number, string> = {
  1: 'East Coast',
  2: 'Midwest',
  3: 'Gulf Coast',
  4: 'Rocky Mountain',
  5: 'West Coast',
}

// --- Exported lookup function ---

export interface GasLookupResult {
  duoarea: string
  geoLevel: string
  tier: 1 | 2 | 3
  cacheKey: string
}

export function getGasLookup(
  stateAbbr: string,
  cpiAreaCode?: string,
  countyFips?: string
): GasLookupResult {
  // Tier 1: check county FIPS overrides first
  if (countyFips) {
    const cityOverride = COUNTY_EIA_CITY_OVERRIDES[countyFips]
    if (cityOverride) {
      return {
        duoarea: cityOverride.duoarea,
        geoLevel: cityOverride.label,
        tier: 1,
        cacheKey: `eia:gas:city:${cityOverride.duoarea}`,
      }
    }
  }

  // Tier 1: check CPI area → city mapping
  if (cpiAreaCode) {
    const city = CPI_TO_EIA_CITY[cpiAreaCode]
    if (city) {
      return {
        duoarea: city.duoarea,
        geoLevel: city.label,
        tier: 1,
        cacheKey: `eia:gas:city:${city.duoarea}`,
      }
    }
  }

  // Tier 2: state-level
  const upper = stateAbbr.toUpperCase()
  const state = STATE_LEVEL_CODES[upper]
  if (state) {
    return {
      duoarea: state.duoarea,
      geoLevel: state.label,
      tier: 2,
      cacheKey: `eia:gas:state:${upper}`,
    }
  }

  // Tier 3: PAD district
  const pad = STATE_TO_PAD[upper]
  if (pad !== undefined) {
    return {
      duoarea: `R${pad}0`,
      geoLevel: `${PAD_NAMES[pad]} avg`,
      tier: 3,
      cacheKey: `eia:gas:pad:${pad}`,
    }
  }

  // National fallback
  return {
    duoarea: 'NUS',
    geoLevel: 'National avg',
    tier: 3,
    cacheKey: 'eia:gas:national',
  }
}

// --- Internal helpers ---

function buildSeriesFromData(data: any[]): {
  series: Array<{ date: string; price: number }>
  current: number
  baseline: number
  regionName: string
} {
  const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period))

  const series = sorted
    .filter((d) => d.value !== null && d.value !== '--' && !isNaN(parseFloat(d.value)))
    .map((d) => ({
      date: d.period,
      price: parseFloat(d.value),
    }))

  if (!series.length) {
    throw new Error('No valid price data after filtering')
  }

  const current = series[series.length - 1].price

  const baselineTime = new Date(BASELINE_DATE).getTime()
  const onOrBefore = series.filter((d) => new Date(d.date).getTime() <= baselineTime)
  const baselinePoint = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : series[0]
  const baseline = baselinePoint.price

  const regionName = data[0]['area-name'] ?? data[0].duoarea ?? 'Unknown'

  return { series, current, baseline, regionName }
}

async function fetchEiaData(duoarea: string, apiKey: string): Promise<any[]> {
  const params = new URLSearchParams({
    api_key: apiKey,
    frequency: 'weekly',
    'data[0]': 'value',
    'facets[product][]': 'EPM0',
    'facets[duoarea][]': duoarea,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    length: '260',
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)
  try {
    const response = await fetch(`${EIA_API_BASE}?${params.toString()}`, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`EIA API error: ${response.status} ${response.statusText}`)
    }

    const json = await response.json()
    const data: any[] = json?.response?.data ?? []

    if (!data.length) {
      throw new Error(`No EIA gas price data returned for duoarea ${duoarea}`)
    }

    return data
  } finally {
    clearTimeout(timeout)
  }
}

// --- Main fetch function ---

export async function fetchGasPrice(
  stateAbbr: string,
  cpiAreaCode?: string,
  countyFips?: string
): Promise<GasPriceData> {
  const lookup = getGasLookup(stateAbbr, cpiAreaCode, countyFips)
  const apiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'

  const isPrimaryNational = lookup.duoarea === 'NUS'

  if (isPrimaryNational) {
    // Already mapped to national — just fetch once
    const data = await fetchEiaData('NUS', apiKey)
    const { series, current, baseline, regionName } = buildSeriesFromData(data)
    return {
      current,
      baseline,
      change: parseFloat((current - baseline).toFixed(3)),
      region: regionName,
      geoLevel: 'National avg',
      isNationalFallback: true,
      series,
    }
  }

  // Fetch primary + national in parallel
  const [primaryResult, nationalResult] = await Promise.allSettled([
    fetchEiaData(lookup.duoarea, apiKey),
    fetchEiaData('NUS', apiKey),
  ])

  if (primaryResult.status === 'fulfilled') {
    const { series, current, baseline, regionName } = buildSeriesFromData(primaryResult.value)

    let nationalSeries: Array<{ date: string; price: number }> | undefined
    if (nationalResult.status === 'fulfilled') {
      nationalSeries = [...nationalResult.value]
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((d) => ({ date: d.period, price: parseFloat(d.value) }))
    }

    return {
      current,
      baseline,
      change: parseFloat((current - baseline).toFixed(3)),
      region: regionName,
      geoLevel: lookup.geoLevel,
      isNationalFallback: false,
      series,
      ...(nationalSeries ? { nationalSeries } : {}),
    }
  }

  // Primary failed — try national fallback
  if (nationalResult.status === 'fulfilled') {
    const { series, current, baseline, regionName } = buildSeriesFromData(nationalResult.value)
    return {
      current,
      baseline,
      change: parseFloat((current - baseline).toFixed(3)),
      region: 'National avg',
      geoLevel: 'National avg',
      isNationalFallback: true,
      series,
    }
  }

  // Both failed
  throw new Error(
    `EIA gas price fetch failed for ${stateAbbr} (${lookup.duoarea}): ${(primaryResult as PromiseRejectedResult).reason}`
  )
}
