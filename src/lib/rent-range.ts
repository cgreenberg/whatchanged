/**
 * Plausible range for a rent % change since Jan 2025 (same as other price changes, CPI −20%…+50%).
 * scripts/build-local-data.py applies the same range and writes it into county-rent.json and metro-rent.json
 * (meta.pctRange); tests/unit/rent-range.test.ts and scripts/validate-local-data.py fail if they ever differ.
 * Kept in its own module so client code (ladder docs) can use it without bundling the rent data.
 */
export const RENT_PCT_RANGE: readonly [number, number] = [-20, 50]

/** A county's Zillow series that stops before the file's latest month: months with a value and the last one. */
export interface NotCurrentInfo { n: number; last: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/**
 * "Zillow's series for New Kent County is too new to use (only one month, Jul 2026)" /
 * "(only three months, from May 2026)". The first month counts back n − 1 months from the last (Zillow county
 * series run without gaps once they start).
 */
export function notCurrentText(county: string, info: NotCurrentInfo | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(info?.last ?? '')
  const n = info?.n ?? 0
  const monthName = (idx: number) => `${MONTHS[((idx % 12) + 12) % 12]} ${Math.floor(idx / 12)}`
  const lastIdx = m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
  const count = n > 0 ? `${n <= 10 ? NUMBER_WORDS[n] : n} month${n === 1 ? '' : 's'}` : ''
  const detail = lastIdx === null
    ? count ? `only ${count}` : ''
    : count
      ? n === 1 ? `only ${count}, ${monthName(lastIdx)}` : `only ${count}, from ${monthName(lastIdx - (n - 1))}`
      : `only through ${monthName(lastIdx)}`
  return `Zillow's series for ${county} is too new to use${detail ? ` (${detail})` : ''}`
}

/** "−20% to +50%". */
export function rentRangeText(): string {
  const [lo, hi] = RENT_PCT_RANGE
  return `${lo < 0 ? '−' : ''}${Math.abs(lo)}% to +${hi}%`
}
