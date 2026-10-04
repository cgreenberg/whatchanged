// Yale Budget Lab estimates tariffs cost ~2.05% of median household income
export const TARIFF_COST_RATE = 0.0205

export function estimateTariffCost(medianIncome: number): number {
  if (medianIncome <= 0) return 0
  return Math.round(medianIncome * TARIFF_COST_RATE)
}
