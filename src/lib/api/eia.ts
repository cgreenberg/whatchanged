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

const BASELINE_DATE = '2025-01-20'

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
      duoarea: PAD_DUOAREA[pad] ?? `R${pad}0`,
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
      duoarea: 'NUS',
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
        .filter((d) => d.value !== null && d.value !== '--' && !isNaN(parseFloat(d.value)))
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
      duoarea: lookup.duoarea,
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
      duoarea: 'NUS',
      series,
    }
  }

  // Both failed
  throw new Error(
    `EIA gas price fetch failed for ${stateAbbr} (${lookup.duoarea}): ${(primaryResult as PromiseRejectedResult).reason}`
  )
}
