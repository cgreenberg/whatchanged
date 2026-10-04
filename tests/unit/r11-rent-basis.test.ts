/**
 * Every zip has a rent basis for the Shelter card's "≈ $/yr in rent": its own Census ACS median rent, else a
 * labeled borrowed figure (PO-box donor, nearest same-county zip, county median, state median) — never blank
 * where ACS publishes anything, never a national constant, and every borrowed value names its donor.
 */
import zipCounty from '@/lib/data/zip-county.json'
import censusAcs from '@/lib/data/census-acs.json'
import basis from '@/lib/data/po-box-acs.json'
import { getCensusData } from '@/lib/data/census-acs'
import { NATIONAL_MEDIAN_RENT } from '@/lib/compute/dollar-translations'

const ZIPS = zipCounty as Record<string, { countyFips: string; countyName: string; stateAbbr: string; cityName: string; zcta?: false }>
const ACS = censusAcs as unknown as Record<string, { medianRent: number | null; year: number } | undefined>
const B = basis as unknown as {
  byZip: Record<string, string>
  nearest: Record<string, [string, number]>
  counties: Record<string, { rent: number; name: string }>
  states: Record<string, { rent: number; name: string }>
}
/** Territories the ACS does not cover (no zip, county or state rent at all). */
const NO_ACS = new Set(['GU', 'VI', 'AS', 'MP'])

const all = Object.keys(ZIPS).map((z) => [z, getCensusData(z)] as const)

test('every zip in the 50 states, DC and Puerto Rico has a published rent basis (no "none")', () => {
  const none = all.filter(([z, d]) => d.basis === 'none' && !NO_ACS.has(ZIPS[z].stateAbbr)).map(([z]) => z)
  expect(none).toEqual([])
  for (const [z, d] of all) {
    if (NO_ACS.has(ZIPS[z].stateAbbr)) {
      expect(d).toMatchObject({ basis: 'none', isRentFallback: true, medianRent: 0 })
      continue
    }
    expect(d.medianRent).toBeGreaterThan(0)
    expect(d.isRentFallback).toBe(false)
    expect(d.isFallback).toBe(false)
  }
})

test('the value equals the published figure of the geography it names (never a synthetic constant)', () => {
  for (const [z, d] of all) {
    const e = ZIPS[z]
    switch (d.basis) {
      case 'zip': expect(d.medianRent).toBe(ACS[z]!.medianRent); break
      case 'po-donor':
      case 'nearest-zip':
        expect(d.donorZip).toMatch(/^\d{5}$/)
        expect(d.donorZip).not.toBe(z)
        expect(d.medianRent).toBe(ACS[d.donorZip!]!.medianRent)
        expect(ZIPS[d.donorZip!].countyFips).toBe(e.countyFips)
        expect(d.basisNote).toContain(`zip ${d.donorZip}`)
        expect(d.sourceLabel).toContain(`zip ${d.donorZip}`)
        break
      case 'county':
        expect(d.medianRent).toBe(B.counties[e.countyFips].rent)
        expect(d.basisNote).toBe(`${B.counties[e.countyFips].name} median (no zip figure)`)
        expect(d.sourceLabel).toContain(B.counties[e.countyFips].name)
        break
      case 'state':
        expect(d.medianRent).toBe(B.states[e.stateAbbr].rent)
        expect(d.basisNote).toBe(`${B.states[e.stateAbbr].name} median (no zip or county figure)`)
        break
    }
    // The old build wrote the U.S. median (1,271) for suppressed zips; only genuinely published values may equal it
    if (d.medianRent === NATIONAL_MEDIAN_RENT && d.basis !== 'zip') {
      expect(['po-donor', 'nearest-zip', 'county', 'state']).toContain(d.basis)
    }
  }
})

test('nearest-zip labels: "borrowed from zip XXXXX (nearest with Census rent, N mi)"', () => {
  for (const [, d] of all.filter(([, d]) => d.basis === 'nearest-zip')) {
    expect(d.basisNote).toBe(`borrowed from zip ${d.donorZip} (nearest with Census rent, ${d.donorMiles!.toFixed(1)} mi)`)
    expect(d.donorMiles).toBeGreaterThanOrEqual(0)
    // Beyond 100 mi the county median is used instead (vast Alaska boroughs)
    expect(d.donorMiles).toBeLessThanOrEqual(100)
  }
})

test('35460 (formerly the fake $1,271) now has a real, labeled basis', () => {
  expect(ACS['35460']?.medianRent ?? null).toBeNull()
  const d = getCensusData('35460')
  expect(d.basis).toBe('nearest-zip')
  expect(d.medianRent).toBeGreaterThan(0)
  expect(d.basisNote).toMatch(/^borrowed from zip \d{5} \(nearest with Census rent, \d+\.\d mi\)$/)
})

test('a zip with its own figure keeps it; county and state medians are ACS 2023 published values', () => {
  expect(getCensusData('98683')).toMatchObject({ basis: 'zip', source: 'acs' })
  expect(Object.values(B.counties).every((c) => c.rent > 0 && /, [A-Z]{2}$/.test(c.name))).toBe(true)
  expect(Object.keys(B.states).length).toBeGreaterThanOrEqual(52)
})
