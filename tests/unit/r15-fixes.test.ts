/**
 * Round-15 fixes: the rent seasonal-pattern caveat follows the rent number everywhere (map file / shards, map
 * tooltip + panel text, stale trace), data-driven map color scales, coded-rent qualifier rounding.
 */
import fs from 'fs'
import path from 'path'
import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import { mapTooltip } from '@/lib/map-tooltip'
import { mapMetroRent } from '@/lib/map-metro-rent'
import { mapScaleFor, scaleColor, scaleText, divergingColor, type CountyMap } from '@/lib/county-data'
import { rentCodedQualifier, fmtRentDollars } from '@/lib/compute/dollar-translations'
import { SEASONAL_CAVEAT_SHORT } from '@/lib/rent-range'
import { LADDERS } from '@/lib/resolution/ladders'
import { resolveLadder, type Ladder } from '@/lib/resolution/resolve'
import { serverLadderContext } from '@/lib/resolution/server-context'

const DATA = path.join(process.cwd(), 'public/data')
const COUNTIES = JSON.parse(fs.readFileSync(path.join(DATA, 'counties.json'), 'utf8')) as CountyMap
type Cav = { gap: number; month: number }
const CR = (countyRent as unknown as { counties: Record<string, { saCaveat?: Cav }> }).counties
const MR = metroRent as unknown as { metros: Record<string, { saCaveat?: Cav }>; counties: Record<string, string> }

describe('seasonal caveat ships with the map data', () => {
  test('counties.json and the county shards carry the same caveat as county-rent.json; rentM carries the metro’s', () => {
    for (const [f, c] of Object.entries(COUNTIES)) expect([f, c.rentSaCav]).toEqual([f, CR[f]?.saCaveat])
    const ny = JSON.parse(fs.readFileSync(path.join(DATA, 'county/36.json'), 'utf8')) as CountyMap
    expect(ny['36061'].rentSaCav).toEqual(CR['36061'].saCaveat)
    let metroCav = 0
    for (const f of fs.readdirSync(path.join(DATA, 'county'))) {
      const shard = JSON.parse(fs.readFileSync(path.join(DATA, 'county', f), 'utf8')) as CountyMap
      for (const c of Object.values(shard)) {
        if (!c.rentM) continue
        expect(c.rentM.cav).toEqual(MR.metros[c.rentM.cbsa]?.saCaveat)
        if (c.rentM.cav) metroCav++
      }
    }
    expect(metroCav).toBeGreaterThan(0)
  })

  test('map tooltip: short "†seasonal pattern uncertain" for a county and a metro stand-in; none without a caveat', () => {
    const t = mapTooltip({ fips: '36061', metric: 'rent', county: COUNTIES['36061'], liveData: null })
    expect(t.note).toContain(SEASONAL_CAVEAT_SHORT)
    expect(SEASONAL_CAVEAT_SHORT).toBe('†seasonal pattern uncertain')
    const plain = Object.keys(COUNTIES).find((f) => COUNTIES[f].rent != null && !COUNTIES[f].rentSaCav && !COUNTIES[f].flags?.includes('rent'))!
    expect(mapTooltip({ fips: plain, metric: 'rent', county: COUNTIES[plain], liveData: null }).note).toBeUndefined()
    // home prices never carry the rent caveat
    expect(mapTooltip({ fips: '36061', metric: 'hv', county: COUNTIES['36061'], liveData: null }).note ?? '').not.toContain('seasonal')
    const metroFips = Object.keys(MR.counties).find((f) => COUNTIES[f]?.rent == null && mapMetroRent(f)?.saCaveat)
    if (metroFips) {
      expect(mapTooltip({ fips: metroFips, metric: 'rent', county: COUNTIES[metroFips], liveData: null }).note).toBe(SEASONAL_CAVEAT_SHORT)
    }
  })

  test('a stale county rung keeps the caveat (appended to the stale reason)', async () => {
    const loc = { zip: '10001', countyFips: '36061', countyName: 'New York County, NY', stateAbbr: 'NY' }
    const ctx = serverLadderContext(loc as never, new Date('2027-12-01T00:00:00Z'))
    const r = await resolveLadder(LADDERS.rent as unknown as Ladder<unknown, unknown, unknown>, loc, ctx)
    const step = r.steps.find((s) => s.rungId === 'rent.zillow-county')!
    expect(step.status).toBe('stale')
    expect(step.reason).toMatch(/hasn't updated on schedule.* This August reading \([+−][\d.]+%\) may be about [\d.]+ percentage points too high/)
  })
})

describe('data-driven map scales', () => {
  const vals = (k: 'rent' | 'hv') => Object.values(COUNTIES).map((c) => c[k])
  test('rent and home prices: ±95th percentile of |change|, so ≥ 95% of counties sit inside the scale', () => {
    for (const k of ['rent', 'hv'] as const) {
      const s = mapScaleFor(vals(k), 'pct', 10)
      expect(s.kind).toBe('diverging')
      if (s.kind !== 'diverging') continue
      const v = vals(k).filter((x): x is number => typeof x === 'number')
      expect(v.filter((x) => Math.abs(x) <= s.clamp).length / v.length).toBeGreaterThanOrEqual(0.95)
    }
  })

  test('gas (every county rose ~$0.6–2.1): sequential range from the counties’ 2nd–98th percentile, never one color', () => {
    const gas = Array.from({ length: 300 }, (_, i) => 0.6 + (i % 100) * 0.008) // 0.60 … 1.39
    gas.push(2.08, -0.1) // outliers (an Alaska village, a lone drop) take the end colors
    const s = mapScaleFor(gas, 'usd', 0.5, true)
    expect(s).toEqual({ kind: 'sequential', lo: 0.6, hi: 1.4 })
    expect(scaleText(s, 'usd')).toBe('+$0.60 to +$1.40/gal (2nd–98th percentile)')
    const colors = new Set(gas.map((g) => scaleColor(g, s)))
    expect(colors.size).toBeGreaterThan(50)
    // the old fixed ±$0.50 diverging scale painted all of these the same saturated color
    expect(new Set(gas.slice(0, 300).map((g) => divergingColor(g, 0.5))).size).toBe(1)
    // values on both sides of 0 → diverging around 0
    expect(mapScaleFor([-0.4, -0.2, 0.1, 0.3, 0.5], 'usd', 0.5, true).kind).toBe('diverging')
  })

  test('groceries / electricity: diverging, ±p95 rounded up to a nice step', () => {
    const groceries = Array.from({ length: 100 }, (_, i) => 0.4 + i * 0.06) // 0.4 … 6.34
    expect(mapScaleFor(groceries, 'pct', 5)).toEqual({ kind: 'diverging', clamp: 8 }) // p95 ≈ 6.0 → next step 8
    expect(mapScaleFor([], 'pct', 20)).toEqual({ kind: 'diverging', clamp: 20 }) // no data yet → fallback
  })
})

test('coded-rent qualifier uses the displayed rounding (−$0.50 shows "−$1" and is "saved")', () => {
  expect(fmtRentDollars(-0.5, 'top')).toBe('≈ −$1/yr or more saved')
  expect(rentCodedQualifier(-0.5, 'top')).toBe('or more saved')
  expect(rentCodedQualifier(0.4, 'top')).toBe('')
  expect(rentCodedQualifier(-0.4, 'bottom')).toBe('')
})
