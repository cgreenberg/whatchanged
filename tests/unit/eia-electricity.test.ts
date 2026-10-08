/**
 * EIA residential electricity (statewide): parser, 12-month average prices, usage, paging, cache, snapshot.
 * Driven by a recorded EIA response (tests/fixtures/eia-electricity-res.json, no key). Expected values
 * are EIA's published prices (Jan 2025 / Jul 2026) and figures computed independently from the raw
 * fixture, not by re-running the code under test.
 */
import fx from '../fixtures/eia-electricity-res.json'
import { server } from '../mocks/server'
import {
  buildElectricitySeries,
  buildElectricityByState,
  trailingAverage,
  averageUsage,
  monthRange,
  fetchElectricityRows,
  hasElectricitySeries,
  electricityCacheKey,
  ELECTRICITY_STATES,
  type EiaElectricityRow,
} from '@/lib/api/eia-electricity'
import { isValidElectricity } from '@/lib/api/validate'
import { withNationalElectricity, fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache, getCachedEnvelope } from '@/lib/cache/kv'
import { buildElectricityCard, buildHeroCards } from '@/lib/hero-cards'

const ROWS = fx.response.data as EiaElectricityRow[]
const price = (st: string, period: string) => Number(ROWS.find((r) => r.stateid === st && r.period === period)!.price)
/** Plain mean of the published monthly prices from..to (computed here from the raw fixture). */
const mean12 = (st: string, from: string, to: string) => {
  const ms = monthRange(from, to)
  expect(ms).toHaveLength(12)
  return ms.reduce((a, m) => a + price(st, m), 0) / 12
}

beforeEach(() => clearMemCache())

describe('buildElectricitySeries (recorded EIA rows)', () => {
  test('Maine: 12-month average price (Aug 2025–Jul 2026) vs the 12 months centered on Jan 2025, 12-month usage', () => {
    const d = buildElectricitySeries(ROWS, 'ME')
    expect(d).toMatchObject({ state: 'ME', stateName: 'Maine', seriesId: 'ELEC.PRICE.ME-RES.M', method: 'avg12c' })
    expect([d.baselineFrom, d.baselinePeriod]).toEqual(['2024-08', '2025-07'])
    expect([d.currentFrom, d.latestPeriod]).toEqual(['2025-08', '2026-07'])
    expect(d.baseline).toBeCloseTo(mean12('ME', '2024-08', '2025-07'), 3)
    expect(d.current).toBeCloseTo(mean12('ME', '2025-08', '2026-07'), 3)
    expect(d.change).toBeCloseTo((mean12('ME', '2025-08', '2026-07') / mean12('ME', '2024-08', '2025-07') - 1) * 100, 1)
    // Window ending Jan 2025 (centered on ~Aug 2024) would say +21.2%; centered on Jan 2025: +9.8%
    expect(d.change).toBeCloseTo(9.8, 0)
    // EIA published: 26.13¢ (Jan 2025), 32.41¢ (Jul 2026), kept for the ⓘ
    expect(d.baselineMonthPrice).toBe(26.13)
    expect(d.latestMonthPrice).toBe(32.41)
    // 12 months Aug 2025–Jul 2026 of sales ÷ customers ≈ 532 kWh per home per month
    expect(d.usageKwh!).toBeGreaterThan(525)
    expect(d.usageKwh!).toBeLessThan(540)
    expect([d.usageFrom, d.usageTo]).toEqual(['2025-08', '2026-07'])
  })

  test('Georgia: the Jan→Jul jump is mostly the summer season; full-year averages show the real change', () => {
    const d = buildElectricitySeries(ROWS, 'GA')
    expect(d.baselineMonthPrice).toBe(13.5)
    expect(d.latestMonthPrice).toBe(16.27)
    // Single months: +20.5% (Jan 2025 → Jul 2026), mostly season
    expect((16.27 / 13.5 - 1) * 100).toBeCloseTo(20.5, 1)
    // Full years: ≈ +4.4% (latest 12 months vs the 12 centered on Jan 2025), close to Jan 2025 → Jan 2026
    expect(d.change).toBeGreaterThan(3)
    expect(d.change).toBeLessThan(6)
    // ≈ the mean of the 12 same-month changes, each month vs the same month a year earlier (Aug 2024 → Aug 2025 …)
    const yoy = monthRange('2024-08', '2025-07')
      .map((m) => (price('GA', `${Number(m.slice(0, 4)) + 1}${m.slice(4)}`) / price('GA', m) - 1) * 100)
      .reduce((a, b) => a + b, 0) / 12
    expect(Math.abs(d.change - yoy)).toBeLessThan(1)
    expect(d.usageKwh!).toBeGreaterThan(1000)
  })

  test('the series keeps the published price and its CENTERED 12-month average (t−5…t+6) from 2016', () => {
    const d = buildElectricitySeries(ROWS, 'CA')
    expect(d.series[0].date).toBe('2016-01')
    expect(d.series[0].avg12).toBeCloseTo(mean12('CA', '2015-08', '2016-07'), 3)
    expect(d.series[d.series.length - 1]).toMatchObject({ date: '2026-07', price: 33.61, avg12: null })
    // Jan 2025 on the graph = the baseline (Aug 2024–Jul 2025); the line's last point (Jan 2026) = the latest 12 months
    const jan = d.series.find((p) => p.date === '2025-01')!
    expect(jan.price).toBe(30.28)
    expect(jan.avg12).toBeCloseTo(d.baseline, 3)
    const last = d.series.filter((p) => p.avg12 !== null).pop()!
    expect(last.date).toBe('2026-01')
    expect(last.avg12).toBeCloseTo(d.current, 3)
    expect(d.series.slice(-6).every((p) => p.avg12 === null)).toBe(true)
  })

  test('Alaska: unpublished 2016 months stay as gaps (and their 12-month averages too)', () => {
    const d = buildElectricitySeries(ROWS, 'AK')
    expect(d.series.find((p) => p.date === '2016-08')).toEqual({ date: '2016-08', price: null, avg12: null })
    expect(isValidElectricity(d)).toBe(true)
  })

  test('New Mexico: months without sales are skipped for usage (latest complete 12 months)', () => {
    const d = buildElectricitySeries(ROWS, 'NM')
    expect(d.latestPeriod).toBe('2026-07')
    expect(d.usageTo).toBe('2026-03')
    expect(d.usageFrom).toBe('2025-04')
  })

  test('U.S. average', () => {
    const d = buildElectricitySeries(ROWS, 'US')
    expect(d).toMatchObject({ state: 'US', stateName: 'U.S.', baselineMonthPrice: 15.94, latestMonthPrice: 18.31 })
    expect(d.change).toBeCloseTo((mean12('US', '2025-08', '2026-07') / mean12('US', '2024-08', '2025-07') - 1) * 100, 1)
  })

  test('no Jan 2025 price, or no full 12 months before it → throws (never a made-up baseline)', () => {
    const late = ROWS.filter((r) => r.stateid === 'ME' && r.period >= '2025-02')
    expect(() => buildElectricitySeries(late, 'ME')).toThrow()
    const short = ROWS.filter((r) => r.stateid === 'ME' && r.period >= '2024-09')
    expect(() => buildElectricitySeries(short, 'ME')).toThrow(/12 months/)
    const gap = ROWS.filter((r) => !(r.stateid === 'ME' && r.period === '2024-10'))
    expect(() => buildElectricitySeries(gap, 'ME')).toThrow(/12 months/)
    expect(() => buildElectricitySeries(ROWS, 'PR')).toThrow(/No EIA residential electricity price/)
  })

  test('buildElectricityByState returns an Error per failing state, data for the rest', () => {
    const out = buildElectricityByState(ROWS, ['ME', 'PR'])
    expect(out.ME).not.toBeInstanceOf(Error)
    expect(out.PR).toBeInstanceOf(Error)
  })
})

