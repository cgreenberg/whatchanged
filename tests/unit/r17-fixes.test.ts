/**
 * Round 17: seasonal caveat worded by sign (right for falls), gas map common month ignores last-good copies, old
 * cached map payloads without a gas window, Puerto Rico DACO on the common window, opposite-side colors scaled by
 * size, Zillow "city" places labeled "area", the OG route's font tracing.
 */
import fs from 'fs'
import path from 'path'
import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import {
  rentSeasonalCaveat, seasonalOwnPatternPct, seasonalDirectionUncertain, seasonalCaveatDirection, type SeasonalCaveat,
} from '@/lib/rent-range'
import { shareSeasonalNote } from '@/lib/share-card/generate'
import { buildMapMetrics, commonGasMonth, type MapMetrics } from '@/lib/api/map-metrics'
import { clearMemCache, getCached, setCached, lastGoodKey } from '@/lib/cache/kv'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { describeBlsGasArea } from '@/lib/api/bls-gas'
import { liveValue, mapScaleFor, scaleColor, oppositeColor, OPPOSITE_MIN } from '@/lib/county-data'
import { cityGeoName, lookupCityRent } from '@/lib/rent'
import type { GasSeriesData } from '@/lib/api/eia'

type Row = { pct: number; curRent: number; asOf: string; saCaveat?: SeasonalCaveat; name: string }
const COUNTY = (countyRent as unknown as { counties: Record<string, Row> }).counties
const METRO = (metroRent as unknown as { metros: Record<string, Row> }).metros

