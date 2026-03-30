/**
 * Dollar impact calculations for hero cards.
 *
 * These formulas were previously computed inline in HomeContent.tsx.
 * They are now centralized here so both the API (snapshot.ts) and
 * the frontend (HomeContent.tsx fallback) use the same source of truth.
 */

const NATIONAL_MEDIAN_INCOME = 74580
const NATIONAL_MEDIAN_RENT = 1271
const ANNUAL_GROCERY_BASE = 6000

export interface DollarImpact {
  groceries: number
  shelter: number
  gas: number
  tariff: number
}

export function computeGroceryImpact(
  groceriesChangePct: number,
  localIncome: number = NATIONAL_MEDIAN_INCOME
): number {
  if (!Number.isFinite(groceriesChangePct)) return 0
  const grocerySpend = ANNUAL_GROCERY_BASE * (localIncome / NATIONAL_MEDIAN_INCOME)
  return Math.round(grocerySpend * Math.abs(groceriesChangePct) / 100)
}

export function computeShelterImpact(
  shelterChangePct: number,
  medianRent: number = NATIONAL_MEDIAN_RENT
): number {
  if (!Number.isFinite(shelterChangePct)) return 0
  const annualRent = medianRent * 12
  return Math.round(annualRent * Math.abs(shelterChangePct) / 100)
}

export function computeDollarImpact(opts: {
  groceriesChangePct?: number | null
  shelterChangePct?: number | null
  gasChange?: number | null
  tariffEstimatedCost?: number | null
  localIncome?: number
  medianRent?: number
}): DollarImpact {
  return {
    groceries: Number.isFinite(opts.groceriesChangePct)
      ? computeGroceryImpact(opts.groceriesChangePct!, opts.localIncome)
      : 0,
    shelter: Number.isFinite(opts.shelterChangePct)
      ? computeShelterImpact(opts.shelterChangePct!, opts.medianRent)
      : 0,
    gas: Number.isFinite(opts.gasChange) ? opts.gasChange! : 0,
    tariff: Number.isFinite(opts.tariffEstimatedCost) ? opts.tariffEstimatedCost! : 0,
  }
}
