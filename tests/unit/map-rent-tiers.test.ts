/**
 * County map Rent layer tiers (map-metro-rent.ts mapRentTier): county → metro → city, colored; a HUD Fair Market Rent
 * tier (no usable Zillow rent) and no data are both the quiet solid no-data gray. The Zillow tiers follow the Rent
 * card's ladder exactly; HUD's estimate appears only in the tooltip / panel, labeled as not actual rents.
 */
import fs from 'fs'
import path from 'path'
import { mapRentTier, mapCityRent, mapHudRent, rentFillValue, rentLayer } from '@/lib/map-metro-rent'
import { lookupCityRent, lookupCountyRent, lookupMetroRent } from '@/lib/rent'
import { mapTooltip } from '@/lib/map-tooltip'
import { NO_DATA_COLOR, METRICS, hudRentLabel, hudWindow, hudPanelArea, mapScaleFor, type CountyMap, type LocalMeta } from '@/lib/county-data'

const read = (p: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), p), 'utf8'))
const COUNTIES = read('public/data/counties.json') as CountyMap
const META = read('public/data/meta.json') as LocalMeta
const TOPO = read('public/data/counties-albers-10m.json') as { objects: { counties: { geometries: { id: string }[] } } }
const SHAPES = TOPO.objects.counties.geometries.map((g) => String(g.id).padStart(5, '0'))

test('every map county is colored by exactly one rent tier; only a handful have no rent data', () => {
  const n = { county: 0, metro: 0, city: 0, hud: 0, none: [] as string[] }
  for (const f of SHAPES) {
    const t = mapRentTier(f, COUNTIES[f])
    if (t) n[t.tier]++
    else n.none.push(f)
  }
  expect(n.county).toBeGreaterThan(800)
  expect(n.metro).toBeGreaterThan(400)
  expect(n.city).toBeGreaterThanOrEqual(1)
  expect(n.hud).toBeGreaterThan(1500)
  // Kalawao HI (no HUD row) and Jackson County CO (HUD change outside the plausible range) stay gray
  expect(n.none.length).toBeLessThanOrEqual(5)
  expect(n.county + n.metro + n.city + n.hud + n.none.length).toBe(SHAPES.length)
})

test('map city / HUD tiers ⇔ the Rent card ladder: city exactly where the card uses the city rung; HUD only where the card has no Zillow rent', () => {
  let city = 0
  for (const f of Object.keys(COUNTIES)) {
    const t = mapRentTier(f, COUNTIES[f])
    const county = lookupCountyRent(f).data
    const metro = county ? null : lookupMetroRent(f).data
    const cardCity = county || metro ? null : lookupCityRent(f).data
    expect([f, t?.tier === 'city' ? t.pct : null]).toEqual([f, cardCity ? cardCity.pct : null])
    if (t?.tier === 'hud') expect([f, county, metro, cardCity]).toEqual([f, null, null, null])
    if (cardCity) city++
  }
  expect(city).toBeGreaterThanOrEqual(1)
})

test('Georgetown County SC takes Murrells Inlet rent on the map and the card (an unincorporated place: "area", not "city")', () => {
  const t = mapRentTier('45043', COUNTIES['45043'])
  expect(t).toMatchObject({ tier: 'city', city: { name: 'Murrells Inlet', state: 'SC' } })
  expect(lookupCityRent('45043', 'Georgetown County, SC').data).toMatchObject({ level: 'city', geoName: 'Murrells Inlet area, SC', countyName: 'Georgetown County, SC' })
  // a county with its own series or a usable metro never gets a city
  expect(mapCityRent('17031')).toBeNull()
})

test('HUD tier: values validated, sanity range applied, never for a county with Zillow rent', () => {
  expect(mapHudRent({ n: 'x', rentH: { p: 9.3, b: 1000, c: 1093 } })).toEqual({ pct: 9.3, base: 1000, cur: 1093 })
  expect(mapHudRent({ n: 'x', rentH: { p: 59.2, b: 1000, c: 1592 } })).toBeNull()
  expect(mapHudRent({ n: 'x', rentH: { p: Number.NaN, b: 1000, c: 1000 } })).toBeNull()
  expect(mapHudRent({ n: 'x', rentH: { p: 5, b: 0, c: 1050 } })).toBeNull()
  // county rent wins over a stray HUD field
  expect(mapRentTier('00000', { n: 'x', rent: 2.1, rentH: { p: 9, b: 1, c: 1 } })).toEqual({ tier: 'county', pct: 2.1 })
  for (const [f, c] of Object.entries(COUNTIES)) if (c.rentH) expect([f, c.rent]).toEqual([f, undefined])
  expect(COUNTIES['02261']?.rentH?.from).toBe('Chugach Census Area')
})

