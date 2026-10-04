/**
 * Connecticut FIPS remapping tests.
 *
 * CT abolished counties in 2022 and replaced them with Planning Council Regions.
 * Old county FIPS (09001–09015) must be remapped to new planning region FIPS
 * (09110–09190) before building BLS LAUS series IDs.
 */

import { buildSeriesId } from '@/lib/api/bls'
import { resolveLausArea } from '@/lib/mappings/laus-area'

describe('CT county FIPS → planning region remapping', () => {
  test('Hartford (09003) → Capitol Planning Region (09110)', () => {
    expect(buildSeriesId('09003')).toBe('LAUCN091100000000003')
  })

  test('Fairfield (09001) → Western CT Planning Region (09190, most housing units)', () => {
    expect(buildSeriesId('09001')).toBe('LAUCN091900000000003')
  })

  test('planning-region FIPS pass through unchanged', () => {
    expect(buildSeriesId('09120')).toBe('LAUCN091200000000003')
    expect(buildSeriesId('09190')).toBe('LAUCN091900000000003')
  })

  test('Windham (09015) → Northeastern CT Planning Region (09150)', () => {
    expect(buildSeriesId('09015')).toBe('LAUCN091500000000003')
  })

  test('Tolland (09013) → Capitol Planning Region (09110)', () => {
    expect(buildSeriesId('09013')).toBe('LAUCN091100000000003')
  })

  test('New Haven (09009) → South Central CT Planning Region (09170)', () => {
    expect(buildSeriesId('09009')).toBe('LAUCN091700000000003')
  })

  test('Litchfield (09005) → Northwest Hills Planning Region (09160)', () => {
    expect(buildSeriesId('09005')).toBe('LAUCN091600000000003')
  })

  test('Middlesex (09007) → Lower CT River Valley Planning Region (09130)', () => {
    expect(buildSeriesId('09007')).toBe('LAUCN091300000000003')
  })

  test('New London (09011) → Southeastern CT Planning Region (09180)', () => {
    expect(buildSeriesId('09011')).toBe('LAUCN091800000000003')
  })
})

describe('Non-CT FIPS are unchanged', () => {
  test('California Monterey County (06053) is not remapped', () => {
    expect(buildSeriesId('06053')).toBe('LAUCN060530000000003')
  })

  test('Clark County WA (53011) is not remapped', () => {
    expect(buildSeriesId('53011')).toBe('LAUCN530110000000003')
  })

  test('Cook County IL (17031) is not remapped', () => {
    expect(buildSeriesId('17031')).toBe('LAUCN170310000000003')
  })
})

describe('CT LAUS area resolves per zip', () => {
  test.each([
    ['06902', '09190'], // Stamford
    ['06830', '09190'], // Greenwich
    ['06810', '09190'], // Danbury
    ['06604', '09120'], // Bridgeport
  ])('%s → %s', (zip, region) => {
    expect(resolveLausArea(zip, '09001').fips).toBe(region)
  })

  test('CT areas carry the planning-region name; other counties do not', () => {
    expect(resolveLausArea('06902', '09001').name).toBe('Western Connecticut Planning Region')
    expect(resolveLausArea('98683', '53011')).toEqual({ fips: '53011' })
  })
})
