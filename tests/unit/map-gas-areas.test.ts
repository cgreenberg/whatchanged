/**
 * Gas map layer: the kind of published area behind each county color (city / state / regional average), derived
 * client-side from the /api/map-metrics payload; its tooltip / panel wording; and the sequential scale's low end
 * standing clear of the page background and the no-data gray.
 */
import fs from 'fs'
import path from 'path'
import {
  gasAreaKind, gasKindText, gasAreaStateCounts, gasAreaSummary, gasAreaOutside, gasCityDotCounty, gasAreaPrincipalCounty,
  GAS_AREA_PRINCIPAL_COUNTY, GAS_REGION_STRIPE, stripeLightnessShift,
} from '@/lib/map-gas-areas'
import { liveValue, mapScaleFor, scaleColor, parseColor, NO_DATA_COLOR, SEQ_RISE_RAMP, type CountyMap } from '@/lib/county-data'
import { mapTooltip } from '@/lib/map-tooltip'
import { DESK } from '@/lib/theme'
import type { MapGasArea, MapMetrics } from '@/lib/api/map-metrics'

const M = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/map-metrics.json'), 'utf8')) as MapMetrics
const COUNTIES = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/counties.json'), 'utf8')) as CountyMap

const area = (id: string, label: string, source: MapGasArea['source'] = 'eia', extra: Partial<MapGasArea> = {}) =>
  ({ id, label, source, frequency: 'weekly', change: 1, current: 3, asOf: '2026-08', ...extra }) as MapGasArea

describe('gasAreaKind: from the series id (source + EIA duoarea / BLS area)', () => {
  test.each([
    ['e:YORD', 'Chicago area avg', 'eia', 'city'],
    ['e:Y35NY', 'New York City area avg', 'eia', 'city'],
    ['b:S35C', 'Atlanta-Sandy Springs-Roswell metro avg', 'bls', 'city'],
    ['b:S49F*', 'Honolulu-area price (BLS)', 'bls', 'standin'],
    ['e:SOH', 'Ohio state avg', 'eia', 'state'],
    ['e:R20', 'Midwest (PADD 2) avg', 'eia', 'region'],
    ['e:R1Z', 'Lower Atlantic (PADD 1C) avg', 'eia', 'region'],
    ['e:R5XCA', 'West Coast excl. California (PADD 5) avg', 'eia', 'region'],
    ['d:02050', 'Bethel Census Area: median of 9 surveyed communities (Alaska DCRA)', 'dcra', 'survey'],
    ['p:PR', 'Puerto Rico island-wide avg (DACO)', 'daco', 'island'],
  ] as const)('%s → %s', (id, label, source, kind) => {
    expect(gasAreaKind(area(id, label, source))).toBe(kind)
  })
  test('U.S. average and unknown ids are not an area kind; a payload without ids falls back to the label', () => {
    expect(gasAreaKind(area('e:NUS', 'U.S. avg'))).toBeNull()
    expect(gasAreaKind(null)).toBeNull()
    const noId = (label: string) => ({ label, source: 'eia' }) as unknown as MapGasArea
    expect(gasAreaKind(noId('Midwest (PADD 2) avg'))).toBe('region')
    expect(gasAreaKind(noId('Ohio state avg'))).toBe('state')
    expect(gasAreaKind(noId('Chicago area avg'))).toBe('city')
    expect(gasAreaKind(area('b:S49F', 'Honolulu metro avg', 'bls', { standIn: true }))).toBe('standin')
  })
  test('every gas area in the recorded payload has a kind', () => {
    for (const g of M.gas) expect([g.id, gasAreaKind(g)]).toEqual([g.id, expect.any(String)])
  })
})

