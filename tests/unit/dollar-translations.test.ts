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

describe('computeShelterImpact = local median rent × 12 × rent-of-primary-residence % change (signed)', () => {
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

  test('missing rent index change → null (never falls back to the CPI shelter %)', () => {
    expect(computeShelterImpact(undefined, 1400)).toBeNull()
    expect(computeShelterImpact(NaN, 1400)).toBeNull()
  })

  test('computeDollarImpact ignores any shelter % — only the rent index drives the shelter $', () => {
    const opts = { rentIndexChangePct: undefined, medianRent: 1400, shelterChangePct: 5 } as Parameters<typeof computeDollarImpact>[0]
    expect(computeDollarImpact(opts).shelter).toBeNull()
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
      rentIndexChangePct: 3.5,
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
