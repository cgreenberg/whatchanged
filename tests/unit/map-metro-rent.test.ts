/**
 * County map Rent layer: counties with no Zillow county series take their metro's rent, by exactly the rule the
 * Rent card's ladder uses (lookupCountyRent → lookupMetroRent), so the map never shows a metro the card wouldn't.
 */
import fs from 'fs'
import path from 'path'
import metroRent from '@/lib/data/metro-rent.json'
import { mapMetroRent } from '@/lib/map-metro-rent'
import { lookupCountyRent, lookupMetroRent } from '@/lib/rent'
import { mapTooltip } from '@/lib/map-tooltip'
import type { CountyMap } from '@/lib/county-data'

const COUNTIES = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/counties.json'), 'utf8')) as CountyMap
const METRO = metroRent as unknown as { metros: Record<string, { flagged?: boolean }>; counties: Record<string, string> }

test('every county: map metro rent ⇔ the card would use the metro rung (same CBSA, same %)', () => {
  let metroCount = 0
  for (const fips of Object.keys(COUNTIES)) {
    const onMap = COUNTIES[fips].rent != null ? null : mapMetroRent(fips)
    const county = lookupCountyRent(fips).data
    const card = county ? null : lookupMetroRent(fips).data
    expect([fips, onMap ? { cbsa: onMap.cbsa, pct: onMap.pct } : null])
      .toEqual([fips, card ? { cbsa: card.cbsa, pct: card.pct } : null])
    // a county with its own rent on the map never gets a metro stand-in
    if (COUNTIES[fips].rent != null) expect(county).not.toBeNull()
    if (onMap) metroCount++
  }
  expect(metroCount).toBeGreaterThan(300)
})

test('a flagged-outlier metro never stands in for a county', () => {
  const flagged = Object.entries(METRO.counties).filter(([, cbsa]) => METRO.metros[cbsa]?.flagged)
  expect(flagged.length).toBeGreaterThan(0)
  for (const [fips] of flagged) expect(mapMetroRent(fips)).toBeNull()
})

test('rejects malformed fips', () => {
  expect(mapMetroRent('abc')).toBeNull()
  expect(mapMetroRent('')).toBeNull()
})

test('tooltip: county rent, metro rent and no data', () => {
  const countyFips = Object.keys(COUNTIES).find((f) => COUNTIES[f].rent != null && !COUNTIES[f].flags?.includes('rent'))!
  const t = mapTooltip({ fips: countyFips, metric: 'rent', county: COUNTIES[countyFips], liveData: null })
  expect(t.name).toBe(COUNTIES[countyFips].n)
  expect(t.value).toMatch(/^Rent [+−]?\d+\.\d%$/)
  expect(t.geo).toBe('Zillow county')

  const metroFips = Object.keys(COUNTIES).find((f) => COUNTIES[f].rent == null && mapMetroRent(f))!
  const m = mapMetroRent(metroFips)!
  const mt = mapTooltip({ fips: metroFips, metric: 'rent', county: COUNTIES[metroFips], liveData: null })
  expect(mt.value).toMatch(/^Rent [+−]?\d+\.\d%$/)
  expect(mt.geo).toBe(`${m.name} metro rent (Zillow; no usable county series)`)
  expect(mt.metro).toBe(true)

  const none = mapTooltip({ fips: '99999', metric: 'rent', county: undefined, liveData: null })
  expect(none.value).toBe('Rent: No data')
  expect(none.geo).toBeNull()
})

test('tooltip: live layers carry the sign, units and the area + publisher (same value the map colors)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/map-metrics.json'), 'utf8'))
  const elec = mapTooltip({ fips: '23003', metric: 'elec', county: COUNTIES['23003'], liveData: m })
  expect(elec.name).toBe('Aroostook County, ME')
  expect(elec.value).toMatch(/^Electricity [+−]?\d+\.\d%$/)
  expect(elec.geo).toBe('Maine statewide (EIA)')
  const gas = mapTooltip({ fips: '23003', metric: 'gas', county: COUNTIES['23003'], liveData: m })
  expect(gas.value).toMatch(/^Gas [+−]\$\d\.\d{2}\/gal$/)
  expect(gas.geo).toMatch(/\((EIA|BLS)\)$/)
  const none = mapTooltip({ fips: '39035', metric: 'elec', county: COUNTIES['39035'], liveData: m })
  expect(none).toMatchObject({ value: 'Electricity: No data', geo: null, noData: true })
})
