// Pure helpers for EraChart: timeframe filtering, per-series normalization, reference dates.

import type { Timeframe } from './chart-config'
import { BASELINE_MONTH, BASELINE_DATE, gasBaselineIndex, monthlyBaselineIndex } from '@/lib/baseline'

export type Row = { date: string; [key: string]: unknown }

/**
 * Neutral time references drawn as faint dotted rules in long views (no party colors, no shading per term):
 * January 2017 and January 2021, plus the Jan 20, 2025 baseline (drawn separately as the baseline rule).
 * Monthly data compare at month precision, weekly/daily at day precision.
 */
export const REFERENCE_DATES = [
  { key: 'jan2017', start: '2017-01-20', label: 'Jan 2017' },
  { key: 'jan2021', start: '2021-01-20', label: 'Jan 2021' },
  { key: 'baseline', start: BASELINE_DATE, label: 'Jan 2025' },
] as const

/** Whether a data date falls on/after a boundary day: monthly "2025-01" counts as on/after "2025-01-20". */
export function onOrAfter(date: string, boundaryDay: string): boolean {
  if (date.length <= 7) return date >= boundaryDay.slice(0, 7)
  return date >= boundaryDay
}

export function firstOnOrAfter(dates: string[], boundaryDay: string): string | null {
  return dates.find(d => onOrAfter(d, boundaryDay)) ?? null
}

/**
 * Rows within the timeframe, measured back from the latest data point (not today's date).
 * "Jan 2025" starts at the series' own baseline point — the same one the hero card uses — so the
 * chart's endpoint equals the hero %: the weekly gas baseline week, or for monthly series (`valueKey`)
 * Jan 2025, else the latest earlier month back to Nov 2024 (bimonthly CPI areas without a Jan release).
 */
export function filterByTimeframe<T extends { date: string }>(
  data: T[],
  tf: Timeframe,
  weeklyGasBaseline = false,
  valueKey?: string,
): T[] {
  if (!data.length) return data
  if (tf === 'Jan 2025') {
    if (weeklyGasBaseline) {
      // Weekly series: only the weekly baseline rule applies. Without a reading on or before the
      // baseline day, never fall through to the monthly rule (its periods are YYYY-MM, not dates).
      const b = gasBaselineIndex(data)
      return b >= 0 ? data.slice(b) : data.filter(d => d.date >= BASELINE_MONTH)
    }
    if (valueKey) {
      const b = monthlyBaselineIndex(data, r => {
        const v = (r as Record<string, unknown>)[valueKey]
        return typeof v === 'number' ? v : null
      })
      if (b >= 0) return data.slice(b)
    }
    return data.filter(d => d.date >= BASELINE_MONTH)
  }
  const last = data[data.length - 1].date
  const [y, m] = last.split('-').map(Number)
  const years = tf === '3Y' ? 3 : tf === '5Y' ? 5 : 10
  const cutoff = `${y - years}-${String(m).padStart(2, '0')}`
  return data.filter(d => d.date >= cutoff)
}

/** Each numeric series normalized to % change from ITS OWN first finite value in the rows. */
export function normalizeEachSeries(rows: Row[]): Row[] {
  if (!rows.length) return rows
  const keys = new Set<string>()
  rows.forEach(r => Object.keys(r).forEach(k => { if (k !== 'date') keys.add(k) }))
  const base: Record<string, number> = {}
  for (const k of keys) {
    const first = rows.find(r => typeof r[k] === 'number' && Number.isFinite(r[k] as number) && (r[k] as number) !== 0)
    if (first) base[k] = first[k] as number
  }
  return rows.map(r => {
    const out: Row = { date: r.date }
    for (const k of Object.keys(r)) {
      if (k === 'date') continue
      const v = r[k]
      out[k] = typeof v === 'number' && base[k] !== undefined ? ((v - base[k]) / base[k]) * 100 : v
    }
    return out
  })
}

/** Date of the first finite value of `key` (the normalization base). */
export function firstDateOf(rows: Row[], key: string): string | undefined {
  return rows.find(r => typeof r[key] === 'number' && Number.isFinite(r[key] as number))?.date
}

