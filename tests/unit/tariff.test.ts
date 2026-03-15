import { estimateTariffCost, formatDollars } from '@/lib/tariff'

describe('estimateTariffCost', () => {
  test('calculates correctly for median income', () => {
    const cost = estimateTariffCost(83821)
    expect(cost).toBe(1702)
  })

  test('returns 0 for zero income', () => {
    expect(estimateTariffCost(0)).toBe(0)
  })

  test('returns 0 for negative income', () => {
    expect(estimateTariffCost(-50000)).toBe(0)
  })
})

describe('formatDollars', () => {
  test('formats large numbers with commas', () => {
    expect(formatDollars(83821)).toBe('$83,821')
  })

  test('formats small numbers', () => {
    expect(formatDollars(0)).toBe('$0')
  })
})
