// Header date labels shared by the share card (1080×1080) and the OG image (1200×630). Generated from the data, never
// hard-coded and never from today's date: the range ends at the most recent data month shown in the image (weekly gas
// through early Oct → "OCT 2026"; every quadrant monthly through Aug → "AUG 2026"); the second line names the span
// of the quadrants' months, and each quadrant shows its own month, so an older box is never implied to be current.
import { BASELINE_DAY_LABEL } from '@/lib/baseline'
import { fmtMonthShort, fmtMonthYear } from '@/lib/format'
import type { HeroCardModel } from '@/lib/hero-cards'

/**
 * Metric titles on the share card and the OG image: the metric name (details live in the site's ⓘ). Rent says what
 * it measures — Zillow asking rents on new listings — so it is never read as CPI shelter (all tenants and owners).
 */
export const QUADRANT_TITLES = {
  gas: 'GAS', groceries: 'GROCERIES', rent: 'RENT (NEW LISTINGS)', shelter: 'SHELTER (CPI)', electricity: 'ELECTRICITY',
} as const

/** Adjustment tag beside a quadrant title (share card) / on its window line (OG): rent is seasonally adjusted. */
export const RENT_ADJUSTMENT_TAG = 'seas. adj.'

/** As-of months ("YYYY-MM") of the cards that show a number in the image (status ok), sorted. */
function shownMonths(cards: HeroCardModel[]): string[] {
  return cards
    .filter((c) => c.status === 'ok' && c.asOfPeriod && /^\d{4}-\d{2}/.test(c.asOfPeriod))
    .map((c) => c.asOfPeriod!.slice(0, 7))
    .sort()
}

/** "JAN 20, 2025" — the start of the header range. */
export const RANGE_START = BASELINE_DAY_LABEL.toUpperCase()

/**
 * "OCT 2026": the end of the header range = the most recent data month among the numbers the image shows (a weekly
 * gas reading in early October → OCT; all monthly through August → AUG). Derived from the cards' as-of periods,
 * never from the date the image is made. null when no card shows a number.
 */
export function dataRangeEnd(cards: HeroCardModel[]): string | null {
  const months = shownMonths(cards)
  return months.length ? fmtMonthYear(months[months.length - 1]).toUpperCase() : null
}

/** Header line when no card has data (nothing dated to show): no arrow and no end month. */
export const RANGE_NONE = `SINCE ${RANGE_START}`

/** "latest Aug '26": one quadrant's own data month (OG stat), from its card; null without a dated number. */
export function cardMonthLabel(card: HeroCardModel): string | null {
  if (card.status !== 'ok' || !card.asOfPeriod || !/^\d{4}-\d{2}/.test(card.asOfPeriod)) return null
  return `latest ${fmtMonthShort(card.asOfPeriod.slice(0, 7))}`
}

/**
 * "latest data Jul–Aug '26": the span of the available cards' as-of months ("Aug '26" when they agree,
 * "Dec '25–Jan '26" across a year end); null when no card has data.
 */
export function latestDataLabel(cards: HeroCardModel[]): string | null {
  const periods = shownMonths(cards)
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
