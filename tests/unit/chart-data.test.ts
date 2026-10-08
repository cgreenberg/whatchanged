import { normalizeEachSeries, filterByTimeframe, REFERENCE_DATES, onOrAfter } from '@/lib/charts/chart-data'

describe('reference dates (neutral, no party colors)', () => {
  test('January 2017, January 2021 and the Jan 20, 2025 baseline; no colors or party keys', () => {
    expect(REFERENCE_DATES.map(r => r.start)).toEqual(['2017-01-20', '2021-01-20', '2025-01-20'])
    for (const r of REFERENCE_DATES) {
      expect(Object.keys(r).sort()).toEqual(['key', 'label', 'start'])
      expect(r.key).not.toMatch(/trump|biden|obama/i)
    }
  })

  test('monthly data: the Jan 2025 point counts as on/after the Jan 20 baseline', () => {
    expect(onOrAfter('2025-01', '2025-01-20')).toBe(true)
    expect(onOrAfter('2025-01-13', '2025-01-20')).toBe(false)
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
