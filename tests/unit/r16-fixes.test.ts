/**
 * Round 16: like-for-like gas map window (monthly averages on a common month), legend wording, values across zero,
 * gas / electricity level labels, electricity share-chart ticks, seasonal caveat sized by its effect on the shown %.
 */
import fs from 'fs'
import path from 'path'
import { gasMonthlyAverages, commonGasMonth, GAS_COMMON_MAX_LAG } from '@/lib/api/map-metrics'
import type { MapMetrics } from '@/lib/api/map-metrics'
import {
  mapScaleFor, scaleColor, oppositeColor, isOppositeSide, sequentialClaim, liveValue, gasWindowText, elecWindowText,
  type CountyMap,
} from '@/lib/county-data'
import { mapTooltip } from '@/lib/map-tooltip'
import { gasLevelText } from '@/lib/hero-cards'
import { elecWindowTick } from '@/lib/share-card/generate'
import { rentSeasonalCaveat, seasonalCaveatPoints } from '@/lib/rent-range'
import countyRent from '@/lib/data/county-rent.json'

describe('gas map: monthly averages on a common month', () => {
  test('weekly EIA readings average by calendar month; the latest month only once complete', () => {
    const w = [
      { date: '2025-01-06', price: 3.0 }, { date: '2025-01-13', price: 3.1 }, { date: '2025-01-20', price: 3.2 },
      { date: '2025-01-27', price: 3.3 }, { date: '2025-02-03', price: 3.4 }, { date: '2025-02-10', price: 3.6 },
    ]
    const avg = gasMonthlyAverages(w)
    expect(avg.get('2025-01')).toBe(3.15)
    expect(avg.has('2025-02')).toBe(false) // Feb 10 + 7 days is still February: incomplete
    // the month's final Monday reading completes it (no later Monday in the month)
    const done = gasMonthlyAverages([...w, { date: '2025-02-17', price: 3.5 }, { date: '2025-02-24', price: 3.5 }])
    expect(done.get('2025-02')).toBe(3.5)
  })

  test('monthly BLS / DACO points are used as published; out-of-range months are dropped', () => {
    const avg = gasMonthlyAverages([{ date: '2025-01', price: 3.2 }, { date: '2026-08', price: 4.1 }, { date: '2026-09', price: 42 }])
    expect([...avg.entries()]).toEqual([['2025-01', 3.2], ['2026-08', 4.1]])
  })

  test('common month = the earliest latest month, ignoring series far behind the newest', () => {
    expect(commonGasMonth(['2026-09', '2026-08', '2026-09'])).toBe('2026-08')
    // a series GAS_COMMON_MAX_LAG+ months behind doesn't hold the whole map back (it keeps its own window)
    expect(GAS_COMMON_MAX_LAG).toBe(2)
    expect(commonGasMonth(['2026-09', '2026-08', '2026-05'])).toBe('2026-08')
    expect(commonGasMonth([undefined])).toBeNull()
  })

  const metrics = (): MapMetrics => ({
    gas: [
      { id: 'b:S35C', label: 'Atlanta metro avg', source: 'bls', frequency: 'monthly', change: 0.42, current: 3.31, asOf: '2026-08', baselineAsOf: '2025-01', window: 'common' },
      { id: 'e:R1X', label: 'New England (PADD 1A) avg', source: 'eia', frequency: 'weekly', change: 0.78, current: 3.9, asOf: '2026-08', baselineAsOf: '2025-01', window: 'common' },
      { id: 'd:02185', label: 'North Slope Borough (Alaska DCRA)', source: 'dcra', frequency: 'semiannual', change: -0.1, current: 7.9, asOf: '2026-07', baselineAsOf: '2025-01', window: 'own' },
      { id: 'b:S49F*', label: 'Honolulu-area price (BLS)', source: 'bls', frequency: 'monthly', standIn: true, change: 0.6, current: 4.9, asOf: '2026-08', baselineAsOf: '2025-01', window: 'common' },
    ],
    gasWindow: { from: '2025-01', to: '2026-08' },
    groceries: [], electricity: { ME: { label: 'Maine', pct: 12.3, cents: 28.4, asOf: '2026-07' } },
    counties: { '13121': [0, -1], '23005': [1, -1], '02185': [2, -1], '15001': [3, -1] }, missing: 0, stale: 0,
  })

  test('tooltip / panel values say their window: common monthly averages, Alaska survey months, stand-ins', () => {
    const m = metrics()
    expect(gasWindowText(m)).toBe('Jan 2025 → Aug 2026 monthly averages')
    const atl = liveValue(m, '13121', 'gas')!
    expect(atl.text).toBe('+$0.42/gal, Jan 2025 → Aug 2026 monthly averages')
    expect(atl.detail).toBe('Aug 2026 avg $3.31/gal · BLS monthly')
    expect(liveValue(m, '23005', 'gas')!.detail).toBe('Aug 2026 avg $3.90/gal · EIA weekly prices averaged by month')
    const ns = liveValue(m, '02185', 'gas')!
    expect(ns).toMatchObject({ ownWindow: true, survey: true, value: -0.1 })
    expect(ns.when).toBe('Jan 2025 → Jul 2026 surveys (survey months, not monthly averages)')
    expect(liveValue(m, '15001', 'gas')).toMatchObject({ standIn: true })
    const tip = mapTooltip({ fips: '02185', metric: 'gas', county: { n: 'North Slope Borough, AK' }, liveData: m })
    expect(tip.when).toContain('Jul 2026 surveys')
    const tipAtl = mapTooltip({ fips: '13121', metric: 'gas', county: { n: 'Fulton County, GA' }, liveData: m })
    expect(tipAtl.when).toBe('Jan 2025 → Aug 2026 monthly averages')
  })

  test('electricity: 12-month average wording on the map (panel, tooltip, legend)', () => {
    const e = liveValue(metrics(), '23005', 'elec')!
    expect(e.text).toBe("+12.3% 12-mo avg vs yr centered on Jan '25")
    expect(e.detail).toBe('12-mo avg 28.4¢/kWh, 12 months to Jul 2026 · EIA')
    expect(e.when).toBe(elecWindowText('2026-07'))
    expect(elecWindowText('2026-07')).toBe("12-mo avg to Jul 2026 vs yr centered on Jan '25")
  })
})

