/** Static sources bundled by scripts/build-local-data.py: Zillow metro rent, Alaska DCRA gas, Puerto Rico DACO gas. */
import { lookupMetroRent, lookupCountyRent, metroForCounty } from '@/lib/rent'
import { lookupAkGas, lookupPrGas } from '@/lib/static-gas'
import akGas from '@/lib/data/ak-gas.json'

describe('Zillow metro rent (counties without a county series)', () => {
  test('Sagadahoc ME → Portland-South Portland metro (OMB 2020 CBSA 38860), labeled as the metro', () => {
    expect(lookupCountyRent('23023').data).toBeNull()
    expect(metroForCounty('23023')).toEqual({ cbsa: '38860', name: 'Portland-South Portland, ME' })
    const r = lookupMetroRent('23023', 'Sagadahoc County').data!
    expect(r).toMatchObject({ level: 'metro', cbsa: '38860', countyFips: '23023', countyName: 'Sagadahoc County', geoName: 'Portland-South Portland, ME metro', baseMonth: '2025-01' })
    expect(r.monthlyChange).toBe(Math.round(r.curRent - r.curRent / (1 + r.pct / 100)))
  })
  test('a county with its own series never maps to a metro', () => {
    expect(lookupCountyRent('23005').data).not.toBeNull() // Cumberland ME
    expect(metroForCounty('23005')).toBeNull()
    expect(lookupMetroRent('23005').data).toBeNull()
  })
})

describe('Alaska DCRA Community Fuel Price Survey', () => {
  test('own community: Fairbanks, Bethel — Jan 2025 survey vs latest survey, twice yearly', () => {
    for (const [zip, place] of [['99701', 'Fairbanks'], ['99559', 'Bethel']]) {
      const r = lookupAkGas(zip)
      expect(r.hit).toMatchObject({ match: 'community', place, lookup: { source: 'dcra', frequency: 'semiannual' } })
      expect(r.hit!.data.baselineDate).toBe('2025-01')
      expect(r.hit!.data.series.every((p) => /^\d{4}-(01|07)$/.test(p.date))).toBe(true)
      expect(r.hit!.data.latestDate).toBe((akGas as { meta: { latestSurvey: string } }).meta.latestSurvey)
    }
  })
  test('nearest surveyed community (same borough, ≤ 100 km) and region average are labeled', () => {
    const nome = lookupAkGas('99762').hit!
    expect(nome.match).toBe('nearest')
    expect(nome.km).toBeLessThanOrEqual(100)
    const region = Object.entries((akGas as { zips: Record<string, { k: string }> }).zips).find(([, m]) => m.k === 'r')![0]
    expect(lookupAkGas(region).hit).toMatchObject({ match: 'region', lookup: { tier: 3 } })
  })
  test('Anchorage CBSA and non-Alaska zips are not in the survey mapping', () => {
    expect(lookupAkGas('99501').hit).toBeNull() // Anchorage: BLS monthly metro price
    expect(lookupAkGas('99645').hit).toBeNull() // Palmer (Mat-Su)
    expect(lookupAkGas('04101').hit).toBeNull()
  })
})

describe('Puerto Rico DACO', () => {
  test('island-wide regular gasoline, $/gal, Jan 2025 baseline; unsurveyed months are gaps', () => {
    const r = lookupPrGas().hit!
    expect(r.lookup).toMatchObject({ source: 'daco', frequency: 'monthly' })
    expect(r.data.baselineDate).toBe('2025-01')
    expect(r.data.baseline).toBeCloseTo(3.0281, 4) // 302.81 ¢/gal
    expect(r.data.unpublished).toEqual(expect.arrayContaining(['2020-04', '2020-05']))
  })
})
