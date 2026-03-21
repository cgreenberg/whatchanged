import type { GasPriceData } from '@/types'

const EIA_API_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'

interface DuoareaInfo {
  duoarea: string
  geoLevel: string
}

// States with direct EIA state-level series
const STATE_LEVEL_CODES: Record<string, string> = {
  WA: 'SWA',
  NY: 'SNY',
  OH: 'SOH',
  CA: 'SCA',
  FL: 'SFL',
  MN: 'SMN',
  CO: 'SCO',
  TX: 'STX',
}

// PADD region membership
const PADD_REGIONS: Array<{ code: string; name: string; states: string[] }> = [
  { code: 'R1X', name: 'New England', states: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'] },
  { code: 'R1Y', name: 'Central Atlantic', states: ['DE', 'DC', 'MD', 'NJ', 'PA'] },
  { code: 'R1Z', name: 'Lower Atlantic', states: ['GA', 'NC', 'SC', 'VA', 'WV'] },
  {
    code: 'R20',
    name: 'Midwest',
    states: ['IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MO', 'NE', 'ND', 'SD', 'OK', 'TN', 'WI'],
  },
  { code: 'R30', name: 'Gulf Coast', states: ['AL', 'AR', 'LA', 'MS', 'NM'] },
  { code: 'R40', name: 'Rocky Mountain', states: ['ID', 'MT', 'UT', 'WY'] },
  { code: 'R50', name: 'West Coast', states: ['AK', 'AZ', 'HI', 'NV', 'OR'] },
]

export function stateToEiaDuoarea(stateAbbr: string): DuoareaInfo {
  const upper = stateAbbr.toUpperCase()

  // Check state-level first
  if (STATE_LEVEL_CODES[upper]) {
    return { duoarea: STATE_LEVEL_CODES[upper], geoLevel: 'State-level' }
  }

  // Check PADD regions
  for (const region of PADD_REGIONS) {
    if (region.states.includes(upper)) {
      return { duoarea: region.code, geoLevel: `Regional (${region.name})` }
    }
  }

  // National fallback
  return { duoarea: 'NUS', geoLevel: 'National avg' }
}

const BASELINE_DATE = '2025-01-20'

function buildSeriesFromData(data: any[]): {
  series: Array<{ date: string; price: number }>
  current: number
  baseline: number
  regionName: string
} {
  const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period))

  const series = sorted.map((d) => ({
    date: d.period,
    price: parseFloat(d.value),
  }))

  const current = parseFloat(data[0].value)

  const baselineEntry = sorted.reduce((closest, d) => {
    const diff = Math.abs(new Date(d.period).getTime() - new Date(BASELINE_DATE).getTime())
    const closestDiff = Math.abs(
      new Date(closest.period).getTime() - new Date(BASELINE_DATE).getTime()
    )
    return diff < closestDiff ? d : closest
  })
  const baseline = parseFloat(baselineEntry.value)

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
  const timeout = setTimeout(() => controller.abort(), 10000)
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

export async function fetchGasPrice(stateAbbr: string): Promise<GasPriceData> {
  const { duoarea, geoLevel } = stateToEiaDuoarea(stateAbbr)
  const apiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'

  const isPrimaryNational = duoarea === 'NUS'

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
    fetchEiaData(duoarea, apiKey),
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
      geoLevel,
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
    `EIA gas price fetch failed for ${stateAbbr} (${duoarea}): ${(primaryResult as PromiseRejectedResult).reason}`
  )
}
