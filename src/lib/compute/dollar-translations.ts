/**
 * Dollar impact calculations for hero cards.
 *
 * Centralized so both the API (snapshot.ts) and the frontend use the same
 * source of truth. Signs are preserved: a price DROP yields a negative dollar
 * amount (money saved), never a positive one.
 */

import { fmtSignedDollars } from '@/lib/format'

/** US median gross rent (Census ACS). Used only for display fallbacks, never for local dollar translations. */
export const NATIONAL_MEDIAN_RENT = 1271
/** Typical household annual food-at-home spend (~$6,000/yr). */
export const ANNUAL_GROCERY_BASE = 6000

/**
 * A median gross rent as Census publishes it: a top-coded median ("3,500+", stored as 3501) is "$3,500+", a
 * bottom-coded one ("100-", stored as 99) "under $100"; anything else "$1,234".
 */
export function fmtRentFigure(rent: number, coded?: 'top' | 'bottom' | null): string {
  if (coded === 'top') return '$3,500+'
  if (coded === 'bottom') return 'under $100'
  return `$${Math.round(rent).toLocaleString('en-US')}`
}

/**
 * The shelter "$/yr in rent" amount: "≈ +$1,230/yr". When the rent base is the zip's own top-coded median ($3,500+)
 * the true amount is at least this big (either sign: "at least ≈ −$420/yr" for a decrease); bottom-coded (under $100)
 * → "at most".
 */
export function fmtRentDollars(dollars: number, coded?: 'top' | 'bottom' | null): string {
  const amount = `≈ ${fmtSignedDollars(dollars, 0)}/yr`
  return coded === 'top' ? `at least ${amount}` : coded === 'bottom' ? `at most ${amount}` : amount
}

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
  /**
   * $/mo on electricity (signed, whole dollars): change in the state's 12-month average residential price
   * (latest 12 months − the 12 months centered on Jan 2025, ¢/kWh) × the state's average residential use
   * (kWh per customer per month, latest 12 months) ÷ 100. null when either is unavailable.
   */
  electricity: number | null
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

/** $/mo: price change (¢/kWh) × monthly use (kWh) ÷ 100, rounded to whole dollars (signed). */
export function computeElectricityImpact(
  priceChangeCents: number | null | undefined,
  usageKwh: number | null | undefined
): number | null {
  if (typeof priceChangeCents !== 'number' || !Number.isFinite(priceChangeCents)) return null
  if (typeof usageKwh !== 'number' || !Number.isFinite(usageKwh) || usageKwh <= 0) return null
  const v = Math.round((priceChangeCents * usageKwh) / 100)
  return Object.is(v, -0) ? 0 : v
}

export function computeDollarImpact(opts: {
  groceriesChangePct?: number | null
  /** BLS CPI rent of primary residence (SEHA) % change for the zip's CPI area. */
  rentIndexChangePct?: number | null
  gasChange?: number | null
  /** LOCAL median rent only — pass null/undefined when the zip has no Census rent. */
  medianRent?: number | null
  /** State residential 12-month average price, latest 12 months − 12 months centered on Jan 2025 (Aug 2024–Jul 2025), ¢/kWh. */
  electricityPriceChangeCents?: number | null
  /** State average residential use, kWh per customer per month (12-month average). */
  electricityUsageKwh?: number | null
}): DollarImpact {
  return {
    groceries: computeGroceryImpact(opts.groceriesChangePct),
    shelter: computeShelterImpact(opts.rentIndexChangePct, opts.medianRent),
    gas: finiteOrNull(opts.gasChange),
    electricity: computeElectricityImpact(opts.electricityPriceChangeCents, opts.electricityUsageKwh),
  }
}
