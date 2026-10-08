import { getCensusData } from '@/lib/data/census-acs'
import { NATIONAL_MEDIAN_RENT } from '@/lib/compute/dollar-translations'
import censusAcs from '@/lib/data/census-acs.json'

const ACS = censusAcs as Record<string, { medianRent: number | null; year: number }>

// Census ACS median gross rent: the only Census figure the site uses (base of the Shelter (CPI)
// card's "≈ $/yr in rent"). Income is no longer read anywhere (the tariff estimate was removed).
describe('getCensusData — rent provenance', () => {
  test('zip with ACS rent → source acs, its own figure and year', () => {
    const r = getCensusData('98683')
    expect(r).toMatchObject({ source: 'acs', year: 2023, isFallback: false, isRentFallback: false })
    expect(r.medianRent).toBe(ACS['98683'].medianRent)
    expect(r.rent).toBe(r.medianRent)
    expect(r.donorZip).toBeUndefined()
    expect(r.sourceLabel).toBe('Census ACS 2023 5-year, zip 98683')
    expect(r).not.toHaveProperty('medianIncome')
  })

  test('USPS-only zip with a same-city donor → donorZip + donorScope city, donor rent', () => {
    const r = getCensusData('10008')
    expect(r).toMatchObject({ source: 'acs', donorZip: '10025', donorScope: 'city', approxFromZip: '10025' })
    expect(r.medianRent).toBe(ACS['10025'].medianRent)
    expect(r.sourceLabel).toMatch(/zip 10025 \(largest residential zip in the same city\)/)
  })

  test('USPS-only zip whose donor is in another city → donorScope county', () => {
    const r = getCensusData('10587')
    expect(r.donorZip).toBeDefined()
    expect(r.donorScope).toBe('county')
    expect(r.sourceLabel).toMatch(/same county/)
  })

  test('zip without its own rent (Rockefeller Center) → nearest same-county zip with one, labeled with the distance', () => {
    expect(getCensusData('10020')).toMatchObject({
      basis: 'nearest-zip', donorZip: '10019', source: 'acs', isFallback: false, isRentFallback: false,
      basisNote: 'borrowed from zip 10019 (nearest with a reliable Census rent, 0.5 mi)',
    })
  })

  test('no ACS rent at any level (Guam) → no figure at all, flagged as a rent fallback; never the U.S. median', () => {
    const r = getCensusData('96910')
    expect(r).toMatchObject({ source: 'none', basis: 'none', isFallback: true, isRentFallback: true })
    expect(r.medianRent).not.toBe(NATIONAL_MEDIAN_RENT)
  })
})
