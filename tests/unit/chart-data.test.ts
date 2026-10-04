import { eraSpans, normalizeEachSeries, filterByTimeframe, ERA_FILL, onOrAfter } from '@/lib/charts/chart-data'

describe('era shading', () => {
  test('spec opacity 0.07', () => {
    expect(ERA_FILL.blue).toBe('rgba(59, 130, 246, 0.07)')
    expect(ERA_FILL.red).toBe('rgba(239, 68, 68, 0.07)')
  })

  test('weekly gas: Jan 6–13 2025 stay in the Biden band; Trump II starts at the first week ≥ Jan 20', () => {
    const dates = ['2024-12-30', '2025-01-06', '2025-01-13', '2025-01-20', '2025-01-27', '2025-02-03']
    const spans = eraSpans(dates)
    const biden = spans.find(s => s.key === 'biden')!
    const trump = spans.find(s => s.key === 'trump2')!
    expect(biden).toEqual({ key: 'biden', x1: '2024-12-30', x2: '2025-01-20', color: 'blue' })
    expect(trump).toEqual({ key: 'trump2', x1: '2025-01-20', x2: '2025-02-03', color: 'red' })
  })

  test('monthly data: the Jan 2025 point (the baseline) opens the Trump II band', () => {
    expect(onOrAfter('2025-01', '2025-01-20')).toBe(true)
    const spans = eraSpans(['2024-11', '2024-12', '2025-01', '2025-02'])
    expect(spans.find(s => s.key === 'trump2')!.x1).toBe('2025-01')
  })

  test('window entirely after the baseline → a single band', () => {
    expect(eraSpans(['2025-01', '2025-06', '2026-08']).map(s => s.key)).toEqual(['trump2'])
  })
})

describe('normalizeEachSeries', () => {
  test('each series uses its own first value (national overlay starting later is not left raw)', () => {
    const rows = [
      { date: '2025-01', shelter: 200 },
      { date: '2025-02', shelter: 202, national_shelter: 300 },
      { date: '2025-03', shelter: 204, national_shelter: 303 },
    ]
    const out = normalizeEachSeries(rows)
    expect(out[0].shelter).toBeCloseTo(0)
    expect(out[2].shelter).toBeCloseTo(2)
    expect(out[1].national_shelter).toBeCloseTo(0)
    expect(out[2].national_shelter).toBeCloseTo(1)
  })

  test('first local value null → base is the first non-null value', () => {
    const out = normalizeEachSeries([
      { date: '2025-01', shelter: null },
      { date: '2025-02', shelter: 204 },
      { date: '2025-03', shelter: 206 },
    ])
    expect(out[1].shelter).toBeCloseTo(0)
    expect(out[0].shelter).toBeNull()
  })
})

describe('filterByTimeframe', () => {
  const monthly = Array.from({ length: 130 }, (_, i) => {
    const y = 2015 + Math.floor((i + 8) / 12)
    const m = ((i + 8) % 12) + 1
    return { date: `${y}-${String(m).padStart(2, '0')}` }
  })

  test('Jan 2025 view starts at the baseline month', () => {
    expect(filterByTimeframe(monthly, 'Jan 2025')[0].date).toBe('2025-01')
  })

  test('3Y window is measured back from the latest data point, not today', () => {
    const last = monthly[monthly.length - 1].date
    const [y, m] = last.split('-')
    expect(filterByTimeframe(monthly, '3Y')[0].date).toBe(`${Number(y) - 3}-${m}`)
  })

  test('weekly gas Jan 2025 view starts at the baseline week', () => {
    const weekly = [{ date: '2025-01-06' }, { date: '2025-01-13' }, { date: '2025-01-20' }, { date: '2025-01-27' }]
    expect(filterByTimeframe(weekly, 'Jan 2025', true)[0].date).toBe('2025-01-20')
  })
})
