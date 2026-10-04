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
  /**
   * $/yr in rent: local median rent × 12 × the BLS CPI "rent of primary residence" (SEHA) % change for the
   * same CPI area (signed). Shown on the Shelter (CPI) card, whose headline % is CPI shelter. null when the
   * rent index or local rent is unavailable — never the CPI shelter % (mostly owners' equivalent rent).
   */
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

/** $/yr in rent: local median rent × 12 × rent-of-primary-residence % change (signed). */
export function computeShelterImpact(
  rentIndexChangePct: number | null | undefined,
  medianRent: number | null | undefined
): number | null {
  if (typeof rentIndexChangePct !== 'number' || !Number.isFinite(rentIndexChangePct)) return null
  if (typeof medianRent !== 'number' || !Number.isFinite(medianRent) || medianRent <= 0) return null
  const v = Math.round((medianRent * 12 * rentIndexChangePct) / 100)
  return Object.is(v, -0) ? 0 : v
}

const finiteOrNull = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export function computeDollarImpact(opts: {
  groceriesChangePct?: number | null
  /** BLS CPI rent of primary residence (SEHA) % change for the zip's CPI area. */
  rentIndexChangePct?: number | null
  gasChange?: number | null
  tariffEstimatedCost?: number | null
  /** LOCAL median rent only — pass null/undefined when the zip has no Census rent. */
  medianRent?: number | null
}): DollarImpact {
  return {
    groceries: computeGroceryImpact(opts.groceriesChangePct),
    shelter: computeShelterImpact(opts.rentIndexChangePct, opts.medianRent),
    gas: finiteOrNull(opts.gasChange),
    tariff: finiteOrNull(opts.tariffEstimatedCost),
  }
}
