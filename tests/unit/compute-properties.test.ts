import fc from 'fast-check'
import { estimateTariffCost } from '@/lib/tariff'
import { pctChange } from '@/lib/api/bls-common'
import { computeGroceryImpact, computeShelterImpact } from '@/lib/compute/dollar-translations'
import { isValidCpi, isValidGasSeries } from '@/lib/api/validate'
import type { CpiData } from '@/types'
import type { GasSeriesData } from '@/lib/api/eia'

// Property tests of REAL code (no re-implemented formulas).
describe('compute properties', () => {
  jest.setTimeout(60000) // property tests can be slow

  describe('pctChange (bls-common)', () => {
    it('is finite and sign-correct for positive baseline', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 1000, noNaN: true }),
          fc.double({ min: 1, max: 1000, noNaN: true }),
          (baseline, current) => {
            const r = pctChange(current, baseline)!
            expect(Number.isFinite(r)).toBe(true)
            if (current - baseline > baseline * 0.001) expect(r).toBeGreaterThanOrEqual(0)
            if (baseline - current > baseline * 0.001) expect(r).toBeLessThanOrEqual(0)
          }
        )
      )
    })

    it('is null (never 0) for a zero/negative baseline', () => {
      fc.assert(
        fc.property(fc.double({ min: -100, max: 0, noNaN: true }), fc.double({ min: 1, max: 1000, noNaN: true }), (b, c) => {
          expect(pctChange(c, b)).toBeNull()
        })
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

  describe('dollar translations keep the sign of the change', () => {
    it('grocery impact has the same sign as the % change', () => {
      fc.assert(
        fc.property(fc.double({ min: -20, max: 50, noNaN: true }), (pct) => {
          const v = computeGroceryImpact(pct)!
          expect(Number.isFinite(v)).toBe(true)
          if (pct >= 0.01) expect(v).toBeGreaterThanOrEqual(0)
          if (pct <= -0.01) expect(v).toBeLessThanOrEqual(0)
        })
      )
    })

    it('shelter impact has the same sign as the % change and scales with rent', () => {
      fc.assert(
        fc.property(fc.double({ min: 200, max: 5000, noNaN: true }), fc.double({ min: -20, max: 50, noNaN: true }), (rent, pct) => {
          const v = computeShelterImpact(pct, rent)!
          expect(v).toBe(Math.round((rent * 12 * pct) / 100) || 0)
        })
      )
    })
  })

  describe('sanity validators (src/lib/api/validate.ts)', () => {
    const cpi = (groceriesChange: number, shelterChange?: number): CpiData => ({
      groceriesCurrent: 110, groceriesBaseline: 100, groceriesChange,
      ...(shelterChange !== undefined ? { shelterChange } : {}),
      series: [], metro: 'X', tier: 2,
    })
    const gas = (current: number, baseline = 3): GasSeriesData => ({
      current, baseline, change: current - baseline, baselineDate: '2025-01-20', latestDate: '2025-02-24',
      series: [{ date: '2025-01-20', price: baseline }], regionName: 'X',
    })

    it('CPI change in [-20, 50] passes, outside fails', () => {
      fc.assert(fc.property(fc.double({ min: -20, max: 50, noNaN: true }), (v) => expect(isValidCpi(cpi(v))).toBe(true)))
      fc.assert(
        fc.property(
          fc.oneof(fc.double({ min: 50.0001, max: 500, noNaN: true }), fc.double({ min: -500, max: -20.0001, noNaN: true })),
          (v) => {
            expect(isValidCpi(cpi(v))).toBe(false)
            expect(isValidCpi(cpi(1, v))).toBe(false)
          }
        )
      )
    })

    it('gas $1–$10 passes, outside fails (current or baseline)', () => {
      fc.assert(fc.property(fc.double({ min: 1, max: 10, noNaN: true }), (v) => expect(isValidGasSeries(gas(v))).toBe(true)))
      fc.assert(
        fc.property(
          fc.oneof(fc.double({ min: 10.0001, max: 100, noNaN: true }), fc.double({ min: 0, max: 0.9999, noNaN: true })),
          (v) => {
            expect(isValidGasSeries(gas(v))).toBe(false)
            expect(isValidGasSeries(gas(3, v))).toBe(false)
          }
        )
      )
    })
  })
})