describe('tooltip / panel wording names the kind; state counts come from the data', () => {
  test('state counts per area', () => {
    const counts = gasAreaStateCounts(M)
    const idx = (id: string) => M.gas.findIndex((g) => g.id === id)
    expect(counts.get(idx('e:R20'))).toBe(13)
    expect(counts.get(idx('e:SOH'))).toBe(1)
    expect(counts.get(idx('e:YORD'))).toBe(3) // IL, IN, WI counties in the Chicago area
    expect(gasAreaStateCounts(M)).toBe(counts) // memoized per payload
  })
  test('strings', () => {
    expect(gasKindText(area('e:R20', 'Midwest (PADD 2) avg'), 13)).toBe('Midwest region average · used for counties in 13 states (EIA PADD 2)')
    expect(gasKindText(area('e:R1X', 'New England (PADD 1A) avg'), 1)).toBe('New England region average (EIA PADD 1A)')
    expect(gasKindText(area('e:YORD', 'Chicago area avg'))).toBe('Chicago area price (EIA)')
    expect(gasKindText(area('b:S35C', 'Atlanta-Sandy Springs-Roswell metro avg', 'bls'))).toBe('Atlanta-Sandy Springs-Roswell metro price (BLS)')
    expect(gasKindText(area('e:SOH', 'Ohio state avg'))).toBe('Ohio state average (EIA)')
    // stand-ins, the Alaska survey and Puerto Rico keep their own wording
    expect(gasKindText(area('b:S49F*', 'Honolulu-area price (BLS)', 'bls', { standIn: true }))).toBeNull()
    expect(gasKindText(area('d:02050', 'Bethel Census Area (Alaska DCRA)', 'dcra'))).toBeNull()
  })
  test('the map tooltip and the panel value use it', () => {
    // The recorded payload has no cached Chicago / Midwest series: fill them in (values don't matter here)
    const full = { ...M, gas: M.gas.map((g) => (g.change == null ? { ...g, change: 0.9, current: 3.1, asOf: '2026-08', baselineAsOf: '2025-01', window: 'common' as const } : g)) }
    // Cook County IL: Chicago area price; Polk County IA: the Midwest regional average
    const cook = mapTooltip({ fips: '17031', metric: 'gas', county: COUNTIES['17031'], liveData: full })
    expect(cook.geo).toBe('Chicago area price (EIA)')
    const atl = mapTooltip({ fips: '13121', metric: 'gas', county: COUNTIES['13121'], liveData: M })
    expect(atl.geo).toBe('Atlanta-Sandy Springs-Roswell metro price (BLS)')
    expect(liveValue(M, '13121', 'gas')).toMatchObject({ kind: 'city', kindText: 'Atlanta-Sandy Springs-Roswell metro price (BLS)' })
    expect(liveValue(full, '19153', 'gas')).toMatchObject({ kind: 'region', kindText: 'Midwest region average · used for counties in 13 states (EIA PADD 2)' })
    expect(mapTooltip({ fips: '19153', metric: 'gas', county: COUNTIES['19153'], liveData: full }).geo)
      .toBe('Midwest region average · used for counties in 13 states (EIA PADD 2)')
    const tx = mapTooltip({ fips: '48453', metric: 'gas', county: COUNTIES['48453'], liveData: M })
    expect(tx.geo).toBe('Texas state average (EIA)')
    // a HI county with no series keeps the stand-in wording
    const hi = mapTooltip({ fips: '15001', metric: 'gas', county: COUNTIES['15001'], liveData: M })
    expect(hi.geo).toContain('no series for this county')
  })
  test('published-area count for the legend: stand-ins and Alaska survey boroughs are not separate areas', () => {
    const s = gasAreaSummary(M)
    const used = new Set(Object.values(M.counties).map((r) => r[0]))
    const expected = M.gas.filter((g, i) => used.has(i) && g.change != null && !g.standIn && !g.id.startsWith('d:') && !g.id.endsWith('*')).length
    expect(s).toEqual({ areas: expected, survey: true })
    expect(gasAreaSummary(null)).toEqual({ areas: 0, survey: false })
  })
  test('L1: counts only areas a county row references and that have a non-null change', () => {
    const gas = [
      area('e:SOH', 'Ohio state avg'),
      area('e:SMN', 'Minnesota state avg', 'eia', { change: null as unknown as number }), // uncached: drawn gray
      area('e:R20', 'Midwest (PADD 2) avg'), // no county row points at it
      area('b:S24A', 'Minneapolis-St. Paul-Bloomington metro avg', 'bls'),
      area('d:02050', 'Bethel Census Area (Alaska DCRA)', 'dcra', { change: null as unknown as number }),
    ]
    const m = { gas, counties: { '39049': [0, 0], '27053': [1, 0], '55093': [3, 0], '02050': [4, 0] } } as unknown as MapMetrics
    expect(gasAreaSummary(m)).toEqual({ areas: 2, survey: false })
    expect(gasAreaSummary(M).areas).toBeLessThan(M.gas.filter((g) => !g.standIn && !g.id.startsWith('d:') && !g.id.endsWith('*')).length)
  })
})

