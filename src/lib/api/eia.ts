import type { GasPriceData } from '@/types'

const EIA_API_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'

const BASELINE_DATE = '2025-01-20'

const STATE_TO_PAD: Record<string, number> = {
  // PAD 1 — East Coast
  ME: 1, NH: 1, VT: 1, MA: 1, RI: 1, CT: 1, NY: 1, NJ: 1, PA: 1,
  DE: 1, MD: 1, DC: 1, VA: 1, WV: 1, NC: 1, SC: 1, GA: 1, FL: 1,
  // PAD 2 — Midwest
  OH: 2, MI: 2, IN: 2, IL: 2, WI: 2, MN: 2, IA: 2, MO: 2, ND: 2,
  SD: 2, NE: 2, KS: 2, KY: 2,
  // PAD 3 — Gulf Coast
  TX: 3, LA: 3, MS: 3, AL: 3, AR: 3, TN: 3, NM: 3, OK: 3,
  // PAD 4 — Rocky Mountain
  MT: 4, ID: 4, WY: 4, CO: 4, UT: 4,
  // PAD 5 — West Coast
  WA: 5, OR: 5, CA: 5, NV: 5, AZ: 5, AK: 5, HI: 5,
}

const PAD_NAMES: Record<number, string> = {
  1: 'East Coast',
  2: 'Midwest',
  3: 'Gulf Coast',
  4: 'Rocky Mountain',
  5: 'West Coast',
}

interface DuoareaInfo {
  duoarea: string
  geoLevel: string
  padDistrict: number
}

export function stateToEiaDuoarea(stateAbbr: string): DuoareaInfo {
  const upper = stateAbbr.toUpperCase()
  const pad = STATE_TO_PAD[upper]

  if (pad !== undefined) {
    const duoarea = `R${pad}0`
    const geoLevel = `PAD District ${pad} (${PAD_NAMES[pad]})`
    return { duoarea, geoLevel, padDistrict: pad }
  }

  // National fallback for unmapped states/territories
  return { duoarea: 'NUS', geoLevel: 'National avg', padDistrict: 0 }
}

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

  // Fetch regional + national in parallel
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

  // Regional failed — try national fallback
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
