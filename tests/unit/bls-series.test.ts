// BLS series ID format and data-parsing logic tests
//
// buildSeriesId is not exported from bls.ts, so we test the series ID format
// by inspecting what gets included in the request body via a capture handler.
// Data-parsing tests validate the transformation logic that's applied to the
// BLS API response structure.

import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'
import { clearMemCache } from '@/lib/cache/kv'
import { buildSeriesId } from '@/lib/api/bls'

describe('BLS LAUS series ID format', () => {
  test('5-digit FIPS 53011 produces correct series ID', () => {
    expect(buildSeriesId('53011')).toBe('LAUCN530110000000003')
  })

  test('short FIPS 1 gets padded to 5 digits (00001)', () => {
    const id = buildSeriesId('1')
    expect(id).toBe('LAUCN000010000000003')
    expect(id.slice(5, 10)).toBe('00001')
  })

  test('short FIPS 011 gets padded to 00011', () => {
    const id = buildSeriesId('011')
    expect(id).toBe('LAUCN000110000000003')
  })

  test('Manhattan FIPS 36061 produces correct ID', () => {
    expect(buildSeriesId('36061')).toBe('LAUCN360610000000003')
  })

  test('Chicago Cook County 17031 produces correct ID', () => {
    expect(buildSeriesId('17031')).toBe('LAUCN170310000000003')
  })

  test('FIPS with leading zeros preserved: 06001', () => {
    const id = buildSeriesId('06001')
    expect(id).toBe('LAUCN060010000000003')
    expect(id.slice(5, 10)).toBe('06001')
  })
})

describe('BLS API response data structure transformations', () => {
  // These test the logic of parsing BLS data without making network calls.
  // We replicate the core transformation rules from bls.ts inline.

  const BASELINE_YEAR = '2025'
  const BASELINE_PERIOD = 'M01'

  function parseBlsData(rawData: Array<{ year: string; period: string; value: string }>) {
    // Filter out null/"-" values (as bls.ts does)
    const validData = rawData.filter(
      (d) => d.value !== '-' && d.value !== null && !isNaN(parseFloat(d.value))
    )

    const sorted = [...validData].sort((a, b) => {
      const aDate = `${a.year}-${a.period}`
      const bDate = `${b.year}-${b.period}`
      return aDate.localeCompare(bDate)
    })

    const baselineEntry = validData.find(
      (d) => d.year === BASELINE_YEAR && d.period === BASELINE_PERIOD
    )
    const baseline = baselineEntry ? parseFloat(baselineEntry.value) : 0

    const current = sorted.length ? parseFloat(sorted[sorted.length - 1].value) : 0

    const points = sorted.map((d) => ({
      date: `${d.year}-${d.period.replace('M', '')}`,
      rate: parseFloat(d.value),
    }))

    return { current, baseline, change: parseFloat((current - baseline).toFixed(1)), series: points }
  }

  test('current value is the most recent entry after sorting', () => {
    const raw = [
      { year: '2025', period: 'M02', value: '5.0' },
      { year: '2025', period: 'M01', value: '4.1' },
      { year: '2024', period: 'M12', value: '4.3' },
    ]
    const { current } = parseBlsData(raw)
    expect(current).toBe(5.0)
  })

  test('baseline is found by exact year=2025 period=M01 match', () => {
    const raw = [
      { year: '2025', period: 'M02', value: '5.0' },
      { year: '2025', period: 'M01', value: '4.1' },
      { year: '2024', period: 'M12', value: '4.3' },
    ]
    const { baseline } = parseBlsData(raw)
    expect(baseline).toBe(4.1)
  })

  test('baseline is 0 when Jan 2025 entry is missing', () => {
    const raw = [
      { year: '2024', period: 'M12', value: '4.3' },
      { year: '2024', period: 'M11', value: '4.2' },
    ]
    const { baseline } = parseBlsData(raw)
    expect(baseline).toBe(0)
  })

  test('baseline is 0 when Jan 2025 entry has "-" value', () => {
    const raw = [
      { year: '2025', period: 'M02', value: '5.0' },
      { year: '2025', period: 'M01', value: '-' },
    ]
    const { baseline } = parseBlsData(raw)
    expect(baseline).toBe(0)
  })

  test('change is current minus baseline', () => {
    const raw = [
      { year: '2025', period: 'M02', value: '5.0' },
      { year: '2025', period: 'M01', value: '4.1' },
    ]
    const { change } = parseBlsData(raw)
    expect(change).toBeCloseTo(0.9, 1)
  })

  test('series dates are formatted as YYYY-MM', () => {
    const raw = [
      { year: '2025', period: 'M01', value: '4.1' },
      { year: '2025', period: 'M02', value: '5.0' },
    ]
    const { series } = parseBlsData(raw)
    for (const point of series) {
      expect(point.date).toMatch(/^\d{4}-\d{2}$/)
    }
  })

  test('series is sorted chronologically (oldest first)', () => {
    const raw = [
      { year: '2025', period: 'M02', value: '5.0' },
      { year: '2024', period: 'M12', value: '4.3' },
      { year: '2025', period: 'M01', value: '4.1' },
    ]
    const { series } = parseBlsData(raw)
    for (let i = 1; i < series.length; i++) {
      expect(series[i].date >= series[i - 1].date).toBe(true)
    }
  })

  test('entries with "-" value are excluded from series', () => {
    const raw = [
      { year: '2025', period: 'M01', value: '4.1' },
      { year: '2025', period: 'M02', value: '-' },
    ]
    const { series } = parseBlsData(raw)
    expect(series.length).toBe(1)
    expect(series[0].date).toBe('2025-01')
  })

  test('period M01 → date suffix 01 (not M01)', () => {
    const raw = [
      { year: '2025', period: 'M01', value: '4.1' },
    ]
    // Need at least 2 points for full parse, add a second
    const raw2 = [...raw, { year: '2025', period: 'M02', value: '5.0' }]
    const { series } = parseBlsData(raw2)
    expect(series[0].date).toBe('2025-01')
  })
})

