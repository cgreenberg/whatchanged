import { chartConfigs } from '@/lib/charts/chart-config'
import { computeTrendline } from '@/lib/charts/trendline'

describe('chartConfigs', () => {
  test('all configs have unique ids', () => {
    const ids = chartConfigs.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('all configs have at least one series', () => {
    for (const config of chartConfigs) {
      expect(config.series.length).toBeGreaterThan(0)
    }
  })

  test('order values are unique', () => {
    const orders = chartConfigs.map(c => c.order)
    expect(new Set(orders).size).toBe(orders.length)
  })
})

describe('computeTrendline', () => {
  test('computes linear trend for increasing data', () => {
    const data = [
      { date: '2024-01', value: 1 },
      { date: '2024-02', value: 2 },
      { date: '2024-03', value: 3 },
      { date: '2024-04', value: 4 },
    ]
    const trend = computeTrendline(data, 'value')
    expect(trend.length).toBe(4)
    // Trend should be roughly 1, 2, 3, 4 for perfectly linear data
    expect(trend[0].trend).toBeCloseTo(1, 0)
    expect(trend[3].trend).toBeCloseTo(4, 0)
  })

  test('returns empty for less than 2 points', () => {
    expect(computeTrendline([{ date: '2024-01', value: 1 }], 'value')).toEqual([])
  })
})
