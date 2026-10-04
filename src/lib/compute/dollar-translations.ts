/**
 * Dollar impact calculations for hero cards.
 *
 * Centralized so both the API (snapshot.ts) and the frontend use the same
 * source of truth. Signs are preserved: a price DROP yields a negative dollar
 * amount (money saved), never a positive one.
 */

/** US median household income (Census CPS, 2022). Single source for national income fallbacks. */
export const NATIONAL_MEDIAN_INCOME = 74580
/** US median gross rent (Census ACS). Used only for display fallbacks, never for local dollar translations. */
export const NATIONAL_MEDIAN_RENT = 1271
/** Typical household annual food-at-home spend (~$6,000/yr). */
export const ANNUAL_GROCERY_BASE = 6000

export interface DollarImpact {
  /** $/yr: ANNUAL_GROCERY_BASE × groceries % change (signed). null if CPI unavailable. */
  groceries: number | null
  /** $/yr: local median rent × 12 × shelter % change (signed). null if CPI or local rent unavailable. */
  shelter: number | null
  /** $/gallon change since the Jan 20 2025 baseline (signed). Per gallon, NOT annual. */
  gas: number | null
  /** $/yr tariff estimate (median_income × 0.0205). */
  tariff: number | null
}

export function computeGroceryImpact(groceriesChangePct: number | null | undefined): number | null {
  if (typeof groceriesChangePct !== 'number' || !Number.isFinite(groceriesChangePct)) return null
  const v = Math.round((ANNUAL_GROCERY_BASE * groceriesChangePct) / 100)
  return Object.is(v, -0) ? 0 : v
}

export function computeShelterImpact(
  shelterChangePct: number | null | undefined,
  medianRent: number | null | undefined
): number | null {
  if (typeof shelterChangePct !== 'number' || !Number.isFinite(shelterChangePct)) return null
  if (typeof medianRent !== 'number' || !Number.isFinite(medianRent) || medianRent <= 0) return null
  const v = Math.round((medianRent * 12 * shelterChangePct) / 100)
  return Object.is(v, -0) ? 0 : v
}

const finiteOrNull = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export function computeDollarImpact(opts: {
  groceriesChangePct?: number | null
  shelterChangePct?: number | null
  gasChange?: number | null
  tariffEstimatedCost?: number | null
  /** LOCAL median rent only — pass null/undefined when the zip has no Census rent. */
  medianRent?: number | null
}): DollarImpact {
  return {
    groceries: computeGroceryImpact(opts.groceriesChangePct),
    shelter: computeShelterImpact(opts.shelterChangePct, opts.medianRent),
    gas: finiteOrNull(opts.gasChange),
    tariff: finiteOrNull(opts.tariffEstimatedCost),
  }
}
