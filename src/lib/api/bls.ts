import type { UnemploymentData, UnemploymentPoint } from '@/types'

const BLS_API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'

// BLS series ID format for county unemployment rate: LAUCN{FIPS}0000000003
// FIPS must be exactly 5 digits (state 2 + county 3)
function buildSeriesId(countyFips: string): string {
  const padded = countyFips.padStart(5, '0')
  return `LAUCN${padded}0000000003`
}

// The January 2025 baseline — lock date for the entire app
const BASELINE_YEAR = '2025'
const BASELINE_PERIOD = 'M01'

// National unemployment rate series
const NATIONAL_UNEMPLOYMENT_SERIES = 'LNS14000000'

export async function fetchUnemployment(
  countyFips: string,
  options: { startYear?: string; endYear?: string } = {}
): Promise<UnemploymentData> {
  const currentYear = new Date().getFullYear().toString()
  const startYear = options.startYear ?? '2016'
  const endYear = options.endYear ?? currentYear

  const seriesId = buildSeriesId(countyFips)

  const body: Record<string, unknown> = {
    seriesid: [seriesId, NATIONAL_UNEMPLOYMENT_SERIES],
    startyear: startYear,
    endyear: endYear,
  }

  // Include API key if available (increases rate limit from 25 to 500 req/day)
  if (process.env.BLS_API_KEY) {
    body.registrationkey = process.env.BLS_API_KEY
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  let json: any
  try {
    const response = await fetch(BLS_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`BLS API error: ${response.status} ${response.statusText}`)
    }

    json = await response.json()
  } finally {
    clearTimeout(timeout)
  }

  if (json.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS API failed: ${json.message?.join(', ') ?? 'unknown error'}`)
  }

  // Index series by seriesID
  const seriesResultMap: Record<string, any[]> = {}
  for (const s of (json.Results?.series ?? [])) {
    seriesResultMap[s.seriesID] = s.data ?? []
  }

  const countyRawData = seriesResultMap[seriesId]
  if (!countyRawData?.length) {
    throw new Error(`No BLS data returned for county FIPS ${countyFips}`)
  }

  // Filter out null/"-" values before processing
  const validData = countyRawData.filter(
    (d: any) => d.value !== '-' && d.value !== null && !isNaN(parseFloat(d.value))
  )

  if (!validData.length) {
    throw new Error(`No valid BLS data returned for county FIPS ${countyFips}`)
  }

  // Sort chronologically (BLS returns newest first)
  const sorted = [...validData].sort((a: any, b: any) => {
    const aDate = `${a.year}-${a.period}`
    const bDate = `${b.year}-${b.period}`
    return aDate.localeCompare(bDate)
  })

  // Find the Jan 2025 baseline value
  const baselineEntry = validData.find(
    (d: any) => d.year === BASELINE_YEAR && d.period === BASELINE_PERIOD
  )
  const baseline = baselineEntry ? parseFloat(baselineEntry.value) : 0

  // Most recent value is current
  const latestEntry = sorted[sorted.length - 1]
  const current = parseFloat(latestEntry.value)

  const points: UnemploymentPoint[] = sorted
    .filter((d: any) => d.value !== '-' && d.value !== null && !isNaN(parseFloat(d.value)))
    .map((d: any) => ({
      date: `${d.year}-${d.period.replace('M', '')}`,
      rate: parseFloat(d.value),
    }))

  // Build national series if available
  let nationalSeries: UnemploymentPoint[] | undefined
  const nationalRawData = seriesResultMap[NATIONAL_UNEMPLOYMENT_SERIES]
  if (nationalRawData?.length) {
    const validNational = nationalRawData.filter(
      (d: any) => d.value !== '-' && d.value !== null && !isNaN(parseFloat(d.value))
    )
    const sortedNational = [...validNational].sort((a: any, b: any) => {
      const aDate = `${a.year}-${a.period}`
      const bDate = `${b.year}-${b.period}`
      return aDate.localeCompare(bDate)
    })
    nationalSeries = sortedNational.map((d: any) => ({
      date: `${d.year}-${d.period.replace('M', '')}`,
      rate: parseFloat(d.value),
    }))
  }

  return {
    current,
    baseline,
    change: parseFloat((current - baseline).toFixed(1)),
    series: points,
    countyFips,
    seriesId,
    ...(nationalSeries ? { nationalSeries } : {}),
  }
}