describe('trailingAverage / averageUsage (synthetic series with a known answer)', () => {
  const months = monthRange('2014-01', '2026-07')
  const pattern = [0.9, 0.92, 0.95, 1, 1.05, 1.1, 1.12, 1.1, 1.02, 0.97, 0.94, 0.93]
  const mean = pattern.reduce((a, b) => a + b, 0) / 12

  test('a pure seasonal pattern on a flat price gives a flat 12-month average (no seasonal model needed)', () => {
    const avg = trailingAverage(months.map((m) => 20 * pattern[Number(m.slice(5)) - 1]))
    expect(avg.slice(0, 11).every((v) => v === null)).toBe(true)
    avg.slice(11).forEach((v) => expect(v!).toBeCloseTo(20 * mean, 10))
  })

  test('a missing month blanks the 12 averages that include it', () => {
    const vals: Array<number | null> = months.map(() => 10)
    vals[30] = null
    const avg = trailingAverage(vals)
    expect(avg.slice(30, 42).every((v) => v === null)).toBe(true)
    expect(avg[29]).toBe(10)
    expect(avg[42]).toBe(10)
  })

  test('usage = mean of sales×1e6 ÷ customers over the latest 12 complete months', () => {
    const ms = monthRange('2025-01', '2026-02')
    const sales = ms.map((_, i) => (i === 13 ? null : 100 + i)) // latest month missing
    const customers = ms.map(() => 200_000)
    const u = averageUsage(ms, sales, customers)!
    expect([u.from, u.to]).toEqual(['2025-02', '2026-01'])
    // months 1..12: (101 + … + 112) / 12 = 106.5 million kWh ÷ 200,000 = 532.5 kWh
    expect(u.kwh).toBeCloseTo(532.5, 6)
  })
})

describe('validation (sanity ranges: 5–60 ¢/kWh, −50…+100 %)', () => {
  const ok = buildElectricitySeries(ROWS, 'ME')
  test.each([
    ['price too high', { current: 75 }],
    ['price too low', { baseline: 2 }],
    ['older seasonally adjusted payload (no method)', { method: undefined }],
    ['older 12-months-ending-Jan-2025 payload', { method: 'avg12' }],
    ['change out of range', { change: 140 }],
    ['usage implausible', { usageKwh: 9000 }],
    ['no series', { series: [] }],
  ])('%s → invalid', (_l, patch) => {
    expect(isValidElectricity({ ...ok, ...patch } as typeof ok)).toBe(false)
  })
  test('usage may be missing (no dollar figure then)', () => {
    expect(isValidElectricity({ ...ok, usageKwh: null })).toBe(true)
  })
})

