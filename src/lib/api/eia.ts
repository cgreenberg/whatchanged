import type { GasPriceData } from '@/types'

const EIA_API_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'

// EIA region codes based on US census region
const STATE_TO_EIA_REGION: Record<string, string> = {
  // New England
  CT: 'R1X',
  ME: 'R1X',
  MA: 'R1X',
  NH: 'R1X',
  RI: 'R1X',
  VT: 'R1X',
  // Central Atlantic
  DE: 'R2X',
  MD: 'R2X',
  NJ: 'R2X',
  NY: 'R2X',
  PA: 'R2X',
  DC: 'R2X',
  // Lower Atlantic
  FL: 'R3X',
  GA: 'R3X',
  NC: 'R3X',
  SC: 'R3X',
  VA: 'R3X',
  WV: 'R3X',
  // Midwest
  IL: 'PAD2',
  IN: 'PAD2',
  IA: 'PAD2',
  KS: 'PAD2',
  KY: 'PAD2',
  MI: 'PAD2',
  MN: 'PAD2',
  MO: 'PAD2',
  NE: 'PAD2',
  ND: 'PAD2',
  OH: 'PAD2',
  SD: 'PAD2',
  TN: 'PAD2',
  WI: 'PAD2',
  // Gulf Coast
  AL: 'PAD3',
  AR: 'PAD3',
  LA: 'PAD3',
  MS: 'PAD3',
  NM: 'PAD3',
  OK: 'PAD3',
  TX: 'PAD3',
  // Rocky Mountain
  CO: 'PAD4',
  ID: 'PAD4',
  MT: 'PAD4',
  UT: 'PAD4',
  WY: 'PAD4',
  // West Coast
  AK: 'PAD5',
  AZ: 'PAD5',
  CA: 'PAD5',
  HI: 'PAD5',
  NV: 'PAD5',
  OR: 'PAD5',
  WA: 'PAD5',
}

export function stateToEiaRegion(stateAbbr: string): string {
  return STATE_TO_EIA_REGION[stateAbbr.toUpperCase()] ?? 'PAD2'
}

const BASELINE_DATE = '2025-01-20'

export async function fetchGasPrice(stateAbbr: string): Promise<GasPriceData> {
  const region = stateToEiaRegion(stateAbbr)

  const params = new URLSearchParams({
    frequency: 'weekly',
    'data[0]': 'value',
    'facets[product][]': 'EPM0',
    'facets[duoarea][]': region,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    length: '260',
  })

  const url = `${EIA_API_BASE}?${params.toString()}`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`EIA API error: ${response.status} ${response.statusText}`)
  }

  const json = await response.json()

  const data: any[] = json?.response?.data ?? []

  if (!data.length) {
    throw new Error(`No EIA gas price data returned for region ${region}`)
  }

  // Data comes back newest first (sorted desc)
  // Build series sorted chronologically
  const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period))

  const series = sorted.map((d) => ({
    date: d.period,
    price: parseFloat(d.value),
  }))

  // Most recent price is current
  const current = parseFloat(data[0].value)

  // Find baseline: closest weekly reading to Jan 20 2025
  const baselineEntry = sorted.reduce((closest, d) => {
    const diff = Math.abs(new Date(d.period).getTime() - new Date(BASELINE_DATE).getTime())
    const closestDiff = Math.abs(
      new Date(closest.period).getTime() - new Date(BASELINE_DATE).getTime()
    )
    return diff < closestDiff ? d : closest
  })
  const baseline = parseFloat(baselineEntry.value)

  // Region name from area-name field if available
  const regionName = data[0]['area-name'] ?? region

  return {
    current,
    baseline,
    change: parseFloat((current - baseline).toFixed(3)),
    region: regionName,
    series,
  }
}
