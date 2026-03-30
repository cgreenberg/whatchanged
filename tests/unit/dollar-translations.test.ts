import { computeGroceryImpact, computeShelterImpact, computeDollarImpact } from '@/lib/compute/dollar-translations'

describe('computeGroceryImpact', () => {
  test('NYC income (~$75k) with +2.6% change', () => {
    // 6000 * (75000/74580) * 2.6 / 100 = 156.98 → 157
    expect(computeGroceryImpact(2.6, 75000)).toBe(157)
  })

  test('uses fallback income (74580) when not provided', () => {
    // 6000 * (74580/74580) * 2.6 / 100 = 156 exactly
    expect(computeGroceryImpact(2.6)).toBe(156)
  })

  test('returns 0 when CPI change is 0', () => {
    expect(computeGroceryImpact(0, 75000)).toBe(0)
  })

  test('uses absolute value for negative change', () => {
    expect(computeGroceryImpact(-2.6, 75000)).toBe(157)
  })
})

describe('computeShelterImpact', () => {
  test('Vancouver WA (rent ~$1400) with +3.5% change', () => {
    // 1400 * 12 * 3.5 / 100 = 588
    expect(computeShelterImpact(3.5, 1400)).toBe(588)
  })

  test('uses fallback rent (1271) when not provided', () => {
    // 1271 * 12 * 3.5 / 100 = 533.82 → 534
    expect(computeShelterImpact(3.5)).toBe(534)
  })

  test('uses absolute value for negative change', () => {
    expect(computeShelterImpact(-3.5, 1400)).toBe(588)
  })
})

describe('computeDollarImpact', () => {
  test('gas preserves negative sign', () => {
    const result = computeDollarImpact({ gasChange: -0.52 })
    expect(result.gas).toBe(-0.52)
  })

  test('gas preserves positive sign', () => {
    const result = computeDollarImpact({ gasChange: 1.04 })
    expect(result.gas).toBe(1.04)
  })

  test('tariff reuses pre-computed value', () => {
    const result = computeDollarImpact({ tariffEstimatedCost: 1278 })
    expect(result.tariff).toBe(1278)
  })

  test('all impacts are 0 when no data provided', () => {
    const result = computeDollarImpact({})
    expect(result).toEqual({ groceries: 0, shelter: 0, gas: 0, tariff: 0 })
  })

  test('frontend fallback equals API value (same function)', () => {
    const apiResult = computeDollarImpact({
      groceriesChangePct: 2.6,
      shelterChangePct: 3.5,
      gasChange: -0.52,
      tariffEstimatedCost: 1278,
      localIncome: 75000,
      medianRent: 1400,
    })
    // Calling individual functions with the same inputs produces the same result
    expect(apiResult.groceries).toBe(computeGroceryImpact(2.6, 75000))
    expect(apiResult.shelter).toBe(computeShelterImpact(3.5, 1400))
    expect(apiResult.gas).toBe(-0.52)
    expect(apiResult.tariff).toBe(1278)
  })
})
