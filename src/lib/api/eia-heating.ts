// Home heating fuel: EIA State Heating Oil and Propane Program (SHOPP), weekly residential prices.
// API v2 route petroleum/pri/wfr, process PRS ("price delivered to residential consumers"), products EPD2F
// (No. 2 heating oil) and EPLLPA (propane), duoarea S{ST} (state) and NUS (U.S. average, the comparison).
// Series ids: W_EPD2F_PRS_SME_DPG, W_EPLLPA_PRS_SGA_DPG …
//
// SHOPP is a HEATING-SEASON survey: states report weekly from the first week of October through March only.
// Between April and mid-October the latest reading is the end of March — that is the schedule, not a failure,
// and is labeled as such ("heating-season survey · latest Mar 30, 2026 · next update mid-Oct").
//
// Baseline = the last weekly reading on or before Jan 20 2025 (no earlier than Jan 6), like weekly gas.

import { BASELINE_DATE, GAS_BASELINE_EARLIEST } from '@/lib/baseline'
import { fmtDay } from '@/lib/format'
import { EIA_MAX_ROWS } from './eia-electricity'

export const EIA_HEATING_API = 'https://api.eia.gov/v2/petroleum/pri/wfr/data/'
export const HEATING_PRODUCT_CODES = { oil: 'EPD2F', propane: 'EPLLPA' } as const
export type HeatingProduct = keyof typeof HEATING_PRODUCT_CODES
export const HEATING_SERIES_START = '2016-01-01'
export const HEATING_TIMEOUT_MS = 10_000
export const NATIONAL_HEATING = 'US'

/**
 * States SHOPP publishes a residential series for (EIA API, checked 2026-10-04: 2024-25 and 2025-26 seasons).
 * Heating oil: 21 states in the Northeast, Mid-Atlantic and upper Midwest (EIA lists a DC series, but every
 * value is empty); propane: 38 states.
 */
export const HEATING_STATES: Record<HeatingProduct, readonly string[]> = {
  oil: ['CT', 'DE', 'IA', 'IN', 'KY', 'MA', 'MD', 'ME', 'MI', 'MN', 'NC', 'NE', 'NH', 'NJ', 'NY', 'OH', 'PA', 'RI', 'VA', 'VT', 'WI'],
  propane: [
    'AL', 'AR', 'CO', 'CT', 'DE', 'FL', 'GA', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO',
    'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NY', 'OH', 'OK', 'PA', 'RI', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WI',
  ],
}

export function hasHeatingSeries(product: HeatingProduct, state: string | null | undefined): boolean {
  return !!state && HEATING_STATES[product].includes(state.toUpperCase())
}

const duoareaOf = (area: string) => (area === NATIONAL_HEATING ? 'NUS' : `S${area.toUpperCase()}`)
export const heatingSeriesId = (product: HeatingProduct, area: string) =>
  `W_${HEATING_PRODUCT_CODES[product]}_PRS_${duoareaOf(area)}_DPG`
export const heatingCacheKey = (product: HeatingProduct, area: string) => `eia:heating:${product}:${area.toUpperCase()}`
/** EIA's series page (the citation for a SHOPP figure). */
export const heatingSeriesUrl = (product: HeatingProduct, area: string) =>
  `https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=${heatingSeriesId(product, area)}&f=W`

/** Sanity: $/gal and % change since Jan 2025. */
export const HEATING_PRICE_RANGE = [0.5, 15] as const
export const HEATING_CHANGE_RANGE = [-60, 150] as const

export interface HeatingPoint { date: string; price: number }

/** One weekly residential heating-fuel series, parsed (EIA SHOPP state / U.S., or a NYSERDA region). */
export interface HeatingSeriesData {
  product: HeatingProduct
  /** 'ME' … or 'US' (EIA), or the NYSERDA column. */
  area: string
  seriesId: string
  current: number
  latestDate: string
  baseline: number
  baselineDate: string
  /** % change since the baseline week. */
  change: number
  series: HeatingPoint[]
}

