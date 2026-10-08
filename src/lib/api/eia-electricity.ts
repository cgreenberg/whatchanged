// EIA average residential electricity price by state (Electricity Data Browser / Form EIA-861M):
// API v2 route electricity/retail-sales, sectorid RES, monthly, fields price (¢/kWh), sales
// (million kWh) and customers. One series per state (50 + DC) plus the U.S. average ('US').
// EIA publishes nothing for Puerto Rico or the other territories.
//
// Seasonality: residential prices swing with the seasons (many utilities charge more per kWh in
// summer; Georgia's July price runs ~17% above its January price in a typical year), so comparing
// one month with another mostly measures the calendar. The headline therefore compares 12-MONTH
// AVERAGE prices: the average of the latest 12 published monthly prices vs the average of the 12
// months CENTERED on January 2025 (Aug 2024 – Jul 2025). Every season is in both windows, so no
// seasonal model is needed and nothing is revised when a new month is published (the baseline
// window is fixed). The big number is the latest 12-month average price.
//
// Why a centered baseline window: a window ENDING Jan 2025 (Feb 2024 – Jan 2025) is centered on ~Aug 2024,
// so about five months of the measured change happened before Jan 2025. A 12-month window can't be centered
// exactly on Jan 20; of the two candidates, Jul 2024 – Jun 2025 has its midpoint at ~Jan 1, 2025 (19 days
// before Jan 20) and Aug 2024 – Jul 2025 at ~Jan 30, 2025 (10 days after), so Aug 2024 – Jul 2025 is used.
//
// The graph's 12-month average line is plotted at each window's CENTER month (window t−5 … t+6 at month t),
// so the point at Jan 2025 is the baseline and the line's last point (6 months before the latest month) is the
// latest 12-month average — the card's two numbers sit on the line.
//
// Dollars: (12-mo average price now − 12-mo average price in the baseline window) × the state's
// average residential use per customer per month over the latest 12 complete months
// (sales ÷ customers) — a stable, non-seasonal usage figure.

import {
  BASELINE_MONTH, ELECTRICITY_BASELINE_FROM, ELECTRICITY_BASELINE_TO, ELECTRICITY_CENTER_LAG, electricityCenterOf,
} from '@/lib/baseline'

export const EIA_ELECTRICITY_API = 'https://api.eia.gov/v2/electricity/retail-sales/data/'
/** First month fetched: a 10-year graph whose 12-month average line starts with the graph (2016-01 needs 2015-02). */
export const ELECTRICITY_SERIES_START = '2015-01'
/** First month kept in the cached/charted series (the graph's 10Y window needs ~2016-07). */
export const ELECTRICITY_CHART_START = '2016-01'
/** Months in each averaging window. */
export const ELECTRICITY_AVG_MONTHS = 12
/** Marks payloads computed with the centered-baseline 12-month-average method (older cached payloads → refetched). */
export const ELECTRICITY_METHOD = 'avg12c' as const
/** Baseline window: the 12 months centered on Jan 2025 (midpoint ~Jan 30, 2025; see the header and baseline.ts). */
export { ELECTRICITY_BASELINE_FROM, ELECTRICITY_BASELINE_TO }
export { ELECTRICITY_CENTER_LAG, electricityCenterOf }
export const ELECTRICITY_TIMEOUT_MS = 10_000
/** EIA API v2 returns at most 5,000 rows per request. */
export const EIA_MAX_ROWS = 5000

export const ELECTRICITY_KEY_PREFIX = 'eia:electricity'
export const NATIONAL_ELECTRICITY = 'US'
export const electricityCacheKey = (state: string) => `${ELECTRICITY_KEY_PREFIX}:${state.toUpperCase()}`

/** States EIA publishes a residential retail price for: the 50 states + DC (and 'US' for the national average). */
export const ELECTRICITY_STATES = [
  'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA', 'ID', 'IL', 'IN', 'KS',
  'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV',
  'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY',
] as const

export function hasElectricitySeries(state: string | null | undefined): boolean {
  return !!state && (ELECTRICITY_STATES as readonly string[]).includes(state.toUpperCase())
}

/** EIA's legacy series id (also the Electricity Data Browser's), e.g. ELEC.PRICE.ME-RES.M. */
export const electricitySeriesId = (state: string) => `ELEC.PRICE.${state.toUpperCase()}-RES.M`

/** Sanity ranges: price ¢/kWh, % change since Jan 2025, kWh per customer per month. */
export const ELECTRICITY_PRICE_RANGE = [5, 60] as const
export const ELECTRICITY_CHANGE_RANGE = [-50, 100] as const
export const ELECTRICITY_USAGE_RANGE = [100, 3000] as const

