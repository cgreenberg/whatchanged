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
 */
export function notCurrentText(county: string, info: NotCurrentInfo | undefined): string {
  const n = info?.n ?? 0
  const lastIdx = monthIdx(info?.last)
  const firstIdx = monthIdx(info?.first) ?? (lastIdx !== null && n > 0 ? lastIdx - (n - 1) : null)
  if (firstIdx !== null && firstIdx < BASE_IDX && lastIdx !== null) {
    return `Zillow's series for ${county} isn't current (through ${monthName(lastIdx)})`
  }
  const count = n > 0 ? `${n <= 10 ? NUMBER_WORDS[n] : n} month${n === 1 ? '' : 's'}` : ''
  const detail = lastIdx === null
    ? count ? `only ${count}` : ''
    : count
      ? n === 1 ? `only ${count}, ${monthName(lastIdx)}` : `only ${count}, from ${monthName(firstIdx ?? lastIdx)}`
      : `only through ${monthName(lastIdx)}`
  return `Zillow's series for ${county} is too new to use${detail ? ` (${detail})` : ''}`
}

/** A series' own recent seasonal swing vs the blended pattern used to adjust it (RentData.saCaveat). */
export interface SeasonalCaveat { gap: number; month: number; low?: boolean }

/** A series' own recent seasonal swing (Jan → its peak or low month) differs from the blended one by more than this. */
export const RENT_SEASONAL_GAP_MIN = 1.5
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Honest caveat when the series' own recent seasonal swing differs from the blended pattern used to adjust it by
 * more than RENT_SEASONAL_GAP_MIN points (scripts/build-local-data.py `saCaveat`): own swing bigger than the blend's
 * → readings near that month overstate the change; smaller → understate. "~X points" = the gap, rounded.
 */
export function rentSeasonalCaveat(c: SeasonalCaveat | undefined, level: 'county' | 'metro' = 'county'): string | undefined {
  if (!c || !Number.isFinite(c.gap) || Math.abs(c.gap) <= RENT_SEASONAL_GAP_MIN || !(c.month >= 1 && c.month <= 12)) return undefined
  const x = Math.round(Math.abs(c.gap))
  return `This ${level}’s seasonal pattern is uncertain; readings near its seasonal ${c.low ? 'low' : 'peak'} (${MONTH_NAMES[c.month - 1]}) ` +
    `may ${c.gap > 0 ? 'overstate' : 'understate'} the change by up to ~${x} points.`
}

/** "−20% to +50%". */
export function rentRangeText(): string {
  const [lo, hi] = RENT_PCT_RANGE
  return `${lo < 0 ? '−' : ''}${Math.abs(lo)}% to +${hi}%`
}
