/**
 * Reference code tables that were verified by hand against the publisher:
 *  - BLS CPI area codes → names (data.bls.gov/timeseries/CUUR{code}SAF11 "Area:" field, 2026-03-22)
 *  - Census state/territory FIPS codes
 * If BLS or Census change a code, update this file AND the source table.
 */

import { BLS_CPI_AREAS } from '@/lib/mappings/county-metro-cpi'
import { STATE_FIPS_MAP, STATE_FIPS_TO_ABBR } from '@/lib/mappings/state-fips'

const VERIFIED_CPI_AREAS: Record<string, string> = {
  S11A: 'Boston-Cambridge-Newton', S12A: 'New York-Newark-Jersey City',
  S12B: 'Philadelphia-Camden-Wilmington', S23A: 'Chicago-Naperville-Elgin',
  S23B: 'Detroit-Warren-Dearborn', S24A: 'Minneapolis-St. Paul-Bloomington', S24B: 'St. Louis',
  S35A: 'Washington-Arlington-Alexandria', S35B: 'Miami-Fort Lauderdale-West Palm Beach',
  S35C: 'Atlanta-Sandy Springs-Roswell', S35D: 'Tampa-St. Petersburg-Clearwater',
  S35E: 'Baltimore-Columbia-Towson', S37A: 'Dallas-Fort Worth-Arlington',
  S37B: 'Houston-The Woodlands-Sugar Land', S48A: 'Phoenix-Mesa-Scottsdale',
  S48B: 'Denver-Aurora-Lakewood', S49A: 'Los Angeles-Long Beach-Anaheim',
  S49B: 'San Francisco-Oakland-Hayward', S49C: 'Riverside-San Bernardino-Ontario',
  S49D: 'Seattle-Tacoma-Bellevue', S49E: 'San Diego-Carlsbad', S49F: 'Urban Hawaii',
  S49G: 'Urban Alaska',
  '0100': 'Northeast Urban', '0200': 'Midwest Urban', '0300': 'South Urban', '0400': 'West Urban',
  '0110': 'New England', '0120': 'Middle Atlantic', '0230': 'East North Central',
  '0240': 'West North Central', '0350': 'South Atlantic', '0360': 'East South Central',
  '0370': 'West South Central', '0480': 'Mountain', '0490': 'Pacific',
}

describe('BLS CPI area codes', () => {
  test('BLS_CPI_AREAS matches the hand-verified list exactly', () => {
    const actual = Object.fromEntries(Object.entries(BLS_CPI_AREAS).map(([k, v]) => [k, v.name]))
    expect(actual).toEqual(VERIFIED_CPI_AREAS)
  })

  test('each entry is keyed by its own code', () => {
    for (const [key, area] of Object.entries(BLS_CPI_AREAS)) expect(area.code).toBe(key)
  })
})

describe('state FIPS codes', () => {
  test('50 states + DC in STATE_FIPS_TO_ABBR, no territories', () => {
    expect(Object.keys(STATE_FIPS_TO_ABBR)).toHaveLength(51)
    expect(STATE_FIPS_TO_ABBR['72']).toBeUndefined()
  })

  test.each([
    ['01', 'AL'], ['02', 'AK'], ['04', 'AZ'], ['06', 'CA'], ['09', 'CT'], ['11', 'DC'],
    ['15', 'HI'], ['36', 'NY'], ['51', 'VA'], ['53', 'WA'], ['56', 'WY'],
    ['60', 'AS'], ['66', 'GU'], ['69', 'MP'], ['72', 'PR'], ['78', 'VI'],
  ])('FIPS %s → %s', (fips, abbr) => {
    expect(STATE_FIPS_MAP[fips].abbr).toBe(abbr)
  })

  test('unused codes (03, 07, 14, 43, 52) are absent and abbreviations are unique', () => {
    for (const f of ['03', '07', '14', '43', '52']) expect(STATE_FIPS_MAP[f]).toBeUndefined()
    const abbrs = Object.values(STATE_FIPS_MAP).map(s => s.abbr)
    expect(new Set(abbrs).size).toBe(abbrs.length)
  })
})