describe('sequential gas scale: values across zero', () => {
  const gas = [...Array.from({ length: 200 }, (_, i) => 0.6 + (i % 100) * 0.008), -0.1]
  const s = mapScaleFor(gas, 'usd', 0.5, true)

  test('a fall on a "rose" scale takes a distinct color, never the dimmest rise', () => {
    expect(s.kind).toBe('sequential')
    expect(isOppositeSide(-0.1, s)).toBe(true)
    expect(isOppositeSide(0, s)).toBe(false)
    expect(scaleColor(-0.1, s)).toBe(oppositeColor(s))
    expect(scaleColor(-0.1, s)).not.toBe(scaleColor(s.kind === 'sequential' ? s.lo : 0, s))
    expect(oppositeColor({ kind: 'diverging', clamp: 5 })).toBeNull()
  })

  test('legend claim: "every county rose" only when none fell; brighter = rose more', () => {
    expect(sequentialClaim(gas, s)).toBe('nearly every county rose; brighter = rose more')
    expect(sequentialClaim(gas.slice(0, 200), s)).toBe('every county rose; brighter = rose more')
    expect(sequentialClaim([0, 0.5, 0.9], s)).toBe('every county rose; brighter = rose more') // min ≥ 0
    expect(sequentialClaim(gas, { kind: 'diverging', clamp: 1 })).toBeNull()
  })

  test('rising scale gets brighter (lighter) toward the top', () => {
    if (s.kind !== 'sequential') throw new Error('expected sequential')
    const lum = (c: string) => c.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0)
    expect(lum(scaleColor(s.hi, s))).toBeGreaterThan(lum(scaleColor(s.lo, s)))
  })
})

describe('labels: monthly gas level, electricity level and chart ticks', () => {
  test('"now" only for a weekly reading; monthly averages and surveys say their month', () => {
    expect(gasLevelText(3.214, 'weekly', '2026-10-05')).toBe('now $3.21')
    expect(gasLevelText(4.78, 'monthly', '2026-08')).toBe('Aug avg $4.78')
    expect(gasLevelText(5.1, 'survey', '2026-07')).toBe('Jul survey $5.10')
    expect(gasLevelText(4.78, 'monthly', null)).toBe('now $4.78')
  })

  test('electricity share-chart ticks name the 12-month window, never the center month', () => {
    expect(elecWindowTick('2026-01')).toBe("12 mo to Jul '26")
    expect(elecWindowTick('2025-01')).toBe("12 mo to Jul '25")
    expect(elecWindowTick(undefined)).toBe('')
  })
})

describe('seasonal caveat sized by its effect on the shown %', () => {
  const rows = (countyRent as unknown as { counties: Record<string, { pct: number; curRent: number; saCaveat?: { gap: number; month: number } }> }).counties

  test('Blue Earth MN and Winona MN: the shown % minus the % under their own recent pattern', () => {
    // r16 review: actual effects 8.4 and 5.5 points (the old factor gaps, 7.3 / 4.7, understated them)
    expect(rows['27013'].saCaveat).toEqual({ gap: -8.4, month: 8 })
    expect(rows['27169'].saCaveat).toEqual({ gap: -5.5, month: 8 })
    expect(seasonalCaveatPoints(rows['27013'].saCaveat!)).toBe(8.5)
    expect(rentSeasonalCaveat(rows['27169'].saCaveat, 'county')).toMatch(/^This August reading may understate the change by about 5\.5 percentage points/)
  })

  test('the county map shards carry the same caveat as the card data', () => {
    const shard = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/county/27.json'), 'utf8')) as CountyMap
    expect(shard['27013'].rentSaCav).toEqual(rows['27013'].saCaveat)
    const all = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/counties.json'), 'utf8')) as CountyMap
    expect(all['27169'].rentSaCav).toEqual(rows['27169'].saCaveat)
  })
})

test('map tooltip names the publisher once', () => {
  const m: MapMetrics = {
    gas: [{ id: 'd:02185', label: 'North Slope Borough: median of 7 surveyed communities (Alaska DCRA)', source: 'dcra', frequency: 'semiannual', change: -0.1, current: 7.5, asOf: '2026-07', baselineAsOf: '2025-01', window: 'own' }],
    gasWindow: { from: '2025-01', to: '2026-08' }, groceries: [], electricity: {}, counties: { '02185': [0, -1] }, missing: 0, stale: 0,
  }
  const tip = mapTooltip({ fips: '02185', metric: 'gas', county: { n: 'North Slope Borough, AK' }, liveData: m })
  expect(tip.geo).toBe('North Slope Borough: median of 7 surveyed communities (Alaska DCRA)')
})