/** Date of the latest finite value of `key`. */
export function lastDateOf(rows: Row[], key: string): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key]
    if (typeof v === 'number' && Number.isFinite(v)) return rows[i].date
  }
  return undefined
}

/** Suffix of the series that draws preliminary points (dashed segment + hollow dots). */
export const PRELIM_SUFFIX = '_prelim'

/**
 * Split rows flagged `preliminary: true` into a separate `${key}_prelim` series so the chart can draw
 * them distinctly. The prelim series also carries the last final point so the dashed segment connects.
 * Rows without any preliminary flag are returned unchanged.
 */
export function splitPreliminary(rows: Row[], key: string): { rows: Row[]; hasPreliminary: boolean } {
  const first = rows.findIndex(r => r.preliminary === true && typeof r[key] === 'number')
  if (first < 0) return { rows, hasPreliminary: false }
  let anchor = -1
  for (let i = first - 1; i >= 0; i--) {
    if (typeof rows[i][key] === 'number' && rows[i].preliminary !== true) { anchor = i; break }
  }
  const pk = `${key}${PRELIM_SUFFIX}`
  const out = rows.map((r, i) => {
    if (r.preliminary === true) return { ...r, [key]: null, [pk]: r[key] }
    if (i === anchor) return { ...r, [pk]: r[key] }
    return r
  })
  return { rows: out, hasPreliminary: true }
}

/** Suffix of the faint dashed connector drawn across gap `i` (`${key}_gap${i}`). */
export const GAP_SUFFIX = '_gap'

export interface DataGap {
  /** First and last rows with no value inside the gap. */
  from: string
  to: string
  /** The valued rows on either side, which the dashed connector joins. */
  before: string
  after: string
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Interior gaps in `key`: runs of rows without a finite value that have a valued row on both sides
 * (leading/trailing empty rows are not gaps). `alsoKeys` count as values (e.g. the preliminary series).
 */
export function findGaps(rows: Row[], key: string, alsoKeys: string[] = []): DataGap[] {
  const has = (r: Row) => isNum(r[key]) || alsoKeys.some(k => isNum(r[k]))
  const gaps: DataGap[] = []
  let lastValued = -1
  for (let i = 0; i < rows.length; i++) {
    if (!has(rows[i])) continue
    if (lastValued >= 0 && i - lastValued > 1) {
      gaps.push({ from: rows[lastValued + 1].date, to: rows[i - 1].date, before: rows[lastValued].date, after: rows[i].date })
    }
    lastValued = i
  }
  return gaps
}

/**
 * Adds one `${key}${GAP_SUFFIX}${i}` series per gap, valued only at the gap's two anchor rows,
 * so each gap can be drawn as its own dashed segment without touching the real line.
 */
export function withGapConnectors(rows: Row[], key: string, gaps: DataGap[], alsoKeys: string[] = []): Row[] {
  if (!gaps.length) return rows
  const byDate = new Map<string, Array<[string, unknown]>>()
  gaps.forEach((g, i) => {
    const gk = `${key}${GAP_SUFFIX}${i}`
    for (const d of [g.before, g.after]) {
      const r = rows.find(x => x.date === d)
      const v = r && [key, ...alsoKeys].map(k => r[k]).find(isNum)
      if (v !== undefined) byDate.set(d, [...(byDate.get(d) ?? []), [gk, v]])
    }
  })
  return rows.map(r => {
    const add = byDate.get(r.date)
    return add ? { ...r, ...Object.fromEntries(add) } : r
  })
}

/**
 * Dates of `key` points that need a visible dot: isolated points (no valued neighbor on either side,
 * so the line draws nothing there) and the latest valued point.
 */
export function dotDates(rows: Row[], key: string, includeLatest = true): Set<string> {
  const out = new Set<string>()
  let last: string | undefined
  rows.forEach((r, i) => {
    if (!isNum(r[key])) return
    last = r.date
    const prev = i > 0 && isNum(rows[i - 1][key])
    const next = i < rows.length - 1 && isNum(rows[i + 1][key])
    if (!prev && !next) out.add(r.date)
  })
  if (includeLatest && last) out.add(last)
  return out
}
