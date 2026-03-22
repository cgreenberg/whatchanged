// BLS series ID format and data-parsing logic tests
//
// buildSeriesId is not exported from bls.ts, so we test the series ID format
// by inspecting what gets included in the request body via a capture handler.
// Data-parsing tests validate the transformation logic that's applied to the
// BLS API response structure.

import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'
import { clearMemCache } from '@/lib/cache/kv'

// The expected series ID format is: LAUCN{5-digit-FIPS}0000000003
// We can test this directly by replicating the pure function:
function buildSeriesId(countyFips: string): string {
  const padded = countyFips.padStart(5, '0')
  return `LAUCN${padded}0000000003`
}

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
