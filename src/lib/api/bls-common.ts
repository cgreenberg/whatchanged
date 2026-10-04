// Shared BLS API helpers: request, monthly-series parsing, Jan 2025 baseline.

export const BLS_API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'

/** Baseline month for the whole app: January 2025 (BLS has monthly granularity only). */
export const BASELINE_PERIOD_KEY = '2025-01'

/**
 * If a series has no January 2025 value, accept the latest published month
 * on or before Jan 2025 — but no earlier than this. Covers bimonthly CPI areas
 * that publish only in even months (Dec 2024). Anything older → no baseline.
 */
export const EARLIEST_FALLBACK_BASELINE = '2024-11'

export interface BlsRawPoint {
  year: string
  period: string
  value: string
  [key: string]: unknown
}

export interface BlsSeriesResult {
  seriesID: string
  data?: BlsRawPoint[]
}

export interface BlsResponse {
  status: string
  message?: string[]
  Results?: { series?: BlsSeriesResult[] }
}

export interface MonthlyPoint {
  /** YYYY-MM */
  date: string
  value: number
  /** BLS footnote code "P": preliminary estimate, revised in a later release. */
  preliminary?: true
}

export interface Observation {
  /** YYYY-MM */
  period: string
  value: number
}

const MONTHLY_PERIOD = /^M(0[1-9]|1[0-2])$/

/** true when a BLS data point carries footnote code "P" (preliminary). */
export function isPreliminary(d: BlsRawPoint): boolean {
  const notes = d.footnotes
  if (!Array.isArray(notes)) return false
  return notes.some(
    (f) => !!f && typeof f === 'object' && typeof (f as { code?: unknown }).code === 'string' &&
      (f as { code: string }).code.trim().toUpperCase() === 'P'
  )
}

/**
 * Months (YYYY-MM) BLS lists but did not publish ("-" / non-numeric value, e.g. the Oct 2025
 * shutdown gap), oldest first. Callers keep them as EMPTY chart rows, so the chart can mark the gap
 * instead of silently joining the months on either side. (Months BLS never lists, such as the off
 * months of a bimonthly metro, are not gaps and are not returned.)
 */
export function blsUnpublishedMonths(data: BlsRawPoint[] | undefined | null): string[] {
  if (!Array.isArray(data)) return []
  const published = new Set(parseBlsMonthly(data).map((p) => p.date))
  const out = new Set<string>()
  for (const d of data) {
    if (!d || typeof d.year !== 'string' || typeof d.period !== 'string' || !MONTHLY_PERIOD.test(d.period)) continue
    const date = `${d.year}-${d.period.slice(1)}`
    if (!published.has(date)) out.add(date)
  }
  return [...out].sort()
}

/**
 * Parse BLS monthly data: keeps only M01–M12 (drops M13 annual averages),
 * drops "-" / non-numeric values (e.g. Oct 2025 shutdown gap; see blsUnpublishedMonths), sorts oldest first.
 * Points BLS marks preliminary (footnote code "P") get `preliminary: true`.
 */
export function parseBlsMonthly(data: BlsRawPoint[] | undefined | null): MonthlyPoint[] {
  if (!Array.isArray(data)) return []
  const byDate = new Map<string, MonthlyPoint>()
  for (const d of data) {
    if (!d || typeof d.year !== 'string' || typeof d.period !== 'string') continue
    if (!MONTHLY_PERIOD.test(d.period)) continue
    if (typeof d.value !== 'string' || d.value.trim() === '-' || d.value.trim() === '') continue
    const value = Number(d.value)
    if (!Number.isFinite(value)) continue
    const date = `${d.year}-${d.period.slice(1)}`
    byDate.set(date, isPreliminary(d) ? { date, value, preliminary: true } : { date, value })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Jan 2025 value if published, else latest month in [EARLIEST_FALLBACK_BASELINE, Jan 2025]. */
export function findBaseline(points: MonthlyPoint[]): Observation | null {
  let best: MonthlyPoint | null = null
  for (const p of points) {
    if (p.date > BASELINE_PERIOD_KEY) break
    if (p.date >= EARLIEST_FALLBACK_BASELINE) best = p
  }
  return best ? { period: best.date, value: best.value } : null
}

/** Latest valid observation, or null. */
export function findLatest(points: MonthlyPoint[]): Observation | null {
  const last = points[points.length - 1]
  return last ? { period: last.date, value: last.value } : null
}

/** (current - baseline) / baseline * 100, rounded to 1 decimal; null when not computable. */
export function pctChange(current: number, baseline: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return null
  const v = parseFloat((((current - baseline) / baseline) * 100).toFixed(1))
  return Number.isFinite(v) ? v : null
}

/** Start year for history: BLS allows 20 years with a key, 10 without. */
export function blsStartYear(now = new Date()): string {
  const year = now.getFullYear()
  return process.env.BLS_API_KEY ? '2016' : String(Math.max(2016, year - 9))
}

/** POST a batch of series to BLS. Throws on HTTP or API-level failure. */
export async function fetchBlsSeries(
  seriesIds: string[],
  opts: { startYear?: string; endYear?: string; timeoutMs?: number; label?: string } = {}
): Promise<Record<string, BlsRawPoint[]>> {
  const label = opts.label ?? 'BLS'
  const body: Record<string, unknown> = {
    seriesid: seriesIds,
    startyear: opts.startYear ?? blsStartYear(),
    endyear: opts.endYear ?? new Date().getFullYear().toString(),
  }
  if (process.env.BLS_API_KEY) {
    body.registrationkey = process.env.BLS_API_KEY
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000)
  let json: BlsResponse
  try {
    const response = await fetch(BLS_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`${label} API error: ${response.status} ${response.statusText}`)
    }
    json = (await response.json()) as BlsResponse
  } finally {
    clearTimeout(timeout)
  }

  if (!json || json.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`${label} API failed: ${json?.message?.join(', ') ?? 'unknown error'}`)
  }

  const out: Record<string, BlsRawPoint[]> = {}
  for (const s of json.Results?.series ?? []) {
    if (s && typeof s.seriesID === 'string') out[s.seriesID] = s.data ?? []
  }
  return out
}