export interface ElectricityPoint {
  date: string // YYYY-MM
  /** Published average residential price, ¢/kWh (null: month not published). */
  price: number | null
  /**
   * Average of the 12 published monthly prices CENTERED on this month (this month − 5 … + 6), ¢/kWh; null when a
   * month is missing or not yet published (the last 6 months of the series).
   */
  avg12: number | null
}

export interface ElectricitySeriesData {
  state: string // 'ME' … or 'US'
  stateName: string
  seriesId: string
  method: typeof ELECTRICITY_METHOD
  /** Average price over the latest 12 published months (¢/kWh): `currentFrom`…`latestPeriod`. The big number. */
  current: number
  currentFrom: string
  latestPeriod: string
  /** Average price over the 12 months centered on Jan 2025 (¢/kWh): `baselineFrom`…`baselinePeriod` (Aug 2024–Jul 2025). */
  baseline: number
  baselineFrom: string
  baselinePeriod: string
  /** % change of the 12-month average price (the headline). */
  change: number
  /** Published price in the latest month and in Jan 2025 (¢/kWh), shown in the ⓘ. */
  latestMonthPrice: number
  baselineMonthPrice: number
  /** Average residential use, kWh per customer per month, over `usageFrom`…`usageTo` (12 complete months). */
  usageKwh: number | null
  usageFrom?: string
  usageTo?: string
  /** Monthly series since ELECTRICITY_CHART_START (published price + centered 12-month average). */
  series: ElectricityPoint[]
}

export interface EiaElectricityRow {
  period: string
  stateid: string
  stateDescription?: string
  price?: string | number | null
  sales?: string | number | null
  customers?: string | number | null
  [key: string]: unknown
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || v === '--') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** YYYY-MM months from `first` to `last` inclusive. */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = []
  let [y, m] = first.split('-').map(Number)
  const [ly, lm] = last.split('-').map(Number)
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { y++; m = 1 }
  }
  return out
}

/** Trailing average of the `n` values ending at each index (null when any of them is missing). */
export function trailingAverage(values: Array<number | null>, n: number = ELECTRICITY_AVG_MONTHS): Array<number | null> {
  return values.map((_, i) => {
    if (i < n - 1) return null
    const win = values.slice(i - n + 1, i + 1)
    return win.every((v): v is number => v !== null) ? win.reduce((x, y) => x + y, 0) / n : null
  })
}

/** kWh per customer per month over the latest 12 consecutive months with both sales and customers. */
export function averageUsage(
  months: string[],
  sales: Array<number | null>,
  customers: Array<number | null>,
): { kwh: number; from: string; to: string } | null {
  const per = months.map((_, i) => {
    const s = sales[i]
    const c = customers[i]
    return s !== null && c !== null && s > 0 && c > 0 ? (s * 1e6) / c : null
  })
  for (let end = months.length - 1; end >= 11 && end >= months.length - 24; end--) {
    const win = per.slice(end - 11, end + 1)
    if (win.every((v): v is number => v !== null)) {
      return { kwh: win.reduce((a, b) => a + b, 0) / 12, from: months[end - 11], to: months[end] }
    }
  }
  return null
}

const round = (v: number, d: number) => {
  const r = Number(v.toFixed(d))
  return Object.is(r, -0) ? 0 : r
}

/**
 * Pure parser (exported for tests): EIA rows for ONE state (any order) → series data.
 * Throws when the state lacks a complete baseline window (Aug 2024–Jul 2025) or a complete latest 12 months.
 */
