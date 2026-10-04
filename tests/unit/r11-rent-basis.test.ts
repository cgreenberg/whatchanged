/**
 * Every zip has a rent basis for the Shelter card's "≈ $/yr in rent": its own Census ACS median rent, else a
 * labeled borrowed figure (PO-box donor, nearest same-county zip, county median, state median) — never blank
 * where ACS publishes anything, never a national constant, and every borrowed value names its donor.
 */
import zipCounty from '@/lib/data/zip-county.json'
import censusAcs from '@/lib/data/census-acs.json'
import basis from '@/lib/data/po-box-acs.json'
import { getCensusData } from '@/lib/data/census-acs'
import { NATIONAL_MEDIAN_RENT, fmtRentFigure } from '@/lib/compute/dollar-translations'
import { getLausAreaFipsForZip } from '@/lib/mappings/laus-area'

const ZIPS = zipCounty as Record<string, { countyFips: string; countyName: string; stateAbbr: string; cityName: string; zcta?: false }>
const ACS = censusAcs as unknown as Record<string, { medianRent: number | null; year: number; rentCoded?: 'top' | 'bottom' } | undefined>
const B = basis as unknown as {
  byZip: Record<string, string>
  nearest: Record<string, [string, number] | [string, number, 1]>
  donorMoe: Record<string, number>
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
      case 'zip':
        expect(d.medianRent).toBe(ACS[z]!.medianRent)
        expect(d.rentCoded).toBe(ACS[z]!.rentCoded)
        break
      case 'po-donor':
      case 'nearest-zip':
        expect(d.donorZip).toMatch(/^\d{5}$/)
        expect(d.donorZip).not.toBe(z)
        expect(d.medianRent).toBe(ACS[d.donorZip!]!.medianRent)
        // Reliable donors only: not top/bottom-coded, margin of error ≤ 30% of the estimate
        expect(ACS[d.donorZip!]!.rentCoded).toBeUndefined()
        expect(d.rentCoded).toBeUndefined()
        expect(B.donorMoe[d.donorZip!]).toBeGreaterThan(0)
        expect(B.donorMoe[d.donorZip!]).toBeLessThanOrEqual(0.3 * d.medianRent)
        expect(d.donorMoe).toBe(B.donorMoe[d.donorZip!])
        expect(ZIPS[d.donorZip!].countyFips).toBe(e.countyFips)
        expect(d.basisNote).toContain(`zip ${d.donorZip}`)
        expect(d.sourceLabel).toContain(`zip ${d.donorZip}`)
        break
      case 'county': {
        // Connecticut: ACS county rows are the 2022 planning regions
        const key = e.stateAbbr === 'CT' ? getLausAreaFipsForZip(z)! : e.countyFips
        expect(d.medianRent).toBe(B.counties[key].rent)
        expect(d.basisNote).toBe(`${B.counties[key].name} median (no zip figure)`)
        expect(d.sourceLabel).toContain(B.counties[key].name)
        break
      }
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

test('nearest-zip labels: "borrowed from zip XXXXX (nearest [in the same town] with a reliable Census rent, N mi)"', () => {
  for (const [z, d] of all.filter(([, d]) => d.basis === 'nearest-zip')) {
    const town = B.nearest[z][2] === 1
    expect(d.donorSameTown ?? false).toBe(town)
    if (town) expect(ZIPS[d.donorZip!].cityName.toLowerCase()).toBe(ZIPS[z].cityName.toLowerCase())
    const what = town ? 'nearest in the same town' : 'nearest'
    expect(d.basisNote).toBe(`borrowed from zip ${d.donorZip} (${what} with a reliable Census rent, ${d.donorMiles!.toFixed(1)} mi)`)
    expect(d.donorMiles).toBeGreaterThanOrEqual(0)
    // The 100-mi cap applies before the same-town preference; beyond it the county median is used (vast Alaska boroughs)
    expect(d.donorMiles).toBeLessThanOrEqual(100)
  }
  // 21250 (UMBC) prefers a Baltimore zip over a nearer Catonsville one, and says so
  expect(getCensusData('21250').basisNote).toMatch(/^borrowed from zip \d{5} \(nearest in the same town with a reliable Census rent, \d+\.\d mi\)$/)
})

test('Dorchester County MD zips no longer borrow top-coded 21622 ("3,500+"); a reliable nearby median instead', () => {
  expect(ACS['21622']!.rentCoded).toBe('top')
  for (const z of ['21626', '21634', '21648', '21669', '21675', '21677']) {
    const d = getCensusData(z)
    expect(d.donorZip).not.toBe('21622')
    expect(d.medianRent).toBeLessThan(1500) // county median is $959
  }
})

test("a zip's own top-coded median is kept but shown as \"$3,500+\" and labeled", () => {
  const d = getCensusData('10004')
  expect(d).toMatchObject({ basis: 'zip', rentCoded: 'top', medianRent: 3501 })
  expect(d.basisNote).toMatch(/top-coded/)
  expect(d.sourceLabel).toContain('$3,500+, top-coded')
  expect(fmtRentFigure(d.medianRent, d.rentCoded)).toBe('$3,500+')
  expect(fmtRentFigure(1234)).toBe('$1,234')
})

test('Connecticut zips: the county tier is their planning region (Census reports CT by planning region)', () => {
  for (const [z, e] of Object.entries(ZIPS)) {
    if (e.stateAbbr !== 'CT') continue
    const region = getLausAreaFipsForZip(z)!
    expect(region).toMatch(/^091[1-9]0$/)
    expect(B.counties[region].name).toMatch(/Planning Region, CT$/)
  }
})

test('35460 (formerly the fake $1,271) now has a real, labeled basis', () => {
  expect(ACS['35460']?.medianRent ?? null).toBeNull()
  const d = getCensusData('35460')
  expect(d.basis).toBe('nearest-zip')
  expect(d.medianRent).toBeGreaterThan(0)
  expect(d.basisNote).toMatch(/^borrowed from zip \d{5} \(nearest with a reliable Census rent, \d+\.\d mi\)$/)
})

test('a zip with its own figure keeps it; county and state medians are ACS 2023 published values', () => {
  expect(getCensusData('98683')).toMatchObject({ basis: 'zip', source: 'acs' })
  expect(Object.values(B.counties).every((c) => c.rent > 0 && /, [A-Z]{2}$/.test(c.name))).toBe(true)
  expect(Object.keys(B.states).length).toBeGreaterThanOrEqual(52)
})
