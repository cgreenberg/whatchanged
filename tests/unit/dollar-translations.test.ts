import {
  computeGroceryImpact,
  computeShelterImpact,
  computeDollarImpact,
  computeElectricityImpact,
  ANNUAL_GROCERY_BASE,
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

  test('all impacts are null (not 0) when no data provided', () => {
    expect(computeDollarImpact({})).toEqual({ groceries: null, shelter: null, gas: null, electricity: null })
  })

  test('combines the individual functions', () => {
    const r = computeDollarImpact({
      groceriesChangePct: -2.6,
      rentIndexChangePct: 3.5,
      gasChange: -0.52,
      medianRent: 1400,
      electricitySaChangeCents: 6.13,
      electricityUsageKwh: 532,
    })
    expect(r).toEqual({ groceries: -156, shelter: 588, gas: -0.52, electricity: 33 })
  })
})

describe('computeElectricityImpact = price change (¢/kWh) × monthly use (kWh) ÷ 100, $/mo (signed)', () => {
  test('+6.13¢/kWh × 532 kWh → +$33/mo; −6.13¢ → −$33', () => {
    expect(computeElectricityImpact(6.13, 532)).toBe(33)
    expect(computeElectricityImpact(-6.13, 532)).toBe(-33)
  })

  test('a tiny change rounds to $0, never −$0', () => {
    expect(Object.is(computeElectricityImpact(-0.01, 500), 0)).toBe(true)
  })

  test('missing price change or usage → null', () => {
    expect(computeElectricityImpact(null, 500)).toBeNull()
    expect(computeElectricityImpact(1, null)).toBeNull()
    expect(computeElectricityImpact(1, 0)).toBeNull()
    expect(computeElectricityImpact(NaN, 500)).toBeNull()
  })
})