export interface EiaHeatingRow {
  period: string
  duoarea: string
  product: string
  value: string | number | null
  [key: string]: unknown
}

/** Pure: weekly points (any order) → series data with the Jan 20 2025 baseline. Throws when unusable. */
export function buildWeeklyHeatingSeries(
  points: ReadonlyArray<{ date: string; price: unknown }>, product: HeatingProduct, area: string, seriesId: string,
): HeatingSeriesData {
  const series = points
    .map((p) => ({ date: String(p.date).slice(0, 10), price: Number(p.price) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.price !== null && Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!series.length) throw new Error(`No heating ${product} data for ${area}`)
  let base: HeatingPoint | null = null
  for (const p of series) {
    if (p.date > BASELINE_DATE) break
    if (p.date >= GAS_BASELINE_EARLIEST) base = p
  }
  if (!base) throw new Error(`No ${product} reading for ${area} within a week before ${BASELINE_DATE}`)
  const latest = series[series.length - 1]
  return {
    product, area, seriesId,
    current: latest.price,
    latestDate: latest.date,
    baseline: base.price,
    baselineDate: base.date,
    change: Number((((latest.price - base.price) / base.price) * 100).toFixed(2)),
    series: series.filter((p) => p.date >= HEATING_SERIES_START),
  }
}

/** EIA rows (any mix) → one product/area series. */
export function buildHeatingSeries(rows: readonly EiaHeatingRow[], product: HeatingProduct, area: string): HeatingSeriesData {
  const duo = duoareaOf(area)
  const code = HEATING_PRODUCT_CODES[product]
  const pts = rows.filter((r) => r.duoarea === duo && r.product === code).map((r) => ({ date: r.period, price: r.value }))
  return buildWeeklyHeatingSeries(pts, product, area, heatingSeriesId(product, area))
}

/** All requested product/area series from one paged query (failures as Error values). */
export function buildHeatingByArea(
  rows: readonly EiaHeatingRow[], targets: ReadonlyArray<{ product: HeatingProduct; area: string }>,
): Map<string, HeatingSeriesData | Error> {
  const out = new Map<string, HeatingSeriesData | Error>()
  for (const t of targets) {
    try {
      out.set(heatingCacheKey(t.product, t.area), buildHeatingSeries(rows, t.product, t.area))
    } catch (e) {
      out.set(heatingCacheKey(t.product, t.area), e instanceof Error ? e : new Error(String(e)))
    }
  }
  return out
}

/**
 * A series EIA simply doesn't have (no rows for the product/area, or no reading in the week before the baseline)
 * → 'missing' in the refresh report; anything else that fails is 'invalid'.
 */
export function isHeatingMissing(e: unknown): boolean {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return /^No heating (oil|propane) data for /.test(m) || /^No (oil|propane) reading for .* within a week before /.test(m)
}

export function isValidHeating(d: HeatingSeriesData | null | undefined): boolean {
  const ok = (v: unknown, [lo, hi]: readonly [number, number]) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
  return !!d && Array.isArray(d.series) && d.series.length > 0 && ok(d.current, HEATING_PRICE_RANGE) &&
    ok(d.baseline, HEATING_PRICE_RANGE) && ok(d.change, HEATING_CHANGE_RANGE) &&
    typeof d.latestDate === 'string' && typeof d.baselineDate === 'string'
}

// ------------------------------------------------------------------ heating season

const DAY = 86_400_000

/**
 * EIA SHOPP schedule: weekly from the first Monday of October through March; nothing April–September.
 * Off-season = April 1 … October 14 (data for the season's first Monday is out by mid-October).
 */
export function isHeatingOffSeason(now: Date): boolean {
  const m = now.getUTCMonth() + 1
  return (m >= 4 && m <= 9) || (m === 10 && now.getUTCDate() < 15)
}

/** Start (Mar 1) of the latest heating season's final month the survey should have reached by `now`. */
function lastSeasonMarch(now: Date): string {
  const y = now.getUTCFullYear()
  return `${now.getUTCMonth() + 1 >= 4 ? y : y - 1}-03-01`
}

/**
 * In-season staleness threshold. SHOPP publishes Wednesdays (Monday's prices); the weekly refresh runs Tuesday and
 * a heating-only refresh runs Thursday (.github/workflows/refresh-cache.yml), so the stored week is normally
 * ≤ 10 days old, and one missed run still leaves it ≤ 16 days: older than that means a real outage.
 */
export const HEATING_STALE_DAYS = 16

/**
 * Freshness of a heating-season series: off-season with the season's last weeks → `offSeason` (labeled,
 * not a failure); otherwise `stale` when the latest week is overdue (HEATING_STALE_DAYS in season; off-season:
 * the series didn't reach March).
 */
export function heatingSeasonStatus(latestDate: string, now: Date): { offSeason: boolean; stale: boolean; note?: string } {
  // Early October: once the new season's first week is out, the series is in season again
  const seasonStarted = now.getUTCMonth() + 1 === 10 && latestDate >= `${now.getUTCFullYear()}-10-01`
  if (isHeatingOffSeason(now) && !seasonStarted) {
    const reachedMarch = latestDate >= lastSeasonMarch(now)
    return {
      offSeason: reachedMarch,
      stale: !reachedMarch,
      ...(reachedMarch ? { note: `Heating-season survey (Oct–Mar) · latest ${fmtDay(latestDate)} · next update mid-Oct` } : {}),
    }
  }
  const t = Date.parse(`${latestDate}T00:00:00Z`)
  return { offSeason: false, stale: !Number.isFinite(t) || now.getTime() - t > HEATING_STALE_DAYS * DAY }
}

// ------------------------------------------------------------------ fetching

function query(products: readonly HeatingProduct[], areas: readonly string[], apiKey: string, offset: number) {
  const p = new URLSearchParams({
    api_key: apiKey,
    frequency: 'weekly',
    'data[0]': 'value',
    'facets[process][]': 'PRS',
    start: HEATING_SERIES_START,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'asc',
    offset: String(offset),
    length: String(EIA_MAX_ROWS),
  })
  for (const pr of products) p.append('facets[product][]', HEATING_PRODUCT_CODES[pr])
  for (const a of areas) p.append('facets[duoarea][]', duoareaOf(a))
  return p.toString()
}

/**
 * Every requested product × area since HEATING_SERIES_START in one paged query (both products, ~42 states
 * + US ≈ 17,400 rows → 4 requests). Returns the rows and the number of requests.
 */
export async function fetchHeatingRows(
  products: readonly HeatingProduct[], areas: readonly string[], opts: { timeoutMs?: number } = {},
): Promise<{ rows: EiaHeatingRow[]; requests: number }> {
  const apiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'
  const timeoutMs = opts.timeoutMs ?? HEATING_TIMEOUT_MS
  const rows: EiaHeatingRow[] = []
  let requests = 0
  let total = Infinity
  while (rows.length < total) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${EIA_HEATING_API}?${query(products, areas, apiKey, rows.length)}`, { signal: controller.signal })
      if (!res.ok) throw new Error(`EIA heating fuel API error: ${res.status} ${res.statusText}`)
      const json = await res.json()
      const data: EiaHeatingRow[] = json?.response?.data ?? []
      const t = Number(json?.response?.total ?? data.length)
      total = Number.isFinite(t) ? t : data.length
      requests++
      if (!data.length) break
      rows.push(...data)
    } finally {
      clearTimeout(timer)
    }
    if (requests > 12) throw new Error('EIA heating fuel paging did not finish')
  }
  if (!rows.length) throw new Error(`No EIA heating fuel data returned for ${areas.join(',')}`)
  return { rows, requests }
}

/** Runtime cache miss: one product, one area (one request). */
export async function fetchHeatingSeries(product: HeatingProduct, area: string, opts: { timeoutMs?: number } = {}): Promise<HeatingSeriesData> {
  const { rows } = await fetchHeatingRows([product], [area], opts)
  return buildHeatingSeries(rows, product, area)
}