describe('states and paging', () => {
  test('51 series (50 states + DC); no territories', () => {
    expect(ELECTRICITY_STATES).toHaveLength(51)
    for (const st of ['DC', 'AK', 'HI', 'ME', 'GA']) expect(hasElectricitySeries(st)).toBe(true)
    for (const st of ['PR', 'GU', 'VI', 'AS', 'MP', undefined]) expect(hasElectricitySeries(st)).toBe(false)
    expect(electricityCacheKey('me')).toBe('eia:electricity:ME')
  })

  test('every state + US in one query pages past 5,000 rows: 2 requests', async () => {
    let calls = 0
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('electricity/retail-sales')) calls++
    })
    const states = [...ELECTRICITY_STATES, 'US']
    const { rows, requests } = await fetchElectricityRows(states)
    server.events.removeAllListeners()
    expect(requests).toBe(2)
    expect(calls).toBe(2)
    const perState = ROWS.filter((r) => r.stateid === 'ME').length
    expect(rows).toHaveLength(states.length * perState)
    expect(new Set(rows.map((r) => r.stateid)).size).toBe(52)
  })
})

describe('snapshot + card', () => {
  test('national comparison over the same 12-month windows (centered on Jan 2025 → ending the local latest month)', () => {
    const me = buildElectricitySeries(ROWS, 'ME')
    const us = buildElectricitySeries(ROWS, 'US')
    const e = withNationalElectricity(me, us)
    expect(e.nationalChange).toBeCloseTo((mean12('US', '2025-08', '2026-07') / mean12('US', '2024-08', '2025-07') - 1) * 100, 2)
    expect(e.nationalChange).toBeCloseTo(us.change, 2)
    expect(e.nationalSeries).toHaveLength(us.series.length)
  })

  test.each([
    ['04101', 'ME'], ['30303', 'GA'], ['20001', 'DC'], ['99501', 'AK'], ['96720', 'HI'], ['94102', 'CA'],
  ])('%s → statewide %s series (cached under eia:electricity:{ST})', async (zip, st) => {
    const s = (await fetchSnapshot(zip))!
    expect(s.electricity.data?.state).toBe(st)
    expect(await getCachedEnvelope(electricityCacheKey(st))).not.toBeNull()
    expect(await getCachedEnvelope(electricityCacheKey('US'))).not.toBeNull()
  })

  test('Maine card: 12-month average price, its % change, $/mo = change in 12-mo avg ¢ × usage ÷ 100', async () => {
    const s = (await fetchSnapshot('04101'))!
    const e = s.electricity.data!
    const card = buildElectricityCard(s)
    expect(card.status).toBe('ok')
    // Change first: the % change of the 12-month average price is the big number, the level is on the secondary line
    expect(card.value).toBe(`+${e.change.toFixed(1)}%`)
    expect(card.valueNote).toBeUndefined()
    const expected = Math.round(((mean12('ME', '2025-08', '2026-07') - mean12('ME', '2024-08', '2025-07')) * e.usageKwh!) / 100)
    expect(s.dollarImpact!.electricity).toBe(expected)
    expect(card.inline).toBe(`≈ +$${expected}/mo`)
    // Short face; the 12-month windows (centered on Jan 2025) are in the ⓘ detail
    expect(card.secondary).toBe(`since Jan 2025 · 12-mo avg ${mean12('ME', '2025-08', '2026-07').toFixed(1)}¢/kWh`)
    expect(card.info.join(' ')).toMatch(/centered on Jan 2025/)
    expect(card.info.join(' ')).toContain(`National: +${e.nationalChange!.toFixed(1)}%`)
    expect(card.sourceLine).toBe('Maine · EIA · Jul 2026')
    expect(card.info.join(' ')).toContain("average Maine home's monthly use (532 kWh, 12-mo avg Aug 2025–Jul 2026)")
    expect(card.info.join(' ')).toContain('Latest month as published: 32.4¢/kWh in Jul 2026')
    expect(card.info.join(' ')).toContain('Why 12-month averages')
    expect(card.provenance.adjustment).toMatch(/12-month average/)
  })

  test('Puerto Rico: EIA publishes no residential price → "Data unavailable" with the reason; no EIA call', async () => {
    let calls = 0
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('electricity/retail-sales')) calls++
    })
    const s = (await fetchSnapshot('00601'))!
    server.events.removeAllListeners()
    expect(calls).toBe(0)
    expect(s.electricity.data).toBeNull()
    const card = buildHeroCards(s).find((c) => c.id === 'electricity')!
    expect(card.status).toBe('unavailable')
    expect(card.info.join(' ')).toContain('EIA publishes no residential electricity price for Puerto Rico')
  })
})
