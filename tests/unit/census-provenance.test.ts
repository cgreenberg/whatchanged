import { getCensusData, NATIONAL_INCOME_SOURCE_LABEL } from '@/lib/data/census-acs'
import { NATIONAL_MEDIAN_INCOME } from '@/lib/compute/dollar-translations'
import countyIncome from '@/lib/data/county-income.json'

const COUNTY = countyIncome.byCounty as Record<string, number>

describe('getCensusData — income provenance', () => {
  test('zip with ACS data → source acs, incomeGeo zip, ACS year', () => {
    const r = getCensusData('98683')
    expect(r).toMatchObject({ source: 'acs', incomeGeo: 'zip', year: 2023, isFallback: false })
    expect(r.income).toBe(r.medianIncome)
    expect(r.rent).toBe(r.medianRent)
    expect(r.donorZip).toBeUndefined()
    expect(r.sourceLabel).toBe('Census ACS 2023 5-year, zip 98683')
  })

  test('USPS-only zip with a same-city donor → donorZip + donorScope city', () => {
    const r = getCensusData('10008')
    expect(r).toMatchObject({ source: 'acs', incomeGeo: 'zip', donorZip: '10025', donorScope: 'city', approxFromZip: '10025' })
    expect(r.sourceLabel).toMatch(/zip 10025 \(largest residential zip in the same city\)/)
  })

  test('USPS-only zip whose donor is in another city → donorScope county', () => {
    const r = getCensusData('10587')
    expect(r.donorZip).toBeDefined()
    expect(r.donorScope).toBe('county')
    expect(r.sourceLabel).toMatch(/same county/)
  })

  test('zip with no ACS value and no donor → county median (ACS B19013), not national', () => {
    const r = getCensusData('10020')
    expect(r).toMatchObject({ source: 'acs', incomeGeo: 'county', incomeCountyFips: '36061', year: 2023, isFallback: false })
    expect(r.income).toBe(COUNTY['36061'])
    expect(r.isRentFallback).toBe(true)
    expect(r.sourceLabel).toBe('Census ACS 2023 5-year, county median (New York County, NY)')
  })

  test('territory with no ACS county estimate → national, labeled Census CPS 2022', () => {
    const r = getCensusData('96910')
    expect(r).toMatchObject({ source: 'national', incomeGeo: 'national', year: 2022, isFallback: true })
    expect(r.income).toBe(NATIONAL_MEDIAN_INCOME)
    expect(NATIONAL_MEDIAN_INCOME).toBe(74580)
    expect(r.sourceLabel).toBe(NATIONAL_INCOME_SOURCE_LABEL)
    expect(r.sourceLabel).toMatch(/CPS ASEC 2022/)
  })

  test('county-income.json is plausible', () => {
    const vals = Object.values(COUNTY)
    expect(vals.length).toBeGreaterThan(3200)
    expect(vals.every((v) => Number.isInteger(v) && v > 10000 && v < 300000)).toBe(true)
    expect(COUNTY['09110']).toBeGreaterThan(0) // CT planning region (ACS 2023 geography)
  })
})
