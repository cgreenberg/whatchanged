import { estimateTariffCost } from '@/lib/tariff'

// --- Types ---

export interface NationalDataPoint {
  date: string
  value: number
}

export interface NationalMetric {
  current: number
  baseline: number
  change: number // for gas: dollar change; for CPI: percent change
  series: NationalDataPoint[]
}

export interface NationalData {
  gas: NationalMetric
  groceries: NationalMetric
  shelter: NationalMetric
  tariff: { annualCost: number; monthlyCost: number }
}

// --- Constants ---

const EIA_API_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'
const BLS_API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'

const NATIONAL_GROCERIES_SERIES = 'CUUR0000SAF11'
const NATIONAL_SHELTER_SERIES = 'CUUR0000SAH1'

const BASELINE_DATE = '2025-01-20'
const BASELINE_YEAR = '2025'
const BASELINE_PERIOD = 'M01'

const NATIONAL_MEDIAN_INCOME = 80_000

// --- Fallback data ---

const FALLBACK: NationalData = {
  gas: {
    current: 3.5,
    baseline: 3.1,
    change: 0.4,
    series: [
      { date: '2025-01-20', value: 3.1 },
      { date: '2025-04-01', value: 2.95 },
      { date: '2025-07-01', value: 2.9 },
      { date: '2025-10-01', value: 3.2 },
      { date: '2026-01-01', value: 3.6 },
      { date: '2026-03-01', value: 4.0 },
    ],
  },
  groceries: {
    current: 0,
    baseline: 0,
    change: 2.6,
    series: [
      { date: '2025-01', value: 0 },
      { date: '2025-04', value: 0.8 },
      { date: '2025-07', value: 1.2 },
      { date: '2025-10', value: 1.8 },
      { date: '2026-01', value: 2.2 },
      { date: '2026-03', value: 2.6 },
    ],
  },
  shelter: {
    current: 0,
    baseline: 0,
    change: 3.3,
    series: [
      { date: '2025-01', value: 0 },
      { date: '2025-04', value: 0.9 },
      { date: '2025-07', value: 1.5 },
      { date: '2025-10', value: 2.2 },
      { date: '2026-01', value: 2.8 },
      { date: '2026-03', value: 3.3 },
    ],
  },
  tariff: { annualCost: 1640, monthlyCost: 137 },
}

// --- EIA gas fetch (NUS = national) ---

