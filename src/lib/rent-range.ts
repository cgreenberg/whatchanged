/**
 * Plausible range for a rent % change since Jan 2025 (same as other price changes, CPI −20%…+50%).
 * scripts/build-local-data.py applies the same range and writes it into county-rent.json and metro-rent.json
 * (meta.pctRange); tests/unit/rent-range.test.ts and scripts/validate-local-data.py fail if they ever differ.
 * Kept in its own module so client code (ladder docs) can use it without bundling the rent data.
 */
export const RENT_PCT_RANGE: readonly [number, number] = [-20, 50]

/**
 * A county's Zillow series that stops before the file's latest month: months with a value, the first and last of
 * them (`first` is absent in data built before round 14; it is then counted back n − 1 months from `last`).
 */
export interface NotCurrentInfo { n: number; last: string; first?: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
/** Month index of the Jan 2025 baseline (year × 12 + month − 1). */
const BASE_IDX = 2025 * 12

const monthIdx = (ym: string | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? '')
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}
const monthName = (idx: number) => `${MONTHS[((idx % 12) + 12) % 12]} ${Math.floor(idx / 12)}`

/**
 * Why a county's stopped Zillow series isn't used. A series that started before Jan 2025 and then stopped "isn't
 * current (through Mar 2026)"; a newer one is "too new to use (only one month, Jul 2026)" / "(only three months, from
 * May 2026)", n = the months that actually have a value (a gap doesn't count) and the first month is the real one.
 * Legacy data without `first`: counting back n − 1 months from `last` gives the LATEST the series can have started
 * (gaps would make it earlier). Before Jan 2025 → certainly "isn't current"; otherwise the start is unknown, so the
 * text names no start month and doesn't claim "too new" (unless n = 1, where first = last).
 */
export function notCurrentText(county: string, info: NotCurrentInfo | undefined): string {
  const n = info?.n ?? 0
  const lastIdx = monthIdx(info?.last)
  const knownFirst = monthIdx(info?.first)
  const latestFirst = knownFirst ?? (lastIdx !== null && n > 0 ? lastIdx - (n - 1) : null)
  if (latestFirst !== null && latestFirst < BASE_IDX && lastIdx !== null) {
    return `Zillow's series for ${county} isn't current (through ${monthName(lastIdx)})`
  }
  const count = n > 0 ? `${n <= 10 ? NUMBER_WORDS[n] : n} month${n === 1 ? '' : 's'}` : ''
  if (knownFirst === null && n > 1 && lastIdx !== null) {
    return `Zillow's series for ${county} isn't usable (only ${count} of data, through ${monthName(lastIdx)})`
  }
  const detail = lastIdx === null
    ? count ? `only ${count}` : ''
    : count
      ? n === 1 ? `only ${count}, ${monthName(lastIdx)}` : `only ${count}, from ${monthName(knownFirst ?? lastIdx)}`
      : `only through ${monthName(lastIdx)}`
  return `Zillow's series for ${county} is too new to use${detail ? ` (${detail})` : ''}`
}

/**
 * A series' seasonal-pattern caveat (RentData.saCaveat; county-rent.json / metro-rent.json `saCaveat`, county shards
 * `rentSaCav`, metro `rentM.cav`): `month` = the calendar month of the DISPLAYED (as-of) reading, `gap` = the series'
 * own recent seasonal swing from January to that month minus the blended pattern's (points; > 0 → the reading
 * overstates the change since Jan 2025, < 0 → understates). `low` is a legacy (round-14) field and is ignored.
 */
export interface SeasonalCaveat { gap: number; month: number; low?: boolean }

/** A caveat is shown when the own-vs-blend gap at the displayed month is bigger than this (points). */
export const RENT_SEASONAL_GAP_MIN = 1.5
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Is this a caveat to show? (|gap| > RENT_SEASONAL_GAP_MIN, month 1–12.) */
export function hasSeasonalCaveat(c: SeasonalCaveat | null | undefined): c is SeasonalCaveat {
  return !!c && typeof c.gap === 'number' && Number.isFinite(c.gap) && Math.abs(c.gap) > RENT_SEASONAL_GAP_MIN &&
    Number.isInteger(c.month) && c.month >= 1 && c.month <= 12
}

/** The gap as worded: |gap| rounded to the nearest 0.5 point ("2.5", "2"). */
export function seasonalCaveatPoints(c: SeasonalCaveat): number {
  return Math.round(Math.abs(c.gap) * 2) / 2
}

/**
 * What the worded gap means for the card's $/mo (curRent − curRent / (1 + pct/100)): the change at `pct` minus the
 * change at `pct` ∓ the worded points, whole dollars, ≥ 0. null without a usable rent level and %.
 */
export function seasonalCaveatDollars(c: SeasonalCaveat, pct: number | undefined, curRent: number | undefined): number | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || typeof curRent !== 'number' || !(curRent > 0)) return null
  const x = seasonalCaveatPoints(c) * Math.sign(c.gap)
  const monthly = (p: number) => curRent - curRent / (1 + p / 100)
  const v = Math.abs(monthly(pct) - monthly(pct - x))
  return Number.isFinite(v) ? Math.round(v) : null
}

/**
 * Honest caveat when the series' own recent seasonal swing from January to the DISPLAYED month differs from the
 * blended pattern used to adjust it by more than RENT_SEASONAL_GAP_MIN points: "This August reading may overstate
 * the change by about 2.5 percentage points (≈ $95/mo): …". `rent` (the shown % and current rent) adds the $/mo.
 */
export function rentSeasonalCaveat(
  c: SeasonalCaveat | undefined,
  level: 'county' | 'metro' = 'county',
  rent?: { pct?: number; curRent?: number },
): string | undefined {
  if (!hasSeasonalCaveat(c)) return undefined
  const usd = rent ? seasonalCaveatDollars(c, rent.pct, rent.curRent) : null
  return `This ${MONTH_NAMES[c.month - 1]} reading may ${c.gap > 0 ? 'overstate' : 'understate'} the change by about ` +
    `${seasonalCaveatPoints(c)} percentage points${usd !== null ? ` (≈ $${usd.toLocaleString('en-US')}/mo)` : ''}: ` +
    `the ${level}’s recent seasonal swing differs from the pattern used to adjust it.`
}

/** Short marker for tight spaces (map tooltip, share image). */
export const SEASONAL_CAVEAT_SHORT = '†seasonal pattern uncertain'

/** "−20% to +50%". */
export function rentRangeText(): string {
  const [lo, hi] = RENT_PCT_RANGE
  return `${lo < 0 ? '−' : ''}${Math.abs(lo)}% to +${hi}%`
}
