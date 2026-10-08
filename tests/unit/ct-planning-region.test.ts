/**
 * Connecticut FIPS remapping tests.
 *
 * CT abolished counties in 2022 and replaced them with Planning Council Regions.
 * Old county FIPS (09001–09015) map to new planning region FIPS (09110–09190).
 * Used by the county income lookup (census-acs.ts) and county-geo build script.
 */

import { getLausAreaForCounty, getLausAreaFipsForZip, getLausAreaName } from '@/lib/mappings/laus-area'

const region = (fips: string) => getLausAreaForCounty(fips).fips

describe('CT county FIPS → planning region remapping', () => {
  test('Hartford (09003) → Capitol Planning Region (09110)', () => {
    expect(region('09003')).toBe('09110')
  })

  test('Fairfield (09001) → Western CT Planning Region (09190, most housing units)', () => {
    expect(region('09001')).toBe('09190')
  })

  test('planning-region FIPS pass through unchanged', () => {
    expect(region('09120')).toBe('09120')
    expect(region('09190')).toBe('09190')
  })

  test('Windham (09015) → Northeastern CT Planning Region (09150)', () => {
    expect(region('09015')).toBe('09150')
  })

  test('Tolland (09013) → Capitol Planning Region (09110)', () => {
    expect(region('09013')).toBe('09110')
  })

  test('New Haven (09009) → South Central CT Planning Region (09170)', () => {
    expect(region('09009')).toBe('09170')
  })

  test('Litchfield (09005) → Northwest Hills Planning Region (09160)', () => {
    expect(region('09005')).toBe('09160')
  })

  test('Middlesex (09007) → Lower CT River Valley Planning Region (09130)', () => {
    expect(region('09007')).toBe('09130')
  })

  test('New London (09011) → Southeastern CT Planning Region (09180)', () => {
    expect(region('09011')).toBe('09180')
  })
})

describe('Non-CT FIPS are unchanged', () => {
  test('California Monterey County (06053) is not remapped', () => {
    expect(region('06053')).toBe('06053')
  })

  test('Clark County WA (53011) is not remapped', () => {
    expect(region('53011')).toBe('53011')
  })

  test('Cook County IL (17031) is not remapped', () => {
    expect(region('17031')).toBe('17031')
  })
})

describe('CT planning region resolves per zip', () => {
  test.each([
    ['06902', '09190'], // Stamford
    ['06830', '09190'], // Greenwich
    ['06810', '09190'], // Danbury
    ['06604', '09120'], // Bridgeport
  ])('%s → %s', (zip, expected) => {
    expect(getLausAreaFipsForZip(zip)).toBe(expected)
  })

  test('CT areas carry the planning-region name; other counties do not', () => {
    expect(getLausAreaName(getLausAreaFipsForZip('06902')!)).toBe('Western Connecticut Planning Region')
    expect(getLausAreaFipsForZip('98683')).toBe('53011')
    expect(getLausAreaName('53011')).toBeUndefined()
  })
})
