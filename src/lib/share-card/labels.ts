// Header date labels shared by the share card (1080×1080) and the OG image (1200×630). Generated, never hard-coded:
// the end of the range is the month the image is made; the second line names the months the numbers come from.
import { BASELINE_DAY_LABEL } from '@/lib/baseline'
import { fmtMonthShort, fmtMonthYear } from '@/lib/format'
import type { HeroCardModel } from '@/lib/hero-cards'

/** Metric titles on the share card and the OG image: the metric name only (details live in the site's ⓘ). */
export const QUADRANT_TITLES = {
  gas: 'GAS', groceries: 'GROCERIES', rent: 'RENT', shelter: 'SHELTER (CPI)', electricity: 'ELECTRICITY',
} as const

/** "JAN 20, 2025" — the start of the header range. */
export const RANGE_START = BASELINE_DAY_LABEL.toUpperCase()

/** "OCT 2026": the month the image is generated (UTC). */
export function rangeEnd(now: Date = new Date()): string {
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  return fmtMonthYear(ym).toUpperCase()
}

/**
 * "latest data Jul–Aug '26": the span of the available cards' as-of months ("Aug '26" when they agree,
 * "Dec '25–Jan '26" across a year end); null when no card has data.
 */
export function latestDataLabel(cards: HeroCardModel[]): string | null {
  const periods = cards
    .filter((c) => c.status === 'ok' && c.asOfPeriod && /^\d{4}-\d{2}/.test(c.asOfPeriod))
    .map((c) => c.asOfPeriod!.slice(0, 7))
    .sort()
  if (!periods.length) return null
  const lo = periods[0]
  const hi = periods[periods.length - 1]
  if (lo === hi) return `latest data ${fmtMonthShort(hi)}`
  const head = lo.slice(0, 4) === hi.slice(0, 4) ? fmtMonthShort(lo).split(' ')[0] : fmtMonthShort(lo)
  return `latest data ${head}–${fmtMonthShort(hi)}`
}

/** "Aug '26" for a card's source-line date: "Aug 2026" or a weekly "Sep 29, 2026" (the month is enough on an image). */
export function shortSourceDate(line: string): string {
  return line.replace(/\b([A-Z][a-z]{2})(?: \d{1,2},)? \d{2}(\d{2})$/, "$1 '$2")
}
