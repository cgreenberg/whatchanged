// Yale Budget Lab estimates tariffs cost ~2.03% of median household income
const TARIFF_COST_RATE = 0.0203

export function estimateTariffCost(medianIncome: number): number {
  if (medianIncome <= 0) return 0
  return Math.round(medianIncome * TARIFF_COST_RATE)
}

export function formatDollars(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}
