import { computeTrendline } from '@/lib/charts/trendline'

describe('computeTrendline', () => {
  test('returns empty array for empty input', () => {
    expect(computeTrendline([], 'value')).toEqual([])
  })

  test('returns empty array for single data point', () => {
    const data = [{ date: '2024-01', value: 5 }]
    expect(computeTrendline(data, 'value')).toEqual([])
  })

  test('returns trend for exactly 2 points', () => {
    const data = [
      { date: '2024-01', value: 2 },
      { date: '2024-02', value: 4 },
    ]
    const result = computeTrendline(data, 'value')
    expect(result.length).toBe(2)
    // Perfect linear slope of 2: intercept=2, slope=2
    expect(result[0].trend).toBeCloseTo(2, 5)
    expect(result[1].trend).toBeCloseTo(4, 5)
  })

  test('computes correct trend for perfectly linear increasing data', () => {
    const data = [
      { date: '2024-01', value: 1 },
      { date: '2024-02', value: 2 },
      { date: '2024-03', value: 3 },
      { date: '2024-04', value: 4 },
    ]
    const result = computeTrendline(data, 'value')
    expect(result.length).toBe(4)
    expect(result[0].trend).toBeCloseTo(1, 0)
    expect(result[3].trend).toBeCloseTo(4, 0)
  })

  test('computes correct trend for perfectly linear decreasing data', () => {
    const data = [
      { date: '2024-01', value: 10 },
      { date: '2024-02', value: 7 },
      { date: '2024-03', value: 4 },
      { date: '2024-04', value: 1 },
    ]
    const result = computeTrendline(data, 'value')
    expect(result.length).toBe(4)
    expect(result[0].trend).toBeCloseTo(10, 0)
    expect(result[3].trend).toBeCloseTo(1, 0)
    // Slope should be negative
    expect(result[0].trend).toBeGreaterThan(result[3].trend)
  })

  test('output preserves original dates', () => {
    const data = [
      { date: '2025-01', value: 5 },
      { date: '2025-02', value: 6 },
      { date: '2025-03', value: 7 },
    ]
    const result = computeTrendline(data, 'value')
    expect(result[0].date).toBe('2025-01')
    expect(result[1].date).toBe('2025-02')
    expect(result[2].date).toBe('2025-03')
  })

  test('output length equals input length', () => {
    const data = [
      { date: '2024-01', value: 3 },
      { date: '2024-02', value: 5 },
      { date: '2024-03', value: 4 },
      { date: '2024-04', value: 6 },
      { date: '2024-05', value: 5 },
    ]
    const result = computeTrendline(data, 'value')
    expect(result.length).toBe(data.length)
  })

  test('each output object has date and trend keys', () => {
    const data = [
      { date: '2025-01', value: 100 },
      { date: '2025-02', value: 105 },
      { date: '2025-03', value: 102 },
    ]
    const result = computeTrendline(data, 'value')
    for (const point of result) {
      expect(typeof point.date).toBe('string')
      expect(typeof point.trend).toBe('number')
      expect(isNaN(point.trend)).toBe(false)
    }
  })

  test('works with numeric string dataKey values cast to number', () => {
    // The function uses Number(d[dataKey]) — verify it works with numeric values
    const data = [
      { date: '2024-01', rate: 4.1 },
      { date: '2024-02', rate: 4.5 },
      { date: '2024-03', rate: 5.0 },
    ]
    const result = computeTrendline(data, 'rate')
    expect(result.length).toBe(3)
    expect(result[0].trend).not.toBeNaN()
  })

  test('ignores NaN values when computing regression', () => {
    // NaN entries are filtered from regression but index still used for output
    const data = [
      { date: '2024-01', value: 10 },
      { date: '2024-02', value: NaN },
      { date: '2024-03', value: 20 },
    ]
    // Should not throw; output length = 3
    const result = computeTrendline(data, 'value')
    expect(result.length).toBe(3)
    expect(isNaN(result[0].trend)).toBe(false)
  })

  test('trend for flat data is constant', () => {
    const data = [
      { date: '2024-01', value: 5 },
      { date: '2024-02', value: 5 },
      { date: '2024-03', value: 5 },
      { date: '2024-04', value: 5 },
    ]
    const result = computeTrendline(data, 'value')
    for (const point of result) {
      expect(point.trend).toBeCloseTo(5, 5)
    }
  })

  test('trend midpoint is close to data midpoint for noisy linear data', () => {
    const data = [
      { date: '2024-01', value: 10 },
      { date: '2024-02', value: 12 },
      { date: '2024-03', value: 11 },
      { date: '2024-04', value: 13 },
      { date: '2024-05', value: 12 },
    ]
    const result = computeTrendline(data, 'value')
    const midTrend = result[2].trend
    // midpoint trend should be close to the average (11.6)
    const avg = (10 + 12 + 11 + 13 + 12) / 5
    expect(midTrend).toBeCloseTo(avg, 0)
  })
})