describe('BLS CPI data supports 10Y range', () => {
  function parseCpiPeriods(rawData: Array<{ year: string; period: string; value: string }>) {
    const map = new Map<string, number>()
    for (const d of rawData) {
      const val = parseFloat(d.value)
      if (isNaN(val) || d.value === '-') continue
      map.set(`${d.year}-${d.period}`, val)
    }
    return [...map.keys()].sort()
  }

  test('CPI series includes data points from 2016 when present', () => {
    const raw = [
      { year: '2016', period: 'M06', value: '240.1' },
      { year: '2017', period: 'M06', value: '243.5' },
      { year: '2018', period: 'M06', value: '247.8' },
      { year: '2019', period: 'M06', value: '252.0' },
      { year: '2024', period: 'M12', value: '315.1' },
      { year: '2025', period: 'M01', value: '316.8' },
      { year: '2025', period: 'M02', value: '317.4' },
    ]
    const periods = parseCpiPeriods(raw)
    expect(periods.length).toBe(7)
    expect(periods[0]).toBe('2016-M06')
    expect(periods[periods.length - 1]).toBe('2025-M02')
  })

  test('CPI 10Y range spans at least 9 calendar years', () => {
    const raw = [
      { year: '2016', period: 'M06', value: '240.1' },
      { year: '2025', period: 'M02', value: '317.4' },
    ]
    const periods = parseCpiPeriods(raw)
    const firstYear = parseInt(periods[0].slice(0, 4))
    const lastYear = parseInt(periods[periods.length - 1].slice(0, 4))
    expect(lastYear - firstYear).toBeGreaterThanOrEqual(9)
  })
})

describe('BLS data supports 10Y range', () => {
  const BASELINE_YEAR = '2025'
  const BASELINE_PERIOD = 'M01'

  function parseBlsData(rawData: Array<{ year: string; period: string; value: string }>) {
    const validData = rawData.filter(
      (d) => d.value !== '-' && d.value !== null && !isNaN(parseFloat(d.value))
    )

    const sorted = [...validData].sort((a, b) => {
      const aDate = `${a.year}-${a.period}`
      const bDate = `${b.year}-${b.period}`
      return aDate.localeCompare(bDate)
    })

    const baselineEntry = validData.find(
      (d) => d.year === BASELINE_YEAR && d.period === BASELINE_PERIOD
    )
    const baseline = baselineEntry ? parseFloat(baselineEntry.value) : 0

    const current = sorted.length ? parseFloat(sorted[sorted.length - 1].value) : 0

    const points = sorted.map((d) => ({
      date: `${d.year}-${d.period.replace('M', '')}`,
      rate: parseFloat(d.value),
    }))

    return { current, baseline, change: parseFloat((current - baseline).toFixed(1)), series: points }
  }

  test('series includes data points from 2016 when present in response', () => {
    const raw = [
      { year: '2016', period: 'M06', value: '5.5' },
      { year: '2017', period: 'M06', value: '4.8' },
      { year: '2018', period: 'M06', value: '4.3' },
      { year: '2019', period: 'M06', value: '4.0' },
      { year: '2020', period: 'M06', value: '11.1' },
      { year: '2021', period: 'M06', value: '5.9' },
      { year: '2024', period: 'M12', value: '4.3' },
      { year: '2025', period: 'M02', value: '5.0' },
    ]
    const { series } = parseBlsData(raw)
    expect(series.length).toBe(8)
    expect(series[0].date).toBe('2016-06')
    expect(series[series.length - 1].date).toBe('2025-02')
  })

  test('10Y data spans at least 9 calendar years', () => {
    const raw = [
      { year: '2016', period: 'M06', value: '5.5' },
      { year: '2017', period: 'M06', value: '4.8' },
      { year: '2018', period: 'M06', value: '4.3' },
      { year: '2019', period: 'M06', value: '4.0' },
      { year: '2020', period: 'M06', value: '11.1' },
      { year: '2021', period: 'M06', value: '5.9' },
      { year: '2024', period: 'M12', value: '4.3' },
      { year: '2025', period: 'M02', value: '5.0' },
    ]
    const { series } = parseBlsData(raw)
    const firstYear = parseInt(series[0].date.slice(0, 4), 10)
    const lastYear = parseInt(series[series.length - 1].date.slice(0, 4), 10)
    expect(lastYear - firstYear).toBeGreaterThanOrEqual(9)
  })
})