describe('gas color scale: low end stands out', () => {
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  const contrast = (a: string, b: string) => {
    const [la, lb] = [lum(parseColor(a)!), lum(parseColor(b)!)].sort((x, y) => y - x)
    return (la + 0.05) / (lb + 0.05)
  }
  const dist = (a: string, b: string) => Math.hypot(...parseColor(a)!.map((v, i) => v - parseColor(b)![i]))
  const s = mapScaleFor(M.gas.map((g) => g.change ?? undefined), 'usd', 0.5, true)
  const low = scaleColor(s.kind === 'sequential' ? s.lo : 0, s)
  const high = scaleColor(s.kind === 'sequential' ? s.hi : 0, s)

  test('scale is sequential and the low end is the ramp start', () => {
    expect(s.kind).toBe('sequential')
    expect(parseColor(low)).toEqual([...SEQ_RISE_RAMP[0]])
  })
  test('low end vs background and no-data gray (regional averages use the same fill, only striped)', () => {
    expect(contrast(low, DESK.bg)).toBeGreaterThanOrEqual(3)
    expect(dist(low, NO_DATA_COLOR)).toBeGreaterThanOrEqual(80)
  })
  test('brighter = rose more: luminance rises along the ramp', () => {
    const steps = Array.from({ length: 11 }, (_, i) => scaleColor((s as { lo: number }).lo + (i / 10) * ((s as { hi: number }).hi - (s as { lo: number }).lo), s))
    for (let i = 1; i < steps.length; i++) expect(lum(parseColor(steps[i])!)).toBeGreaterThan(lum(parseColor(steps[i - 1])!))
    expect(contrast(high, low)).toBeGreaterThan(2.5)
  })
  test('parseColor reads both color forms', () => {
    expect(parseColor('#ffffff')).toEqual([255, 255, 255])
    expect(parseColor('rgb(100, 100,100)')).toEqual([100, 100, 100])
    expect(parseColor('not a color')).toBeNull()
  })
})

describe('round 19 wording: D1 "X area" keeps "area", D3 "used for counties in", D4 legend chip', () => {
  test('D1: EIA "X area avg" series read "X area price", never "X city city price"', () => {
    expect(gasKindText(area('e:Y35NY', 'New York City area avg'))).toBe('New York City area price (EIA)')
    expect(gasKindText(area('e:YORD', 'Chicago area avg'))).toBe('Chicago area price (EIA)')
    expect(gasKindText(area('b:S35C', 'Atlanta-Sandy Springs-Roswell metro avg', 'bls'))).toBe('Atlanta-Sandy Springs-Roswell metro price (BLS)')
    for (const g of M.gas) expect(gasKindText(g) ?? '').not.toMatch(/city (city )?price/)
    // Pike County PA / Lake County IN take the city series of a neighboring state's city
    const full = { ...M, gas: M.gas.map((g) => (g.change == null ? { ...g, change: 0.9, current: 3.1, asOf: '2026-08', baselineAsOf: '2025-01', window: 'common' as const } : g)) }
    expect(mapTooltip({ fips: '42103', metric: 'gas', county: COUNTIES['42103'], liveData: full }).geo).toBe('New York City area price (EIA)')
    expect(mapTooltip({ fips: '18089', metric: 'gas', county: COUNTIES['18089'], liveData: full }).geo).toBe('Chicago area price (EIA)')
  })
  test('D3: a regional average names the states that use it, not PADD membership', () => {
    expect(gasKindText(area('e:R20', 'Midwest (PADD 2) avg'), 13)).toBe('Midwest region average · used for counties in 13 states (EIA PADD 2)')
    expect(gasKindText(area('e:R20', 'Midwest (PADD 2) avg'), 13)).not.toContain('shared across')
  })
  test('D4: the legend chip says "City / metro price"', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/map/NationalMap.tsx'), 'utf8')
    expect(src).toContain('<span>City / metro price</span>')
    expect(src).not.toContain('<span>City price</span>')
  })
})

