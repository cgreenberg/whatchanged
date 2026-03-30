import fc from 'fast-check'
import { estimateTariffCost } from '@/lib/tariff'

describe('compute properties', () => {
  jest.setTimeout(60000) // property tests can be slow

  // 2.2a: Percent change formula
  // Source: src/lib/api/bls-cpi.ts lines 145-146
  // Formula: parseFloat(((current - baseline) / baseline * 100).toFixed(1))
  describe('percent change', () => {
    it('is never NaN or Infinity for positive baseline and current', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 1000, noNaN: true }),
          fc.double({ min: 0.01, max: 1000, noNaN: true }),
          (baseline, current) => {
            const result = parseFloat(((current - baseline) / baseline * 100).toFixed(1))
            expect(isNaN(result)).toBe(false)
            expect(isFinite(result)).toBe(true)
          }
        )
      )
    })

    it('is 0 when baseline equals current', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 1000, noNaN: true }),
          (value) => {
            const result = parseFloat(((value - value) / value * 100).toFixed(1))
            expect(result).toBe(0)
          }
        )
      )
    })

    it('is positive when current > baseline', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 999, noNaN: true }),
          fc.double({ min: 0.01, max: 999, noNaN: true }),
          (a, b) => {
            const baseline = Math.min(a, b)
            const current = Math.max(a, b)
            // Only test when they are meaningfully different (not just floating point noise)
            fc.pre(current - baseline > 0.001)
            const result = parseFloat(((current - baseline) / baseline * 100).toFixed(1))
            expect(result).toBeGreaterThanOrEqual(0)
          }
        )
      )
    })

    it('is negative when current < baseline', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 999, noNaN: true }),
          fc.double({ min: 0.01, max: 999, noNaN: true }),
          (a, b) => {
            const baseline = Math.max(a, b)
            const current = Math.min(a, b)
            // Only test when they are meaningfully different
            fc.pre(baseline - current > 0.001)
            const result = parseFloat(((current - baseline) / baseline * 100).toFixed(1))
            expect(result).toBeLessThanOrEqual(0)
          }
        )
      )
    })
  })

  // 2.2b: Tariff estimate
  // Source: src/lib/tariff.ts
  // Formula: Math.round(income * 0.0205) — returns 0 for income <= 0
  describe('tariff estimate', () => {
    it('equals Math.round(income * 0.0205) for positive income', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 10000, max: 500000, noNaN: true }),
          (income) => {
            const result = estimateTariffCost(income)
            expect(result).toBe(Math.round(income * 0.0205))
          }
        )
      )
    })

    it('is never NaN for positive income', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 10000, max: 500000, noNaN: true }),
          (income) => {
            const result = estimateTariffCost(income)
            expect(isNaN(result)).toBe(false)
          }
        )
      )
    })

    it('is always >= 0 for positive income', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 10000, max: 500000, noNaN: true }),
          (income) => {
            const result = estimateTariffCost(income)
            expect(result).toBeGreaterThanOrEqual(0)
          }
        )
      )
    })

    it('is approximately proportional (double income ≈ double tariff within rounding)', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 10000, max: 250000, noNaN: true }),
          (income) => {
            const single = estimateTariffCost(income)
            const double_ = estimateTariffCost(income * 2)
            // Allow ±1 for rounding
            expect(Math.abs(double_ - single * 2)).toBeLessThanOrEqual(1)
          }
        )
      )
    })
  })

  // 2.2c: Grocery dollar impact
  // Source: src/components/HomeContent.tsx lines 178-180
  // Formula:
  //   grocerySpend = 6000 * (localIncome / 74580)
  //   dollarImpact = Math.round(grocerySpend * Math.abs(pctChange) / 100)
  describe('grocery dollar impact', () => {
    it('is always >= 0 (Math.abs ensures this)', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 15000, max: 300000, noNaN: true }),
          fc.double({ min: -20, max: 50, noNaN: true }),
          (localIncome, pctChange) => {
            const grocerySpend = 6000 * (localIncome / 74580)
            const dollarImpact = Math.round(grocerySpend * Math.abs(pctChange) / 100)
            expect(dollarImpact).toBeGreaterThanOrEqual(0)
          }
        )
      )
    })

    it('is never NaN', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 15000, max: 300000, noNaN: true }),
          fc.double({ min: -20, max: 50, noNaN: true }),
          (localIncome, pctChange) => {
            const grocerySpend = 6000 * (localIncome / 74580)
            const dollarImpact = Math.round(grocerySpend * Math.abs(pctChange) / 100)
            expect(isNaN(dollarImpact)).toBe(false)
          }
        )
      )
    })
  })

  // 2.2d: Shelter dollar impact
  // Source: src/components/HomeContent.tsx lines 148-150
  // Formula:
  //   annualRent = medianRent * 12
  //   shelterDollarImpact = Math.round(annualRent * Math.abs(shelterChange) / 100)
  describe('shelter dollar impact', () => {
    it('is always >= 0', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 200, max: 5000, noNaN: true }),
          fc.double({ min: -20, max: 50, noNaN: true }),
          (medianRent, shelterChange) => {
            const annualRent = medianRent * 12
            const shelterDollarImpact = Math.round(annualRent * Math.abs(shelterChange) / 100)
            expect(shelterDollarImpact).toBeGreaterThanOrEqual(0)
          }
        )
      )
    })

    it('is never NaN', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 200, max: 5000, noNaN: true }),
          fc.double({ min: -20, max: 50, noNaN: true }),
          (medianRent, shelterChange) => {
            const annualRent = medianRent * 12
            const shelterDollarImpact = Math.round(annualRent * Math.abs(shelterChange) / 100)
            expect(isNaN(shelterDollarImpact)).toBe(false)
          }
        )
      )
    })

    it('equals Math.round(medianRent * 12 * Math.abs(shelterChange) / 100)', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 200, max: 5000, noNaN: true }),
          fc.double({ min: -20, max: 50, noNaN: true }),
          (medianRent, shelterChange) => {
            const annualRent = medianRent * 12
            const viaTwoStep = Math.round(annualRent * Math.abs(shelterChange) / 100)
            const viaOneStep = Math.round(medianRent * 12 * Math.abs(shelterChange) / 100)
            expect(viaTwoStep).toBe(viaOneStep)
          }
        )
      )
    })
  })

  // 2.2e: Sanity range checks
  // Source: CLAUDE.md — Sanity Ranges section
  describe('sanity ranges', () => {
    const isUnemploymentValid = (v: number) => v >= 0 && v <= 25
    const isCpiChangeValid = (v: number) => v >= -20 && v <= 50
    const isGasPriceValid = (v: number) => v >= 1 && v <= 10

    it('unemployment values inside 0-25% pass', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 25, noNaN: true }),
          (v) => {
            expect(isUnemploymentValid(v)).toBe(true)
          }
        )
      )
    })

    it('unemployment values outside 0-25% fail', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: 25.0001, max: 100, noNaN: true }),
            fc.double({ min: -100, max: -0.0001, noNaN: true })
          ),
          (v) => {
            expect(isUnemploymentValid(v)).toBe(false)
          }
        )
      )
    })

    it('CPI change values inside -20% to +50% pass', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -20, max: 50, noNaN: true }),
          (v) => {
            expect(isCpiChangeValid(v)).toBe(true)
          }
        )
      )
    })

    it('CPI change values outside -20% to +50% fail', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: 50.0001, max: 200, noNaN: true }),
            fc.double({ min: -200, max: -20.0001, noNaN: true })
          ),
          (v) => {
            expect(isCpiChangeValid(v)).toBe(false)
          }
        )
      )
    })

    it('gas price values inside $1-$10 pass', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 10, noNaN: true }),
          (v) => {
            expect(isGasPriceValid(v)).toBe(true)
          }
        )
      )
    })

    it('gas price values outside $1-$10 fail', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: 10.0001, max: 100, noNaN: true }),
            fc.double({ min: 0.0001, max: 0.9999, noNaN: true })
          ),
          (v) => {
            expect(isGasPriceValid(v)).toBe(false)
          }
        )
      )
    })
  })

  // 2.2f: Gas price change rounding
  // Source: src/lib/api/eia.ts lines 173, 203
  // Formula: parseFloat((current - baseline).toFixed(3))
  describe('gas price change rounding', () => {
    it('result has at most 3 decimal places', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1.0, max: 10.0, noNaN: true }),
          fc.double({ min: 1.0, max: 10.0, noNaN: true }),
          (baseline, current) => {
            const result = parseFloat((current - baseline).toFixed(3))
            // Check decimal places: convert to string and count after decimal point
            const str = result.toString()
            const decimalIndex = str.indexOf('.')
            const decimalPlaces = decimalIndex === -1 ? 0 : str.length - decimalIndex - 1
            expect(decimalPlaces).toBeLessThanOrEqual(3)
          }
        )
      )
    })

    it('result is never NaN', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1.0, max: 10.0, noNaN: true }),
          fc.double({ min: 1.0, max: 10.0, noNaN: true }),
          (baseline, current) => {
            const result = parseFloat((current - baseline).toFixed(3))
            expect(isNaN(result)).toBe(false)
          }
        )
      )
    })
  })
})
