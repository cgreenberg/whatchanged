import type { GasPriceData } from '@/types'

const EIA_API_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'

export function stateToEiaDuoarea(stateAbbr: string): string {
  return `S${stateAbbr.toUpperCase()}`
}

const BASELINE_DATE = '2025-01-20'

export async function fetchGasPrice(stateAbbr: string): Promise<GasPriceData> {
  const duoarea = stateToEiaDuoarea(stateAbbr)
  const apiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'

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

  const url = `${EIA_API_BASE}?${params.toString()}`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`EIA API error: ${response.status} ${response.statusText}`)
  }

  const json = await response.json()

  const data: any[] = json?.response?.data ?? []

  if (!data.length) {
    throw new Error(`No EIA gas price data returned for duoarea ${duoarea}`)
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
  const regionName = data[0]['area-name'] ?? duoarea

  // Fetch national gas prices for comparison
  let nationalSeries: Array<{ date: string; price: number }> | undefined
  try {
    const nationalParams = new URLSearchParams({
      api_key: apiKey,
      frequency: 'weekly',
      'data[0]': 'value',
      'facets[product][]': 'EPM0',
      'facets[duoarea][]': 'NUS',
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      length: '260',
    })
    const nationalRes = await fetch(`${EIA_API_BASE}?${nationalParams.toString()}`)
    if (nationalRes.ok) {
      const nationalJson = await nationalRes.json()
      const nationalData: any[] = nationalJson?.response?.data ?? []
      if (nationalData.length) {
        nationalSeries = [...nationalData]
          .sort((a, b) => a.period.localeCompare(b.period))
          .map(d => ({ date: d.period, price: parseFloat(d.value) }))
      }
    }
  } catch {
    // Silently skip national data if it fails
  }

  return {
    current,
    baseline,
    change: parseFloat((current - baseline).toFixed(3)),
    region: regionName,
    series,
    ...(nationalSeries ? { nationalSeries } : {}),
  }
}
