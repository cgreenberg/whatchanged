import {
  computeGroceryImpact,
  computeShelterImpact,
  computeDollarImpact,
  ANNUAL_GROCERY_BASE,
  NATIONAL_MEDIAN_INCOME,
} from '@/lib/compute/dollar-translations'

describe('computeGroceryImpact = $6,000/yr × % change (signed)', () => {
  test('+2.6% → +$156', () => {
    expect(ANNUAL_GROCERY_BASE).toBe(6000)
    expect(computeGroceryImpact(2.6)).toBe(156)
  })

  test('-1% → -$60 (sign preserved, not +$60)', () => {
    expect(computeGroceryImpact(-1)).toBe(-60)
  })

  test('0% → $0', () => {
    expect(computeGroceryImpact(0)).toBe(0)
  })

  test('missing / non-finite change → null', () => {
    expect(computeGroceryImpact(null)).toBeNull()
    expect(computeGroceryImpact(undefined)).toBeNull()
    expect(computeGroceryImpact(NaN)).toBeNull()
  })
})

describe('computeShelterImpact = local median rent × 12 × % change (signed)', () => {
  test('rent $1,400, +3.5% → +$588', () => {
    expect(computeShelterImpact(3.5, 1400)).toBe(588)
  })

  test('rent $1,400, -3.5% → -$588', () => {
    expect(computeShelterImpact(-3.5, 1400)).toBe(-588)
  })

  test('missing local rent → null (no national fallback)', () => {
    expect(computeShelterImpact(3.5, null)).toBeNull()
    expect(computeShelterImpact(3.5, undefined)).toBeNull()
    expect(computeShelterImpact(3.5, 0)).toBeNull()
  })

  test('missing change → null', () => {
    expect(computeShelterImpact(undefined, 1400)).toBeNull()
  })
})

describe('computeDollarImpact', () => {
  test('gas preserves sign', () => {
    expect(computeDollarImpact({ gasChange: -0.52 }).gas).toBe(-0.52)
    expect(computeDollarImpact({ gasChange: 1.04 }).gas).toBe(1.04)
  })

  test('tariff reuses pre-computed value', () => {
    expect(computeDollarImpact({ tariffEstimatedCost: 1278 }).tariff).toBe(1278)
  })

  test('all impacts are null (not 0) when no data provided', () => {
    expect(computeDollarImpact({})).toEqual({ groceries: null, shelter: null, gas: null, tariff: null })
  })

  test('combines the individual functions', () => {
    const r = computeDollarImpact({
      groceriesChangePct: -2.6,
      shelterChangePct: 3.5,
      gasChange: -0.52,
      tariffEstimatedCost: 1278,
      medianRent: 1400,
    })
    expect(r).toEqual({ groceries: -156, shelter: 588, gas: -0.52, tariff: 1278 })
  })
})

test('single national median income constant', () => {
  expect(NATIONAL_MEDIAN_INCOME).toBe(74580)
})
