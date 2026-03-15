import type { CpiData, CpiPoint } from '@/types'

const BLS_API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'

const GROCERIES_SERIES = 'CUUR0000SAF11'
const SHELTER_SERIES = 'CUUR0000SAH1'
const ENERGY_SERIES = 'CUUR0000SA0E'

const BASELINE_YEAR = '2025'
const BASELINE_PERIOD = 'M01'

export async function fetchCpi(): Promise<CpiData> {
  const currentYear = new Date().getFullYear().toString()

  const body: Record<string, unknown> = {
    seriesid: [GROCERIES_SERIES, SHELTER_SERIES, ENERGY_SERIES],
    startyear: '2020',
    endyear: currentYear,
  }

  if (process.env.BLS_API_KEY) {
    body.registrationkey = process.env.BLS_API_KEY
  }

  const response = await fetch(BLS_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`BLS CPI API error: ${response.status} ${response.statusText}`)
  }

  const json = await response.json()

  if (json.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS CPI API failed: ${json.message?.join(', ') ?? 'unknown error'}`)
  }

  const seriesArray = json.Results?.series
  if (!seriesArray?.length) {
    throw new Error('No BLS CPI data returned')
  }

  // Index series by seriesID
  const seriesMap: Record<string, any[]> = {}
  for (const s of seriesArray) {
    seriesMap[s.seriesID] = s.data ?? []
  }

  const groceriesData = seriesMap[GROCERIES_SERIES] ?? []
  const shelterData = seriesMap[SHELTER_SERIES] ?? []
  const energyData = seriesMap[ENERGY_SERIES] ?? []

  if (!groceriesData.length) {
    throw new Error('No groceries CPI data returned')
  }

  // Build a map of period -> value for each series (keyed by "YYYY-MM")
  function buildPeriodMap(data: any[]): Map<string, number> {
    const map = new Map<string, number>()
    for (const d of data) {
      const key = `${d.year}-${d.period}`
      map.set(key, parseFloat(d.value))
    }
    return map
  }

  const groceriesMap = buildPeriodMap(groceriesData)
  const shelterMap = buildPeriodMap(shelterData)
  const energyMap = buildPeriodMap(energyData)

  // Collect all unique period keys from groceries (primary series)
  const allPeriods = [...groceriesMap.keys()].sort()

  // Build series points
  const series: CpiPoint[] = allPeriods.map((key) => {
    const [year, period] = key.split('-')
    const month = period.replace('M', '').padStart(2, '0')
    return {
      date: `${year}-${month}`,
      groceries: groceriesMap.get(key) ?? 0,
      shelter: shelterMap.get(key) ?? 0,
      energy: energyMap.get(key) ?? 0,
    }
  })

  // Most recent is current
  const latestKey = allPeriods[allPeriods.length - 1]
  const groceriesCurrent = groceriesMap.get(latestKey) ?? 0

  // Find Jan 2025 baseline
  const baselineKey = `${BASELINE_YEAR}-${BASELINE_PERIOD}`
  const groceriesBaseline = groceriesMap.get(baselineKey) ?? 0

  return {
    groceriesCurrent,
    groceriesBaseline,
    groceriesChange: parseFloat((groceriesCurrent - groceriesBaseline).toFixed(3)),
    series,
    metro: 'National',
  }
}
