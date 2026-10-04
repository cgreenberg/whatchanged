// Client-safe baseline rules shared by every "since Jan 20, 2025" comparison on the page.
// The server applies the same rules (src/lib/api/eia.ts, src/lib/api/bls-common.ts);
// tests/unit/baseline.test.ts asserts the constants stay in sync.

/** Inauguration day — the site-wide baseline date. */
export const BASELINE_DATE = '2025-01-20'
/** Monthly sources (BLS, Zillow) use the January 2025 value. */
export const BASELINE_MONTH = '2025-01'
/** Human labels for the baseline (the only hard-coded dates allowed in UI copy). */
export const BASELINE_MONTH_LABEL = 'Jan 2025'
export const BASELINE_MONTH_LONG = 'January 2025'
export const BASELINE_DAY_LABEL = 'Jan 20, 2025'

/** Weekly gas: last reading on or before Jan 20 2025, no earlier than this. */
export const GAS_BASELINE_EARLIEST = '2025-01-06'
/** Monthly BLS: Jan 2025, else latest month back to this one. */
export const CPI_BASELINE_EARLIEST = '2024-11'

/** Index of the gas baseline point (last weekly reading in [Jan 6, Jan 20] 2025), or -1. */
export function gasBaselineIndex(series: ReadonlyArray<{ date: string }>): number {
  let idx = -1
  for (let i = 0; i < series.length; i++) {
    const d = series[i].date
    if (d > BASELINE_DATE) break
    if (d >= GAS_BASELINE_EARLIEST) idx = i
  }
  return idx
}

/** Index of the monthly baseline point (Jan 2025, else latest month back to Nov 2024) with a finite value, or -1. */
export function monthlyBaselineIndex<T extends { date: string }>(
  series: ReadonlyArray<T>,
  value: (p: T) => number | null | undefined
): number {
  let idx = -1
  for (let i = 0; i < series.length; i++) {
    const d = series[i].date
    if (d > BASELINE_MONTH) break
    const v = value(series[i])
    if (d >= CPI_BASELINE_EARLIEST && typeof v === 'number' && Number.isFinite(v)) idx = i
  }
  return idx
}

/** Latest finite value index, or -1. */
export function latestIndex<T>(series: ReadonlyArray<T>, value: (p: T) => number | null | undefined): number {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = value(series[i])
    if (typeof v === 'number' && Number.isFinite(v)) return i
  }
  return -1
}

/** % change (current - baseline) / baseline × 100, or null when not computable. */
export function pctChange(current: number | null | undefined, baseline: number | null | undefined): number | null {
  if (typeof current !== 'number' || typeof baseline !== 'number') return null
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return null
  return ((current - baseline) / baseline) * 100
}

/** National gas change using the same baseline rule as the local series. */
export function gasChangeSinceBaseline(
  series: ReadonlyArray<{ date: string; price: number }> | undefined
): { current: number; baseline: number; change: number; latestDate: string; baselineDate: string } | null {
  if (!series?.length) return null
  const b = gasBaselineIndex(series)
  if (b < 0) return null
  const latest = series[series.length - 1]
  const base = series[b]
  return {
    current: latest.price,
    baseline: base.price,
    change: latest.price - base.price,
    latestDate: latest.date,
    baselineDate: base.date,
  }
}

/** Monthly % change since the baseline month using the shared baseline rule. */
export function monthlyChangeSinceBaseline<T extends { date: string }>(
  series: ReadonlyArray<T> | undefined,
  value: (p: T) => number | null | undefined
): { pct: number; baselinePeriod: string; latestPeriod: string } | null {
  if (!series?.length) return null
  const b = monthlyBaselineIndex(series, value)
  const l = latestIndex(series, value)
  if (b < 0 || l < 0 || l < b) return null
  const pct = pctChange(value(series[l]), value(series[b]))
  if (pct == null) return null
  return { pct, baselinePeriod: series[b].date, latestPeriod: series[l].date }
}
