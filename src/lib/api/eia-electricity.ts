// EIA average residential electricity price by state (Electricity Data Browser / Form EIA-861M):
// API v2 route electricity/retail-sales, sectorid RES, monthly, fields price (¢/kWh), sales
// (million kWh) and customers. One series per state (50 + DC) plus the U.S. average ('US').
// EIA publishes nothing for Puerto Rico or the other territories.
//
// Seasonality: residential prices swing with the seasons (many utilities charge more per kWh in
// summer; Georgia's July price runs ~17% above its January price in a typical year), so a raw
// "Jan 2025 → latest month" comparison mostly measures the calendar. The headline change compares
// SEASONALLY ADJUSTED prices: classical decomposition (centered 2×12 moving average, per-month
// median ratio over 2014–2024, normalized to average 1), the same method whatchanged uses for
// Zillow rents. The factors are fit on data through Dec 2024 only, so they never move once a new
// month is published and the Jan 2025 baseline stays fixed. The observed (published) price is
// still what the card shows as the level, with its month.
//
// Dollars: (adjusted price now − adjusted Jan 2025 price) × the state's average residential use
// per customer per month over the latest 12 complete months (sales ÷ customers) — a stable,
// non-seasonal usage figure.

import { BASELINE_MONTH } from '@/lib/baseline'

export const EIA_ELECTRICITY_API = 'https://api.eia.gov/v2/electricity/retail-sales/data/'
/** First month fetched: gives 2014-07…2024-12 seasonal ratios (10+ per calendar month) and a 10-year graph. */
export const ELECTRICITY_SERIES_START = '2014-01'
/** First month kept in the cached/charted series (the graph's 10Y window needs ~2016-07). */
export const ELECTRICITY_CHART_START = '2016-01'
/** Seasonal factors use ratios up to this month only (pre-baseline), so they never revise. */
export const ELECTRICITY_SA_FIT_END = '2024-12'
/** Fewer in-sample seasonal ratios than this → not adjusted (series rejected, never shown raw as "adjusted"). */
export const ELECTRICITY_MIN_SA_HISTORY = 36
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
  /** Seasonally adjusted by whatchanged, ¢/kWh. */
  sa: number | null
}

export interface ElectricitySeriesData {
  state: string // 'ME' … or 'US'
  stateName: string
  seriesId: string
  /** Published price in the latest month (¢/kWh) and that month. */
  current: number
  latestPeriod: string
  /** Published price in Jan 2025. */
  baseline: number
  baselinePeriod: string
  /** Seasonally adjusted prices at the latest month and Jan 2025 (¢/kWh). */
  saCurrent: number
  saBaseline: number
  /** % change of the seasonally adjusted price since Jan 2025 (the headline). */
  change: number
  /** % change of the published prices, Jan 2025 → latest month (shown in the ⓘ for transparency). */
  rawChange: number
  /** Average residential use, kWh per customer per month, over `usageFrom`…`usageTo` (12 complete months). */
  usageKwh: number | null
  usageFrom?: string
  usageTo?: string
  /** Monthly series since ELECTRICITY_CHART_START (published + adjusted). */
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

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/**
 * Multiplicative seasonal factors (12, Jan…Dec, mean 1) from a contiguous monthly series:
 * ratio to a centered 2×12 moving average, median per calendar month over months ≤ fitEnd.
 * Returns null with fewer than ELECTRICITY_MIN_SA_HISTORY in-sample ratios or a month with none.
 */
export function seasonalFactors(
  months: string[],
  values: Array<number | null>,
  fitEnd: string = ELECTRICITY_SA_FIT_END,
): number[] | null {
  const w = [0.5, ...Array(11).fill(1), 0.5].map((v) => v / 12)
  const byMonth: number[][] = Array.from({ length: 12 }, () => [])
  let n = 0
  for (let t = 6; t < months.length - 6; t++) {
    if (months[t] > fitEnd) break
    let cma = 0
    let ok = true
    for (let k = 0; k < 13; k++) {
      const v = values[t - 6 + k]
      if (v === null) { ok = false; break }
      cma += v * w[k]
    }
    const x = values[t]
    if (!ok || x === null || !(cma > 0)) continue
    byMonth[Number(months[t].slice(5, 7)) - 1].push(x / cma)
    n++
  }
  if (n < ELECTRICITY_MIN_SA_HISTORY || byMonth.some((r) => !r.length)) return null
  const f = byMonth.map(median)
  const mean = f.reduce((a, b) => a + b, 0) / 12
  return f.map((v) => v / mean)
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
 * Throws when the state has no Jan 2025 or latest price, or too little history to adjust.
 */
export function buildElectricitySeries(rows: EiaElectricityRow[], state: string): ElectricitySeriesData {
  const st = state.toUpperCase()
  const mine = rows.filter((r) => r && typeof r.period === 'string' && String(r.stateid).toUpperCase() === st)
  const byPeriod = new Map(mine.map((r) => [r.period.slice(0, 7), r]))
  const priced = [...byPeriod.entries()].filter(([, r]) => num(r.price) !== null).map(([p]) => p).sort()
  if (!priced.length) throw new Error(`No EIA residential electricity price for ${st}`)
  const months = monthRange(priced[0], priced[priced.length - 1])
  const price = months.map((m) => num(byPeriod.get(m)?.price))
  const factors = seasonalFactors(months, price)
  if (!factors) throw new Error(`Too little EIA electricity history to seasonally adjust ${st}`)
  const sa = price.map((v, i) => (v === null ? null : v / factors[Number(months[i].slice(5, 7)) - 1]))

  const bi = months.indexOf(BASELINE_MONTH)
  if (bi < 0 || price[bi] === null) throw new Error(`No Jan 2025 EIA electricity price for ${st}`)
  let li = months.length - 1
  while (li >= 0 && price[li] === null) li--
  if (li <= bi) throw new Error(`No EIA electricity price after Jan 2025 for ${st}`)

  const usage = averageUsage(
    months,
    months.map((m) => num(byPeriod.get(m)?.sales)),
    months.map((m) => num(byPeriod.get(m)?.customers)),
  )
  const saBaseline = sa[bi]!
  const saCurrent = sa[li]!
  const first = mine.find((r) => typeof r.stateDescription === 'string')
  const start = Math.max(0, months.indexOf(ELECTRICITY_CHART_START))
  return {
    state: st,
    stateName: st === NATIONAL_ELECTRICITY ? 'U.S.' : (first?.stateDescription as string | undefined) ?? st,
    seriesId: electricitySeriesId(st),
    current: price[li]!,
    latestPeriod: months[li],
    baseline: price[bi]!,
    baselinePeriod: months[bi],
    saCurrent: round(saCurrent, 3),
    saBaseline: round(saBaseline, 3),
    change: round(((saCurrent - saBaseline) / saBaseline) * 100, 2),
    rawChange: round(((price[li]! - price[bi]!) / price[bi]!) * 100, 2),
    usageKwh: usage ? round(usage.kwh, 1) : null,
    ...(usage ? { usageFrom: usage.from, usageTo: usage.to } : {}),
    series: months.slice(start, li + 1).map((date, k) => {
      const i = start + k
      return { date, price: price[i], sa: sa[i] === null ? null : round(sa[i]!, 3) }
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
