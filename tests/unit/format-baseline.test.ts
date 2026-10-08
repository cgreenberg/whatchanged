import { fmtSignedDollars, fmtSignedPct, fmtDollars, fmtMonthYear, fmtDay, fmtSignedPts, directionOf } from '@/lib/format'
import {
  BASELINE_DATE, BASELINE_MONTH, GAS_BASELINE_EARLIEST, CPI_BASELINE_EARLIEST,
  gasBaselineIndex, gasChangeSinceBaseline, monthlyChangeSinceBaseline,
} from '@/lib/baseline'
import { GAS_BASELINE_DATE, buildSeriesFromData } from '@/lib/api/eia'
import { BASELINE_PERIOD_KEY, EARLIEST_FALLBACK_BASELINE, findBaseline } from '@/lib/api/bls-common'
import { getCountyRent, rentMonthlyChange } from '@/lib/rent'
import { pagePath, shareImagePath, ogImagePath, parsePlaceQuery, pageUrl } from '@/lib/share-url'

describe('signed formatting', () => {
  test.each([
    [0.12, '+$0.12'],
    [-0.12, '−$0.12'],
    [0, '$0.00'],
    [-0.001, '$0.00'],
  ])('fmtSignedDollars(%p) → %s', (v, out) => expect(fmtSignedDollars(v)).toBe(out))

  test('whole dollars get separators and never "$-"', () => {
    expect(fmtSignedDollars(-1234, 0)).toBe('−$1,234')
    expect(fmtSignedDollars(186, 0)).toBe('+$186')
    expect(fmtDollars(3175)).toBe('$3,175')
  })

  test('percent and points', () => {
    expect(fmtSignedPct(3.14)).toBe('+3.1%')
    expect(fmtSignedPct(-2.3)).toBe('−2.3%')
    expect(fmtSignedPct(-0.04)).toBe('0.0%')
    expect(fmtSignedPts(0.6)).toBe('+0.6 pts')
    expect(directionOf(-0.04)).toBe('neutral')
  })

  test('dates come from data; bad input → "date unavailable"', () => {
    expect(fmtMonthYear('2026-08')).toBe('Aug 2026')
    expect(fmtDay('2026-09-28')).toBe('Sep 28, 2026')
    expect(fmtMonthYear(undefined)).toBe('date unavailable')
    expect(fmtMonthYear('garbage')).toBe('date unavailable')
  })
})

describe('one baseline rule for local and national', () => {
  test('client constants match the server constants', () => {
    expect(BASELINE_DATE).toBe(GAS_BASELINE_DATE)
    expect(BASELINE_MONTH).toBe(BASELINE_PERIOD_KEY)
    expect(CPI_BASELINE_EARLIEST).toBe(EARLIEST_FALLBACK_BASELINE)
    expect(GAS_BASELINE_EARLIEST).toBe('2025-01-06')
  })

  const weekly = [
    { date: '2024-12-30', price: 3.0 },
    { date: '2025-01-06', price: 3.05 },
    { date: '2025-01-13', price: 3.1 },
    { date: '2025-01-20', price: 3.11 },
    { date: '2025-01-27', price: 3.2 },
    { date: '2026-09-28', price: 3.4 },
  ]

  test('gas baseline = last weekly reading on or before Jan 20 2025 (same as server parser)', () => {
    expect(weekly[gasBaselineIndex(weekly)].date).toBe('2025-01-20')
    const server = buildSeriesFromData(
      weekly.map(p => ({ period: p.date, value: String(p.price) }) as never)
    )
    const client = gasChangeSinceBaseline(weekly)!
    expect(client.baselineDate).toBe(server.baselineDate)
    expect(client.baseline).toBe(server.baseline)
    expect(client.change).toBeCloseTo(server.change, 3)
  })

  test('national gas is NOT measured from the first week of January', () => {
    expect(gasChangeSinceBaseline(weekly)!.change).toBeCloseTo(3.4 - 3.11, 6)
  })

  test('monthly baseline: Jan 2025, else latest month back to Nov 2024 (same as server)', () => {
    const s = [
      { date: '2024-11', v: 100 },
      { date: '2024-12', v: 101 },
      { date: '2025-02', v: 103 },
      { date: '2026-08', v: 110 },
    ]
    const server = findBaseline(s.map(p => ({ date: p.date, value: p.v })))!
    const client = monthlyChangeSinceBaseline(s, p => p.v)!
    expect(client.baselinePeriod).toBe(server.period)
    expect(client.pct).toBeCloseTo(((110 - 101) / 101) * 100, 6)
  })
})

describe('county rent (Zillow ZORI)', () => {
  test('monthly $ change is consistent with the SA % change', () => {
    expect(rentMonthlyChange(1618, -2.3)).toBe(Math.round(1618 - 1618 / (1 - 0.023)))
    expect(rentMonthlyChange(2000, 0)).toBe(0)
  })

  test('lookup by county FIPS; unknown/invalid → null', () => {
    const travis = getCountyRent('48453')
    expect(travis).not.toBeNull()
    expect(travis!.geoName).toBe('Travis County, TX')
    expect(travis!.adjustment).toBe('seasonally adjusted by whatchanged')
    expect(travis!.monthlyChange).toBe(rentMonthlyChange(travis!.curRent, travis!.pct))
    expect(getCountyRent('99999')).toBeNull()
    expect(getCountyRent('abc')).toBeNull()
    expect(getCountyRent(undefined)).toBeNull()
  })
})

describe('share URLs keep city/state', () => {
  test('page, share image and OG image', () => {
    const q = { zip: '78701', city: 'austin', state: 'tx' }
    expect(pagePath(q)).toBe('/?zip=78701&city=austin&state=tx')
    expect(pageUrl({ zip: '78701' })).toBe('https://whatchanged.us/?zip=78701')
    expect(shareImagePath(q)).toBe('/api/share/78701?city=austin&state=tx')
    expect(shareImagePath({ zip: '78701' })).toBe('/api/share/78701')
    expect(ogImagePath(q, '2026-10')).toBe('/api/og?zip=78701&city=austin&state=tx&v=2026-10')
  })

  test('parsePlaceQuery validates the zip and requires both city and state', () => {
    expect(parsePlaceQuery('?zip=78701&city=austin&state=tx')).toEqual({ zip: '78701', city: 'austin', state: 'tx' })
    expect(parsePlaceQuery('?zip=78701&city=austin')).toEqual({ zip: '78701' })
    expect(parsePlaceQuery('?zip=7870')).toBeNull()
  })
})
