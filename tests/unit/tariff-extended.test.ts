// Extended tariff tests — edge cases not covered in tariff.test.ts
import { estimateTariffCost, formatDollars } from '@/lib/tariff'

// The actual rate in the source file is 0.0205 (Yale Budget Lab estimate)
const TARIFF_RATE = 0.0205

describe('estimateTariffCost — extended edge cases', () => {
  test('returns 0 for exactly 0 income', () => {
    expect(estimateTariffCost(0)).toBe(0)
  })

  test('returns 0 for negative income (guard against bad data)', () => {
    expect(estimateTariffCost(-1)).toBe(0)
    expect(estimateTariffCost(-100000)).toBe(0)
  })

  test('uses rate of approximately 2% (0.0205)', () => {
    // Verify the constant matches the Yale Budget Lab ~2.05% rate
    const income = 100000
    const cost = estimateTariffCost(income)
    // Should be Math.round(100000 * 0.0205) = 2050
    expect(cost).toBe(Math.round(income * TARIFF_RATE))
  })

  test('scales correctly with high income ($500,000)', () => {
    const cost = estimateTariffCost(500000)
    expect(cost).toBe(Math.round(500000 * TARIFF_RATE))
    expect(cost).toBeGreaterThan(0)
  })

  test('handles very low positive income ($1)', () => {
    // Math.round(1 * 0.0203) = 0, but input > 0 is valid
    const cost = estimateTariffCost(1)
    expect(cost).toBeGreaterThanOrEqual(0)
    expect(isNaN(cost)).toBe(false)
  })

  test('result is always an integer (Math.round applied)', () => {
    // Test several incomes to ensure no decimal output
    const incomes = [50000, 75000, 83821, 120000, 250000]
    for (const income of incomes) {
      const cost = estimateTariffCost(income)
      expect(cost).toBe(Math.floor(cost)) // integer check
    }
  })

  test('result is never NaN for valid inputs', () => {
    const incomes = [0, 1, 50000, 100000, 500000]
    for (const income of incomes) {
      expect(isNaN(estimateTariffCost(income))).toBe(false)
    }
  })

  test('result is never Infinity', () => {
    expect(isFinite(estimateTariffCost(Number.MAX_SAFE_INTEGER))).toBe(true)
  })
})

describe('formatDollars — extended cases', () => {
  test('formats 1 dollar', () => {
    expect(formatDollars(1)).toBe('$1')
  })

  test('formats 1000 with comma', () => {
    expect(formatDollars(1000)).toBe('$1,000')
  })

  test('formats 1000000 as $1,000,000', () => {
    expect(formatDollars(1000000)).toBe('$1,000,000')
  })

  test('always returns a string starting with $', () => {
    const amounts = [0, 100, 1234, 83821]
    for (const amount of amounts) {
      expect(formatDollars(amount)).toMatch(/^\$/)
    }
  })

  test('no decimal places (maximumFractionDigits: 0)', () => {
    // Should never show cents
    expect(formatDollars(1702)).not.toContain('.')
    expect(formatDollars(100)).not.toContain('.')
  })
})
