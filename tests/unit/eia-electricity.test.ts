/**
 * EIA residential electricity (statewide): parser, seasonal adjustment, usage, paging, cache, snapshot.
 * Driven by a recorded EIA response (tests/fixtures/eia-electricity-res.json, no key). Expected values
 * are EIA's published prices (Jan 2025 / Jul 2026) and figures computed independently from the raw
 * fixture, not by re-running the code under test.
 */
import fx from '../fixtures/eia-electricity-res.json'
import { server } from '../mocks/server'
import {
  buildElectricitySeries,
  buildElectricityByState,
  seasonalFactors,
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

beforeEach(() => clearMemCache())

describe('buildElectricitySeries (recorded EIA rows)', () => {
  test('Maine: published Jan 2025 and Jul 2026 prices, seasonally adjusted change, 12-month usage', () => {
    const d = buildElectricitySeries(ROWS, 'ME')
    expect(d).toMatchObject({ state: 'ME', stateName: 'Maine', seriesId: 'ELEC.PRICE.ME-RES.M' })
    // EIA published: 26.13¢ (Jan 2025), 32.41¢ (Jul 2026)
    expect(d.baseline).toBe(26.13)
    expect(d.baselinePeriod).toBe('2025-01')
    expect(d.current).toBe(32.41)
    expect(d.latestPeriod).toBe('2026-07')
    expect(d.rawChange).toBeCloseTo(24.03, 1)
    // Maine has little seasonality: adjusted ≈ raw (+23.3%)
    expect(d.change).toBeCloseTo(23.3, 1)
    // 12 months Aug 2025–Jul 2026 of sales ÷ customers ≈ 532 kWh per home per month
    expect(d.usageKwh!).toBeGreaterThan(525)
    expect(d.usageKwh!).toBeLessThan(540)
    expect([d.usageFrom, d.usageTo]).toEqual(['2025-08', '2026-07'])
  })

  test('Georgia: the raw Jan→Jul jump is mostly the summer season; the adjusted change is small', () => {
    const d = buildElectricitySeries(ROWS, 'GA')
    expect(d.baseline).toBe(13.5)
    expect(d.current).toBe(16.27)
    expect(d.rawChange).toBeCloseTo(20.5, 1)
    expect(d.change).toBeGreaterThan(1.5)
    expect(d.change).toBeLessThan(4)
    // Same-month comparison (Jul 2025 → Jul 2026) also shows a small change, unlike Jan → Jul
    const yoy = (price('GA', '2026-07') / price('GA', '2025-07') - 1) * 100
    expect(Math.abs(yoy)).toBeLessThan(6)
    expect(d.usageKwh!).toBeGreaterThan(1000)
  })

  test('the series keeps published and adjusted prices from 2016 to the latest month', () => {
    const d = buildElectricitySeries(ROWS, 'CA')
    expect(d.series[0].date).toBe('2016-01')
    expect(d.series[d.series.length - 1]).toMatchObject({ date: '2026-07', price: 33.61 })
    const jan = d.series.find((p) => p.date === '2025-01')!
    expect(jan.price).toBe(30.28)
    expect(jan.sa).toBeCloseTo(d.saBaseline, 3)
  })

  test('Alaska: unpublished 2016 months stay as gaps; the adjustment still has enough history', () => {
    const d = buildElectricitySeries(ROWS, 'AK')
    expect(d.series.find((p) => p.date === '2016-08')).toEqual({ date: '2016-08', price: null, sa: null })
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
    expect(d).toMatchObject({ state: 'US', stateName: 'U.S.', baseline: 15.94, current: 18.31 })
    expect(d.change).toBeCloseTo(8.5, 1)
  })

  test('no Jan 2025 price, or too little history → throws (never a made-up baseline)', () => {
    const late = ROWS.filter((r) => r.stateid === 'ME' && r.period >= '2025-02')
    expect(() => buildElectricitySeries(late, 'ME')).toThrow()
    const short = ROWS.filter((r) => r.stateid === 'ME' && r.period >= '2023-01')
    expect(() => buildElectricitySeries(short, 'ME')).toThrow(/seasonally adjust/)
    expect(() => buildElectricitySeries(ROWS, 'PR')).toThrow(/No EIA residential electricity price/)
  })

  test('buildElectricityByState returns an Error per failing state, data for the rest', () => {
    const out = buildElectricityByState(ROWS, ['ME', 'PR'])
    expect(out.ME).not.toBeInstanceOf(Error)
    expect(out.PR).toBeInstanceOf(Error)
  })
})

describe('seasonalFactors / averageUsage (synthetic series with a known answer)', () => {
  const months = monthRange('2014-01', '2026-07')
  const pattern = [0.9, 0.92, 0.95, 1, 1.05, 1.1, 1.12, 1.1, 1.02, 0.97, 0.94, 0.93]
  const mean = pattern.reduce((a, b) => a + b, 0) / 12

  test('recovers a fixed multiplicative pattern on a flat price', () => {
    const f = seasonalFactors(months, months.map((m) => 20 * pattern[Number(m.slice(5)) - 1]))!
    f.forEach((v, i) => expect(v).toBeCloseTo(pattern[i] / mean, 2))
    expect(f.reduce((a, b) => a + b, 0) / 12).toBeCloseTo(1, 10)
  })

  test('factors use months through Dec 2024 only: a post-baseline shock does not move them', () => {
    const base = months.map((m) => 20 * pattern[Number(m.slice(5)) - 1])
    const shocked = months.map((m, i) => (m >= '2025-06' ? base[i] * 1.5 : base[i]))
    expect(seasonalFactors(months, shocked)).toEqual(seasonalFactors(months, base))
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
    ['change out of range', { change: 140 }],
    ['usage implausible', { usageKwh: 9000 }],
    ['no series', { series: [] }],
  ])('%s → invalid', (_l, patch) => {
    expect(isValidElectricity({ ...ok, ...patch })).toBe(false)
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
  test('national comparison over the same months (U.S. adjusted Jan 2025 → local latest month)', () => {
    const me = buildElectricitySeries(ROWS, 'ME')
    const us = buildElectricitySeries(ROWS, 'US')
    const e = withNationalElectricity(me, us)
    const at = (d: string) => us.series.find((p) => p.date === d)!.sa!
    expect(e.nationalChange).toBeCloseTo((at('2026-07') / at('2025-01') - 1) * 100, 2)
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

  test('Maine card: published price, adjusted %, $/mo = adjusted ¢ change × usage ÷ 100', async () => {
    const s = (await fetchSnapshot('04101'))!
    const e = s.electricity.data!
    const card = buildElectricityCard(s)
    expect(card.status).toBe('ok')
    expect(card.value).toBe('32.4¢/kWh')
    const expected = Math.round(((e.saCurrent - e.saBaseline) * e.usageKwh!) / 100)
    expect(expected).toBe(33)
    expect(s.dollarImpact!.electricity).toBe(33)
    expect(card.inline).toBe('≈ +$33/mo')
    expect(card.secondary).toBe('+23.3% since Jan 2025 · U.S. +8.5%')
    expect(card.sourceLine).toBe('Maine · EIA · Jul 2026')
    expect(card.info.join(' ')).toContain("average Maine home's monthly use (532 kWh, 12-mo avg Aug 2025–Jul 2026)")
    expect(card.info.join(' ')).toContain('+24.0% unadjusted')
    expect(card.provenance.adjustment).toMatch(/seasonally adjusted by whatchanged/)
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
