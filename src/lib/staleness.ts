// "Is this series behind schedule?" rules, shared by the snapshot, the resolution ladders and the cards.
// Client-safe (no data or cache imports).

const DAY_MS = 86_400_000

/** True when a YYYY-MM month ended more than `days` days before `now`. Anything else → false. */
export function monthOlderThan(ym: string | null | undefined, days: number, now: Date = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? '')
  if (!m) return false
  const monthEnd = Date.UTC(Number(m[1]), Number(m[2]), 0) // last day of that month
  return now.getTime() - monthEnd > days * DAY_MS
}

/**
 * BLS data whose latest month ended more than this many days ago is shown with the stale badge.
 * Normal lag at its worst (just before the next release) is ~45 days for CPI, so 75 days means at
 * least one monthly release was missed (refresh stuck, or BLS stopped).
 */
export const BLS_STALE_DAYS = 75

/** true when a YYYY-MM BLS period ended more than BLS_STALE_DAYS before `now`. Unknown period → false. */
export function isBlsPeriodStale(period: string | null | undefined, now: Date = new Date()): boolean {
  return monthOlderThan(period?.slice(0, 7), BLS_STALE_DAYS, now)
}

/**
 * EIA monthly electricity is published ~2 months after the month ends (Jul data in late Sep), so a
 * latest month older than this means a release was missed.
 */
export const ELECTRICITY_STALE_DAYS = 100

export function isElectricityPeriodStale(period: string | null | undefined, now: Date = new Date()): boolean {
  return monthOlderThan(period?.slice(0, 7), ELECTRICITY_STALE_DAYS, now)
}

/** County rent / home values (Zillow) older than this (from the end of their as-of month) get a stale badge. */
export const RENT_STALE_DAYS = 60
