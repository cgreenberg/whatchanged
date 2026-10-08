/**
 * County map Rent layer tiers (map-metro-rent.ts mapRentTier): county → metro → city → HUD Fair Market Rent, then a
 * quiet solid gray for no data. The Zillow tiers follow the Rent card's ladder exactly; HUD is map only.
 */
import fs from 'fs'
import path from 'path'
import { mapRentTier, mapCityRent, mapHudRent } from '@/lib/map-metro-rent'
import { lookupCityRent, lookupCountyRent, lookupMetroRent } from '@/lib/rent'
import { mapTooltip } from '@/lib/map-tooltip'
import { NO_DATA_COLOR, divergingColor, mutedColor, hudRentLabel, type CountyMap, type LocalMeta } from '@/lib/county-data'

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

test('Georgetown County SC takes Murrells Inlet city rent on the map and the card', () => {
  const t = mapRentTier('45043', COUNTIES['45043'])
  expect(t).toMatchObject({ tier: 'city', city: { name: 'Murrells Inlet', state: 'SC' } })
  expect(lookupCityRent('45043', 'Georgetown County, SC').data).toMatchObject({ level: 'city', geoName: 'Murrells Inlet city, SC', countyName: 'Georgetown County, SC' })
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

test('tooltips name the tier and its source; HUD label carries the fiscal years from meta', () => {
  const label = hudRentLabel(META)
  expect(label).toMatch(/^HUD fair market rent \(yearly estimate, FY2025→FY20\d\d\)$/)
  const city = mapTooltip({ fips: '45043', metric: 'rent', county: COUNTIES['45043'], liveData: null, hudLabel: label })
  expect(city).toMatchObject({ tier: 'city', geo: 'Murrells Inlet city rent (Zillow; no county or metro series)', noData: false })
  const hudFips = SHAPES.find((f) => mapRentTier(f, COUNTIES[f])?.tier === 'hud')!
  const hud = mapTooltip({ fips: hudFips, metric: 'rent', county: COUNTIES[hudFips], liveData: null, hudLabel: label })
  expect(hud.tier).toBe('hud')
  expect(hud.value).toMatch(/^Rent [+−]?\d+\.\d%$/)
  expect(hud.geo).toBe(`${label}, HUD area; not since Jan 2025; no Zillow rent`)
  // home prices never use the rent tiers
  expect(mapTooltip({ fips: hudFips, metric: 'hv', county: { n: 'x' }, liveData: null }).noData).toBe(true)
})

test('no-data fill is a quiet solid neutral gray; HUD fill is a muted version of the scale color', () => {
  expect(NO_DATA_COLOR).toMatch(/^#[0-9a-f]{6}$/i)
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(NO_DATA_COLOR.slice(i, i + 2), 16))
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(10)
  const vivid = divergingColor(8, 10)
  const muted = mutedColor(vivid)
  const sat = (c: string) => { const v = c.match(/\d+/g)!.map(Number); return Math.max(...v) - Math.min(...v) }
  expect(sat(muted)).toBeLessThan(sat(vivid) * 0.5)
  expect(sat(muted)).toBeGreaterThan(0)
  expect(mutedColor('#123456')).toBe('#123456')
})