async function fetchNationalGas(): Promise<NationalMetric> {
  const apiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'

  const params = new URLSearchParams({
    api_key: apiKey,
    frequency: 'weekly',
    'data[0]': 'value',
    'facets[product][]': 'EPM0',
    'facets[duoarea][]': 'NUS',
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    length: '520',
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  let json: any
  try {
    const response = await fetch(`${EIA_API_BASE}?${params.toString()}`, {
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`EIA API error: ${response.status} ${response.statusText}`)
    }
    json = await response.json()
  } finally {
    clearTimeout(timeout)
  }

  const raw: any[] = json?.response?.data ?? []
  if (!raw.length) {
    throw new Error('No EIA national gas data returned')
  }

  // Filter and sort chronologically
  const sorted = [...raw]
    .filter(
      (d) =>
        d.value !== null &&
        d.value !== '--' &&
        !isNaN(parseFloat(d.value))
    )
    .sort((a, b) => a.period.localeCompare(b.period))

  if (!sorted.length) {
    throw new Error('No valid EIA national gas data')
  }

  const series: NationalDataPoint[] = sorted.map((d) => ({
    date: d.period,
    value: parseFloat(d.value),
  }))

  const current = series[series.length - 1].value

  // Baseline: closest data point on or before Jan 20, 2025
  const baselineTime = new Date(BASELINE_DATE).getTime()
  const onOrBefore = series.filter((d) => new Date(d.date).getTime() <= baselineTime)
  const baseline = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1].value : series[0].value

  const change = parseFloat((current - baseline).toFixed(3))

  return { current, baseline, change, series }
}

// --- BLS CPI fetch (groceries + shelter) ---

interface CpiMetrics {
  groceries: NationalMetric
  shelter: NationalMetric
}

async function fetchNationalCpi(): Promise<CpiMetrics> {
  const currentYear = new Date().getFullYear().toString()

  const body: Record<string, unknown> = {
    seriesid: [NATIONAL_GROCERIES_SERIES, NATIONAL_SHELTER_SERIES],
    startyear: '2016',
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
      throw new Error(`BLS API error: ${response.status} ${response.statusText}`)
    }
    json = await response.json()
  } finally {
    clearTimeout(timeout)
  }

  if (json.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS API failed: ${json.message?.join(', ') ?? 'unknown error'}`)
  }

  const seriesArray = json.Results?.series
  if (!seriesArray?.length) {
    throw new Error('No BLS CPI data returned')
  }

  const seriesMap: Record<string, any[]> = {}
  for (const s of seriesArray) {
    seriesMap[s.seriesID] = s.data ?? []
  }

  function buildPeriodMap(data: any[]): Map<string, number> {
    const map = new Map<string, number>()
    for (const d of data) {
      const val = parseFloat(d.value)
      if (isNaN(val) || d.value === '-') continue
      const key = `${d.year}-${d.period}` // e.g. "2025-M03"
      map.set(key, val)
    }
    return map
  }

  function buildMetric(data: any[]): NationalMetric {
    const periodMap = buildPeriodMap(data)

    // Sort keys chronologically
    const sortedKeys = [...periodMap.keys()].sort()

    if (!sortedKeys.length) {
      throw new Error('No CPI data points after filtering')
    }

    const baselineKey = `${BASELINE_YEAR}-${BASELINE_PERIOD}` // "2025-M01"
    const baselineRaw = periodMap.get(baselineKey)

    if (baselineRaw === undefined) {
      throw new Error('Missing Jan 2025 CPI baseline')
    }

    const latestKey = sortedKeys[sortedKeys.length - 1]
    const currentRaw = periodMap.get(latestKey) ?? 0

    const change =
      baselineRaw > 0
        ? parseFloat(((currentRaw - baselineRaw) / baselineRaw * 100).toFixed(1))
        : 0

    // Build series as % change from baseline
    const series: NationalDataPoint[] = sortedKeys.map((key) => {
      const [year, period] = key.split('-')
      const month = period.replace('M', '').padStart(2, '0')
      const rawVal = periodMap.get(key) ?? 0
      const pctChange =
        baselineRaw > 0
          ? parseFloat(((rawVal - baselineRaw) / baselineRaw * 100).toFixed(1))
          : 0
      return { date: `${year}-${month}`, value: pctChange }
    })

    return { current: currentRaw, baseline: baselineRaw, change, series }
  }

  const groceriesData = seriesMap[NATIONAL_GROCERIES_SERIES] ?? []
  const shelterData = seriesMap[NATIONAL_SHELTER_SERIES] ?? []

  if (!groceriesData.length) {
    throw new Error('No national groceries CPI data returned')
  }

  return {
    groceries: buildMetric(groceriesData),
    shelter: shelterData.length ? buildMetric(shelterData) : FALLBACK.shelter,
  }
}

// --- Main fetch function ---

export async function fetchNationalData(): Promise<NationalData> {
  try {
    const [gasResult, cpiResult] = await Promise.allSettled([
      fetchNationalGas(),
      fetchNationalCpi(),
    ])

    const gas = gasResult.status === 'fulfilled' ? gasResult.value : FALLBACK.gas
    const groceries =
      cpiResult.status === 'fulfilled' ? cpiResult.value.groceries : FALLBACK.groceries
    const shelter =
      cpiResult.status === 'fulfilled' ? cpiResult.value.shelter : FALLBACK.shelter

    const annualCost = estimateTariffCost(NATIONAL_MEDIAN_INCOME)
    const monthlyCost = Math.round(annualCost / 12)

    return { gas, groceries, shelter, tariff: { annualCost, monthlyCost } }
  } catch {
    return FALLBACK
  }
}

// --- Module-level cache ---

let nationalCache: { data: NationalData; fetchedAt: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000

export async function getCachedNationalData(): Promise<NationalData> {
  if (nationalCache && Date.now() - nationalCache.fetchedAt < CACHE_TTL_MS) {
    return nationalCache.data
  }
  const data = await fetchNationalData()
  nationalCache = { data, fetchedAt: Date.now() }
  return data
}
