import { estimateTariffCost, TARIFF_COST_RATE } from '@/lib/tariff'

describe('estimateTariffCost = median household income × 0.0205 (Yale Budget Lab)', () => {
  test('rate is 2.05%', () => {
    expect(TARIFF_COST_RATE).toBe(0.0205)
  })

  test.each([50000, 74580, 83821, 154867, 500000])('income %i → Math.round(income × 0.0205)', income => {
    expect(estimateTariffCost(income)).toBe(Math.round(income * 0.0205))
  })

  test('83,821 → 1,718', () => {
    expect(estimateTariffCost(83821)).toBe(1718)
  })

  test('result is always an integer', () => {
    for (const income of [1, 50001, 75555, 120321]) {
      expect(Number.isInteger(estimateTariffCost(income))).toBe(true)
    }
  })

  test('zero or negative income → 0 (guard against bad data)', () => {
    expect(estimateTariffCost(0)).toBe(0)
    expect(estimateTariffCost(-1)).toBe(0)
    expect(estimateTariffCost(-100000)).toBe(0)
  })
})