describe('seasonal caveat: signed wording, own-pattern figure, direction note (review cases)', () => {
  // [fips, shown %, direction, own-pattern %, direction uncertain]
  const cases: Array<[string, number, 'too high' | 'too low', number, boolean]> = [
    ['12021', -1.5, 'too low', 0.7, true], // Collier FL: shown fall, own pattern a rise
    ['56037', -4.8, 'too high', -6.9, false], // Sweetwater WY: the fall may be bigger
    ['53037', -0.5, 'too low', 2.5, true], // Kittitas WA
    ['27013', 6.3, 'too low', 14.7, true], // Blue Earth MN: gap 8.4 ≥ the shown 6.3
    ['27169', 13.4, 'too low', 18.9, false], // Winona MN
    ['12119', -2.4, 'too low', 0.8, true], // Sumter FL
    ['41047', -0.7, 'too low', 1.0, true], // Marion OR
    ['41071', -0.1, 'too low', 1.7, true], // Yamhill OR
    ['51600', 0.4, 'too high', -1.2, true], // Fairfax city VA
  ]
  const sp = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`

  test.each(cases)('county %s', (fips, pct, dir, own, uncertain) => {
    const r = COUNTY[fips]
    expect(r.pct).toBe(pct)
    const c = r.saCaveat!
    expect(seasonalCaveatDirection(c)).toBe(dir)
    expect(seasonalOwnPatternPct(c, r.pct)).toBe(own)
    expect(seasonalDirectionUncertain(c, r.pct)).toBe(uncertain)
    const text = rentSeasonalCaveat(c, 'county', r)!
    expect(text).toMatch(new RegExp(`^This August reading \\(${sp(pct).replace('+', '\\+')}\\) may be about [\\d.]+ percentage points ${dir} \\(≈ \\$\\d+/mo\\): `))
    expect(text).toContain(`Under its own recent pattern it would be about ${sp(own)}`)
    expect(text.includes('so even its direction is uncertain')).toBe(uncertain)
    // never the old unsigned wording, which read backwards for falls
    expect(text).not.toMatch(/overstate|understate/)
    const note = shareSeasonalNote(c, r)!
    expect(note).toContain(`Aug rent may be ~`)
    expect(note).toContain(` pts ${dir}`)
    expect(note).toContain(`own pattern ${sp(own)}`)
    expect(note.includes('direction uncertain')).toBe(uncertain)
  })

  test('Hermiston-Pendleton OR metro (−0.9%, gap −3.1): too low, own +2.2%, direction uncertain', () => {
    const m = METRO['25840']
    expect(m.name).toBe('Hermiston-Pendleton, OR')
    const text = rentSeasonalCaveat(m.saCaveat, 'metro', m)!
    expect(text).toMatch(/^This August reading \(−0\.9%\) may be about 3 percentage points too low \(≈ \$\d+\/mo\): the metro’s/)
    expect(text).toContain('Under its own recent pattern it would be about +2.2%; the possible error is as large as the change itself, so even its direction is uncertain.')
  })

  test('without the shown %, no own-pattern figure and no direction claim', () => {
    expect(rentSeasonalCaveat({ gap: -2.2, month: 8 }, 'county')).toBe(
      'This August reading may be about 2 percentage points too low: the county’s recent seasonal swing differs from the pattern used to adjust it.')
    expect(seasonalDirectionUncertain({ gap: 3, month: 8 }, undefined)).toBe(false)
  })
})

describe('gas map common month', () => {
  beforeEach(() => clearMemCache())

  test('a last-good (stale) series never holds the common month back', async () => {
    // Atlanta (BLS S35C) and Honolulu (S49F) both cached through Aug 2026
    await fetchSnapshot('30303')
    await fetchSnapshot('96813')
    const fresh = await buildMapMetrics()
    expect(fresh.gasWindow?.to).toBe('2026-08')
    // Honolulu's primary expires and only a last-good copy ending Jul 2026 is left: still Aug for everyone else
    const key = describeBlsGasArea('S49F').cacheKey
    const env = (await getCached<{ __v: number; fetchedAt: string; data: GasSeriesData }>(key))!
    const cut = env.data.series.filter((p) => p.date < '2026-08')
    const last = cut[cut.length - 1]
    const older = { ...env, data: { ...env.data, series: cut, latestDate: last.date, current: last.price, change: Number((last.price - env.data.baseline).toFixed(3)) } }
    await setCached(key, null, 60)
    await setCached(lastGoodKey(key), older, 60)
    const m = await buildMapMetrics()
    expect(m.gasWindow?.to).toBe('2026-08')
    const hnl = m.gas.find((g) => g.id === 'b:S49F')!
    expect(hnl).toMatchObject({ stale: true, window: 'own', asOf: '2026-07' })
    expect(m.gas.find((g) => g.id === 'b:S35C')).toMatchObject({ window: 'common', asOf: '2026-08' })
    // the pure rule is unchanged: the earliest latest month among the series passed in
    expect(commonGasMonth(['2026-08', '2026-07'])).toBe('2026-07')
  })

  test('Puerto Rico DACO joins the common window when it has that month (and the recorded fixture says so)', async () => {
    await fetchSnapshot('30303')
    const m = await buildMapMetrics()
    const pr = m.gas.find((g) => g.id === 'p:PR')!
    expect(m.gasWindow?.to).toBe('2026-08')
    expect(pr).toMatchObject({ source: 'daco', window: 'common', asOf: m.gasWindow!.to, baselineAsOf: '2025-01' })
    expect(liveValue(m, '72127', 'gas')!.ownWindow).toBeUndefined()
    const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/map-metrics.json'), 'utf8')) as MapMetrics
    const fx = fixture.gas.find((g) => g.id === 'p:PR')!
    expect(fx.window).toBe('common')
    expect(fx).toMatchObject({ change: pr.change, current: pr.current, asOf: pr.asOf, baselineAsOf: pr.baselineAsOf })
  })

  test('an old cached payload without gasWindow / window draws plainly (never every area "own window")', () => {
    const legacy = {
      gas: [
        { id: 'e:R20', label: 'Midwest (PADD 2) avg', source: 'eia', frequency: 'weekly', change: 0.21, current: 3.1, asOf: '2026-09-28', baselineAsOf: '2025-01-20' },
        { id: 'd:02090', label: 'Fairbanks survey price (Alaska DCRA)', source: 'dcra', frequency: 'semiannual', change: 0.4, current: 4.5, asOf: '2026-07', baselineAsOf: '2025-01' },
      ],
      groceries: [], electricity: {}, counties: { '17031': [0, -1], '02090': [1, -1] }, missing: 0, stale: 0,
    } as unknown as MapMetrics
    const il = liveValue(legacy, '17031', 'gas')!
    expect(il.ownWindow).toBeUndefined()
    expect(il.value).toBe(0.21)
    expect(il.when).not.toMatch(/own window/)
    expect(liveValue(legacy, '02090', 'gas')!.ownWindow).toBeUndefined()
    // a current payload still marks own-window areas
    const current = { ...legacy, gasWindow: { from: '2025-01', to: '2026-08' }, gas: legacy.gas.map((g) => ({ ...g, window: 'own' })) } as MapMetrics
    expect(liveValue(current, '17031', 'gas')!.ownWindow).toBe(true)
  })
})

describe('sequential scale: the other side of zero is shaded by size', () => {
  const s = mapScaleFor([...Array.from({ length: 200 }, (_, i) => 0.05 + (i % 100) * 0.013), -0.1], 'usd', 0.5, true)

  test('a tiny fall is a dim blue, a big fall the full blue (North Slope −$0.10 is not the strongest blue)', () => {
    expect(s.kind).toBe('sequential')
    const lum = (c: string) => c.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0)
    const tiny = scaleColor(-0.1, s)
    const big = scaleColor(-2, s) // beyond the scale's reach: the full end color
    expect(big).toBe(oppositeColor(s))
    expect(lum(tiny)).toBeLessThan(lum(big))
    // still blue (b channel dominant), never the charcoal midpoint or a rise color
    const [r, , b] = tiny.match(/\d+/g)!.map(Number)
    expect(b).toBeGreaterThan(r + 30)
    expect(tiny).toBe(oppositeColor(s, -0.1))
    expect(oppositeColor(s, 0)).toBe(oppositeColor(s, 1e-9))
    expect(OPPOSITE_MIN).toBeGreaterThan(0.18)
  })
})

describe('Zillow city regions are labeled "area" (Murrells Inlet SC is a Census CDP, not a city)', () => {
  test('geo name and card wording', () => {
    expect(cityGeoName('Murrells Inlet', 'SC')).toBe('Murrells Inlet area, SC')
    expect(lookupCityRent('45043', 'Georgetown County, SC').data?.geoName).toBe('Murrells Inlet area, SC')
  })
})

test('the OG route traces the bundled fonts it reads', () => {
  const cfg = fs.readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8')
  expect(cfg).toMatch(/'\/api\/og': \['\.\/public\/fonts\/\*\*'\]/)
})
