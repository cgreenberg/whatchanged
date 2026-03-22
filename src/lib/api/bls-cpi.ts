import type { CpiData, CpiPoint } from '@/types'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'

const BLS_API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'

const BASELINE_YEAR = '2025'
const BASELINE_PERIOD = 'M01'

// National CPI series
const NATIONAL_GROCERIES_SERIES = 'CUUR0000SAF11'
const NATIONAL_SHELTER_SERIES = 'CUUR0000SAH1'
const NATIONAL_ENERGY_SERIES = 'CUUR0000SA0E'

export async function fetchCpi(countyFips: string, stateAbbr: string): Promise<CpiData> {
  const { areaCode, areaName } = getMetroCpiAreaForCounty(countyFips, stateAbbr)

  const groceriesSeries = `CUUR${areaCode}SAF11`
  const shelterSeries = `CUUR${areaCode}SAH1`
  const energySeries = `CUUR${areaCode}SA0E`

  const currentYear = new Date().getFullYear().toString()

  // Collect all 6 series (3 metro + 3 national); deduplicate if metro == national
  const allSeriesIds = [...new Set([
    groceriesSeries, shelterSeries, energySeries,
    NATIONAL_GROCERIES_SERIES, NATIONAL_SHELTER_SERIES, NATIONAL_ENERGY_SERIES,
  ])]

  const body: Record<string, unknown> = {
    seriesid: allSeriesIds,
    startyear: '2020',
    endyear: currentYear,
  }

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
      throw new Error(`BLS CPI API error: ${response.status} ${response.statusText}`)
    }

    json = await response.json()
  } finally {
    clearTimeout(timeout)
  }

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

  const groceriesData = seriesMap[groceriesSeries] ?? []
  const shelterData = seriesMap[shelterSeries] ?? []
  const energyData = seriesMap[energySeries] ?? []

  if (!groceriesData.length) {
    throw new Error('No groceries CPI data returned')
  }

  // Build a map of period -> value for each series (keyed by "YYYY-Period")
  // Skip entries where value is "-" or not parseable
  function buildPeriodMap(data: any[]): Map<string, number> {
    const map = new Map<string, number>()
    for (const d of data) {
      const val = parseFloat(d.value)
      if (isNaN(val) || d.value === '-') continue
      const key = `${d.year}-${d.period}`
      map.set(key, val)
    }
    return map
  }

  const groceriesMap = buildPeriodMap(groceriesData)
  const shelterMap = buildPeriodMap(shelterData)
  const energyMap = buildPeriodMap(energyData)

  // Collect all unique period keys from groceries (primary series), sorted chronologically
  const allPeriods = [...groceriesMap.keys()].sort()

  // Build series points, skipping any point where the primary value is missing/null
  const series: CpiPoint[] = allPeriods
    .map((key) => {
      const [year, period] = key.split('-')
      const month = period.replace('M', '').padStart(2, '0')
      const g = groceriesMap.get(key)
      const s = shelterMap.get(key)
      const e = energyMap.get(key)
      // Skip if primary (groceries) value is missing
      if (g === undefined || g === null || isNaN(g)) return null
      return {
        date: `${year}-${month}`,
        groceries: g,
        shelter: s ?? null,
        energy: e ?? null,
      }
    })
    .filter((p): p is CpiPoint => p !== null)

  // Most recent is current
  const latestKey = allPeriods[allPeriods.length - 1]
  const groceriesCurrent = groceriesMap.get(latestKey) ?? 0

  // Find Jan 2025 baseline
  const baselineKey = `${BASELINE_YEAR}-${BASELINE_PERIOD}`
  const groceriesBaseline = groceriesMap.get(baselineKey) ?? 0

  // Bug 1 fix: calculate as PERCENTAGE change, not raw index difference
  const groceriesChange = groceriesBaseline > 0
    ? parseFloat(((groceriesCurrent - groceriesBaseline) / groceriesBaseline * 100).toFixed(1))
    : 0

  const shelterBaseline = shelterMap.get(baselineKey) ?? 0
  const shelterCurrent = shelterMap.get(latestKey) ?? 0
  const shelterChange = shelterBaseline > 0
    ? parseFloat(((shelterCurrent - shelterBaseline) / shelterBaseline * 100).toFixed(1))
    : 0

  // Build national series (only if it's different from metro series)
  let nationalSeries: CpiPoint[] | undefined
  const isNational = areaCode === '0000'

  if (!isNational) {
    const natGroceriesData = seriesMap[NATIONAL_GROCERIES_SERIES] ?? []
    const natShelterData = seriesMap[NATIONAL_SHELTER_SERIES] ?? []
    const natEnergyData = seriesMap[NATIONAL_ENERGY_SERIES] ?? []

    const natGroceriesMap = buildPeriodMap(natGroceriesData)
    const natShelterMap = buildPeriodMap(natShelterData)
    const natEnergyMap = buildPeriodMap(natEnergyData)

    const natPeriods = [...natGroceriesMap.keys()].sort()

    nationalSeries = natPeriods
      .map((key) => {
        const [year, period] = key.split('-')
        const month = period.replace('M', '').padStart(2, '0')
        const g = natGroceriesMap.get(key)
        const s = natShelterMap.get(key)
        const e = natEnergyMap.get(key)
        if (g === undefined || g === null || isNaN(g)) return null
        return {
          date: `${year}-${month}`,
          groceries: g,
          shelter: s ?? null,
          energy: e ?? null,
        }
      })
      .filter((p): p is CpiPoint => p !== null)
  }

  return {
    groceriesCurrent,
    groceriesBaseline,
    groceriesChange,
    shelterChange,
    series,
    metro: areaName,
    seriesIds: {
      groceries: groceriesSeries,
      shelter: shelterSeries,
      energy: energySeries,
    },
    ...(nationalSeries ? { nationalSeries } : {}),
  }
}