describe('D2: the city dot sits on the named city\'s principal county, never outside it', () => {
  const GEO = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/lib/data/county-geo.json'), 'utf8')) as Record<string, { gasSource: string; gasDuoarea: string; gasTier: number }>
  // Every dotted (city / metro) area the zip lookups assign, with its counties
  const dotted = new Map<string, string[]>()
  for (const [fips, g] of Object.entries(GEO)) {
    const id = g.gasSource === 'bls' ? `b:${g.gasDuoarea}${g.gasTier === 2 ? '*' : ''}` : `e:${g.gasDuoarea}`
    if (gasAreaKind(area(id, '', g.gasSource as MapGasArea['source'])) !== 'city') continue
    dotted.set(id, [...(dotted.get(id) ?? []), fips])
  }
  test('all 20 dotted areas have a principal county', () => {
    expect(dotted.size).toBe(20)
    for (const id of dotted.keys()) expect([id, gasAreaPrincipalCounty(id)]).toEqual([id, expect.stringMatching(/^\d{5}$/)])
  })
  test('only BLS Minneapolis-St. Paul (two Wisconsin counties) leaves out its principal county → no dot', () => {
    const outside = [...dotted].filter(([id, fips]) => !fips.includes(gasAreaPrincipalCounty(id)!)).map(([id]) => id)
    expect(outside).toEqual(['b:S24A'])
    expect(dotted.get('b:S24A')!.sort()).toEqual(['55093', '55109'])
    expect(gasCityDotCounty('b:S24A', dotted.get('b:S24A')!, () => 1)).toBeNull()
  })
  test('areas that include it are dotted there, whatever the jobs counts say', () => {
    for (const [id, fips] of dotted) {
      if (id === 'b:S24A') continue
      expect(gasCityDotCounty(id, fips, (f) => (f === GAS_AREA_PRINCIPAL_COUNTY.YORD ? 0 : 1e9))).toBe(gasAreaPrincipalCounty(id))
    }
    // unknown area: falls back to most jobs
    expect(gasCityDotCounty('e:YXYZ', ['01001', '01003'], (f) => (f === '01003' ? 5 : 1))).toBe('01003')
  })
  test('tooltip says which side the Minneapolis series is used for and what Minnesota uses', () => {
    const idx = M.gas.findIndex((g) => g.id === 'b:S24A')
    expect(gasAreaOutside(M, idx)).toEqual({ side: 'Wisconsin', home: 'Minnesota', homeUses: 'the Minnesota state average (EIA)' })
    const tip = mapTooltip({ fips: '55109', metric: 'gas', county: COUNTIES['55109'], liveData: M })
    expect(tip.geo).toBe('Minneapolis-St. Paul-Bloomington metro price (BLS), used here for the Wisconsin side; the Minnesota side uses the Minnesota state average (EIA)')
    // an area that includes its principal county keeps the plain wording
    expect(gasAreaOutside(M, M.gas.findIndex((g) => g.id === 'b:S35C'))).toBeNull()
  })
})

describe('D5: regional stripes never brighten the value color', () => {
  test('apparent lightness shift < 2% at the ramp ends and midpoint, and darker (never brighter)', () => {
    for (const c of SEQ_RISE_RAMP) {
      const d = stripeLightnessShift(c)
      expect(Math.abs(d)).toBeLessThan(0.02)
      expect(d).toBeLessThanOrEqual(0)
    }
    // the old light stripes (rgba(241,239,234,0.24), 1px of 5) brightened the low end by ~4%
    expect(stripeLightnessShift(SEQ_RISE_RAMP[0], { rgb: [241, 239, 234], alpha: 0.24, width: 1, period: 5 })).toBeGreaterThan(0.03)
    expect(GAS_REGION_STRIPE.rgb.every((v) => v < 40)).toBe(true)
  })
})
