/**
 * Plausible range for a rent % change since Jan 2025 (same as other price changes, CPI −20%…+50%).
 * scripts/build-local-data.py applies the same range and writes it into county-rent.json and metro-rent.json
 * (meta.pctRange); tests/unit/rent-range.test.ts and scripts/validate-local-data.py fail if they ever differ.
 * Kept in its own module so client code (ladder docs) can use it without bundling the rent data.
 */
export const RENT_PCT_RANGE: readonly [number, number] = [-20, 50]

/** "−20% to +50%". */
export function rentRangeText(): string {
  const [lo, hi] = RENT_PCT_RANGE
  return `${lo < 0 ? '−' : ''}${Math.abs(lo)}% to +${hi}%`
}