test('tooltips name the tier and its source; a HUD-tier county says "no usable Zillow rent" and labels HUD as an estimate', () => {
  const label = hudRentLabel(META)
  expect(label).toMatch(/^HUD fair market rent \(yearly estimate, FY2025→FY20\d\d\)$/)
  const win = hudWindow(META).window
  expect(win).toMatch(/^FY2025→FY20\d\d$/)
  const city = mapTooltip({ fips: '45043', metric: 'rent', county: COUNTIES['45043'], liveData: null, hudWindowText: win })
  expect(city).toMatchObject({ tier: 'city', geo: 'Murrells Inlet area rent (Zillow city series; no usable county or metro series)', noData: false })
  const hudFips = SHAPES.find((f) => mapRentTier(f, COUNTIES[f])?.tier === 'hud')!
  const hud = mapTooltip({ fips: hudFips, metric: 'rent', county: COUNTIES[hudFips], liveData: null, hudWindowText: win })
  const pct = (mapRentTier(hudFips, COUNTIES[hudFips]) as { pct: number }).pct
  expect(hud).toMatchObject({ tier: 'hud', noData: true, value: 'Rent: No usable Zillow rent here' })
  expect(hud.geo).toBe(`HUD Fair Market Rent (a yearly projected estimate, not a market-rent index): ${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}% · 2-bedroom, HUD area, ${win}, not since Jan 2025`)
  // Census ACS is actual rent paid and Zillow is asking rents: HUD is never contrasted with "actual rents"
  expect(hud.geo).not.toMatch(/actual rent/i)
  // home prices never use the rent tiers
  expect(mapTooltip({ fips: hudFips, metric: 'hv', county: { n: 'x' }, liveData: null }).noData).toBe(true)
})

test('Etowah County AL (a too-new Zillow series, HUD tier): "no usable Zillow rent", never "no Zillow rent"', () => {
  const t = mapRentTier('01055', COUNTIES['01055'])
  expect(t?.tier).toBe('hud')
  const tip = mapTooltip({ fips: '01055', metric: 'rent', county: COUNTIES['01055'], liveData: null })
  expect(tip.value).toBe('Rent: No usable Zillow rent here')
  expect(`${tip.value} ${tip.geo}`).not.toMatch(/\bno Zillow rent\b/i)
  expect(hudPanelArea(META)).toContain('no usable Zillow rent for this county')
  expect(hudPanelArea(META)).toContain('a yearly projected estimate, not a market-rent index')
  expect(hudPanelArea(META)).not.toMatch(/actual rent/i)
})

test('no-data fill is a quiet solid neutral gray', () => {
  expect(NO_DATA_COLOR).toMatch(/^#[0-9a-f]{6}$/i)
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(NO_DATA_COLOR.slice(i, i + 2), 16))
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(10)
})

describe('HUD tier is off the Rent color scale (owner decision, round 17)', () => {
  const clamp = METRICS.find((m) => m.key === 'rent')!.clamp
  const hudFips = SHAPES.filter((f) => mapRentTier(f, COUNTIES[f])?.tier === 'hud')

  test('every HUD-tier county gets the no-data color (no fill entry, drawn NO_DATA_COLOR) and no fill value', () => {
    expect(hudFips.length).toBeGreaterThan(1500)
    const { fills } = rentLayer(SHAPES, COUNTIES, clamp)
    for (const f of hudFips) {
      expect([f, rentFillValue(f, COUNTIES[f])]).toEqual([f, undefined])
      expect([f, fills.get(f) ?? NO_DATA_COLOR]).toEqual([f, NO_DATA_COLOR])
    }
    // Zillow-tier counties are colored, and never with the no-data gray
    const zillow = SHAPES.filter((f) => ['county', 'metro', 'city'].includes(mapRentTier(f, COUNTIES[f])?.tier ?? ''))
    expect(zillow.length).toBeGreaterThan(1200)
    for (const f of zillow) {
      expect(fills.get(f)).toBeDefined()
      expect(fills.get(f)).not.toBe(NO_DATA_COLOR)
    }
  })

  test('HUD values do not affect the scale: extreme HUD changes leave scale and Zillow fills unchanged', () => {
    const base = rentLayer(SHAPES, COUNTIES, clamp)
    // the scale equals the one from Zillow values alone
    const zillowOnly = mapScaleFor(SHAPES.map((f) => rentFillValue(f, COUNTIES[f])), 'pct', clamp)
    expect(base.scale).toEqual(zillowOnly)
    for (const extreme of [49, -19]) {
      const pushed: CountyMap = { ...COUNTIES }
      for (const f of hudFips) pushed[f] = { ...COUNTIES[f], rentH: { ...COUNTIES[f].rentH!, p: extreme } }
      const moved = rentLayer(SHAPES, pushed, clamp)
      expect(moved.scale).toEqual(base.scale)
      expect([...moved.fills.entries()]).toEqual([...base.fills.entries()])
    }
  })
})