export function buildElectricitySeries(rows: EiaElectricityRow[], state: string): ElectricitySeriesData {
  const st = state.toUpperCase()
  const mine = rows.filter((r) => r && typeof r.period === 'string' && String(r.stateid).toUpperCase() === st)
  const byPeriod = new Map(mine.map((r) => [r.period.slice(0, 7), r]))
  const priced = [...byPeriod.entries()].filter(([, r]) => num(r.price) !== null).map(([p]) => p).sort()
  if (!priced.length) throw new Error(`No EIA residential electricity price for ${st}`)
  const months = monthRange(priced[0], priced[priced.length - 1])
  const price = months.map((m) => num(byPeriod.get(m)?.price))
  const avg12 = trailingAverage(price)

  const ji = months.indexOf(BASELINE_MONTH)
  if (ji < 0 || price[ji] === null) throw new Error(`No Jan 2025 EIA electricity price for ${st}`)
  const bi = months.indexOf(ELECTRICITY_BASELINE_TO) // window ELECTRICITY_BASELINE_FROM…ELECTRICITY_BASELINE_TO
  if (bi < 0 || avg12[bi] === null) throw new Error(`No complete 12 months of EIA electricity prices centered on Jan 2025 for ${st}`)
  let li = months.length - 1
  while (li >= 0 && price[li] === null) li--
  if (li <= bi) throw new Error(`No EIA electricity price after ${ELECTRICITY_BASELINE_TO} for ${st}`)
  if (avg12[li] === null) throw new Error(`No complete latest 12 months of EIA electricity prices for ${st}`)

  const usage = averageUsage(
    months,
    months.map((m) => num(byPeriod.get(m)?.sales)),
    months.map((m) => num(byPeriod.get(m)?.customers)),
  )
  const baseline = round(avg12[bi]!, 3)
  const current = round(avg12[li]!, 3)
  const first = mine.find((r) => typeof r.stateDescription === 'string')
  const start = Math.max(0, months.indexOf(ELECTRICITY_CHART_START))
  return {
    state: st,
    stateName: st === NATIONAL_ELECTRICITY ? 'U.S.' : (first?.stateDescription as string | undefined) ?? st,
    seriesId: electricitySeriesId(st),
    method: ELECTRICITY_METHOD,
    current,
    currentFrom: months[li - ELECTRICITY_AVG_MONTHS + 1],
    latestPeriod: months[li],
    baseline,
    baselineFrom: months[bi - ELECTRICITY_AVG_MONTHS + 1],
    baselinePeriod: months[bi],
    change: round(((current - baseline) / baseline) * 100, 2),
    latestMonthPrice: price[li]!,
    baselineMonthPrice: price[ji]!,
    usageKwh: usage ? round(usage.kwh, 1) : null,
    ...(usage ? { usageFrom: usage.from, usageTo: usage.to } : {}),
    series: months.slice(start, li + 1).map((date, k) => {
      // centered: the window ending 6 months later (null past the latest complete window)
      const w = start + k + ELECTRICITY_CENTER_LAG
      const v = w <= li ? avg12[w] : null
      return { date, price: price[start + k], avg12: v === null ? null : round(v, 3) }
    }),
  }
}

/** Parse a multi-state response into one series per requested state; failures are returned per state. */
export function buildElectricityByState(
  rows: EiaElectricityRow[],
  states: readonly string[],
): Record<string, ElectricitySeriesData | Error> {
  const out: Record<string, ElectricitySeriesData | Error> = {}
  for (const st of states) {
    try {
      out[st] = buildElectricitySeries(rows, st)
    } catch (e) {
      out[st] = e instanceof Error ? e : new Error(String(e))
    }
  }
  return out
}

// --- Fetching ----------------------------------------------------------------

function query(states: readonly string[], apiKey: string, offset: number): string {
  const p = new URLSearchParams({
    api_key: apiKey,
    frequency: 'monthly',
    'data[0]': 'price',
    'data[1]': 'sales',
    'data[2]': 'customers',
    'facets[sectorid][]': 'RES',
    start: ELECTRICITY_SERIES_START,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'asc',
    'sort[1][column]': 'stateid',
    'sort[1][direction]': 'asc',
    offset: String(offset),
    length: String(EIA_MAX_ROWS),
  })
  for (const st of states) p.append('facets[stateid][]', st)
  return p.toString()
}

async function fetchPage(states: readonly string[], apiKey: string, offset: number, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${EIA_ELECTRICITY_API}?${query(states, apiKey, offset)}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`EIA electricity API error: ${res.status} ${res.statusText}`)
    const json = await res.json()
    const data: EiaElectricityRow[] = json?.response?.data ?? []
    const total = Number(json?.response?.total ?? data.length)
    return { data, total: Number.isFinite(total) ? total : data.length }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch residential price/sales/customers for these states since ELECTRICITY_SERIES_START, paging
 * past EIA's 5,000-row limit (all 51 states + US ≈ 7,900 rows → 2 requests). Returns the rows and
 * the number of requests made.
 */
export async function fetchElectricityRows(
  states: readonly string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ rows: EiaElectricityRow[]; requests: number }> {
  const apiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'
  const timeoutMs = opts.timeoutMs ?? ELECTRICITY_TIMEOUT_MS
  const rows: EiaElectricityRow[] = []
  let requests = 0
  let total = Infinity
  while (rows.length < total) {
    const page = await fetchPage(states, apiKey, rows.length, timeoutMs)
    requests++
    total = page.total
    if (!page.data.length) break
    rows.push(...page.data)
    if (requests > 10) throw new Error('EIA electricity paging did not finish')
  }
  if (!rows.length) throw new Error(`No EIA electricity data returned for ${states.join(',')}`)
  return { rows, requests }
}

/** Runtime cache miss: one state (or 'US'), one request (~150 rows). */
export async function fetchElectricitySeries(state: string, opts: { timeoutMs?: number } = {}): Promise<ElectricitySeriesData> {
  const { rows } = await fetchElectricityRows([state.toUpperCase()], opts)
  return buildElectricitySeries(rows, state)
}
