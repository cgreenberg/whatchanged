/**
 * Gas map layer: the kind of published area behind each county color (city / state / regional average), derived
 * client-side from the /api/map-metrics payload; its tooltip / panel wording; and the sequential scale's low end
 * standing clear of the page background and the no-data gray.
 */
import fs from 'fs'
import path from 'path'
import { gasAreaKind, gasKindText, gasAreaStateCounts, gasAreaSummary } from '@/lib/map-gas-areas'
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
    expect(gasKindText(area('e:R20', 'Midwest (PADD 2) avg'), 13)).toBe('Midwest region average · shared across 13 states (EIA PADD 2)')
    expect(gasKindText(area('e:R1X', 'New England (PADD 1A) avg'), 1)).toBe('New England region average (EIA PADD 1A)')
    expect(gasKindText(area('e:YORD', 'Chicago area avg'))).toBe('Chicago city price (EIA)')
    expect(gasKindText(area('b:S35C', 'Atlanta-Sandy Springs-Roswell metro avg', 'bls'))).toBe('Atlanta-Sandy Springs-Roswell metro price (BLS)')
    expect(gasKindText(area('e:SOH', 'Ohio state avg'))).toBe('Ohio state average (EIA)')
    // stand-ins, the Alaska survey and Puerto Rico keep their own wording
    expect(gasKindText(area('b:S49F*', 'Honolulu-area price (BLS)', 'bls', { standIn: true }))).toBeNull()
    expect(gasKindText(area('d:02050', 'Bethel Census Area (Alaska DCRA)', 'dcra'))).toBeNull()
  })
  test('the map tooltip and the panel value use it', () => {
    // The recorded payload has no cached Chicago / Midwest series: fill them in (values don't matter here)
    const full = { ...M, gas: M.gas.map((g) => (g.change == null ? { ...g, change: 0.9, current: 3.1, asOf: '2026-08', baselineAsOf: '2025-01', window: 'common' as const } : g)) }
    // Cook County IL: Chicago city price; Polk County IA: the Midwest regional average
    const cook = mapTooltip({ fips: '17031', metric: 'gas', county: COUNTIES['17031'], liveData: full })
    expect(cook.geo).toBe('Chicago city price (EIA)')
    const atl = mapTooltip({ fips: '13121', metric: 'gas', county: COUNTIES['13121'], liveData: M })
    expect(atl.geo).toBe('Atlanta-Sandy Springs-Roswell metro price (BLS)')
    expect(liveValue(M, '13121', 'gas')).toMatchObject({ kind: 'city', kindText: 'Atlanta-Sandy Springs-Roswell metro price (BLS)' })
    expect(liveValue(full, '19153', 'gas')).toMatchObject({ kind: 'region', kindText: 'Midwest region average · shared across 13 states (EIA PADD 2)' })
    expect(mapTooltip({ fips: '19153', metric: 'gas', county: COUNTIES['19153'], liveData: full }).geo)
      .toBe('Midwest region average · shared across 13 states (EIA PADD 2)')
    const tx = mapTooltip({ fips: '48453', metric: 'gas', county: COUNTIES['48453'], liveData: M })
    expect(tx.geo).toBe('Texas state average (EIA)')
    // a HI county with no series keeps the stand-in wording
    const hi = mapTooltip({ fips: '15001', metric: 'gas', county: COUNTIES['15001'], liveData: M })
    expect(hi.geo).toContain('no series for this county')
  })
  test('published-area count for the legend: stand-ins and Alaska survey boroughs are not separate areas', () => {
    const s = gasAreaSummary(M)
    const expected = M.gas.filter((g) => !g.standIn && !g.id.startsWith('d:') && !g.id.endsWith('*')).length
    expect(s).toEqual({ areas: expected, survey: true })
    expect(gasAreaSummary(null)).toEqual({ areas: 0, survey: false })
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
