/**
 * Verifies that our BLS CPI area code → metro name mapping matches
 * the ground truth verified against data.bls.gov on 2026-03-22.
 *
 * Each area code was manually verified by loading
 * https://data.bls.gov/timeseries/CUUR{code}SAF11 and reading
 * the "Area:" field in the response.
 *
 * If BLS changes area code assignments, update both the verified
 * mapping here AND the BLS_CPI_AREAS in src/lib/mappings/county-metro-cpi.ts.
 */

import { BLS_CPI_AREAS } from '@/lib/mappings/county-metro-cpi'

// Hardcoded verified mappings from manual BLS website checks (2026-03-22)
const VERIFIED_MAPPINGS: Record<string, string> = {
  // Metro CPI areas
  'S11A': 'Boston-Cambridge-Newton',
  'S12A': 'New York-Newark-Jersey City',
  'S12B': 'Philadelphia-Camden-Wilmington',
  'S23A': 'Chicago-Naperville-Elgin',
  'S23B': 'Detroit-Warren-Dearborn',
  'S24A': 'Minneapolis-St. Paul-Bloomington',
  'S24B': 'St. Louis',
  'S35A': 'Washington-Arlington-Alexandria',
  'S35B': 'Miami-Fort Lauderdale-West Palm Beach',
  'S35C': 'Atlanta-Sandy Springs-Roswell',
  'S35D': 'Tampa-St. Petersburg-Clearwater',
  'S35E': 'Baltimore-Columbia-Towson',
  'S37A': 'Dallas-Fort Worth-Arlington',
  'S37B': 'Houston-The Woodlands-Sugar Land',
  'S48A': 'Phoenix-Mesa-Scottsdale',
  'S48B': 'Denver-Aurora-Lakewood',
  'S49A': 'Los Angeles-Long Beach-Anaheim',
  'S49B': 'San Francisco-Oakland-Hayward',
  'S49C': 'Riverside-San Bernardino-Ontario',
  'S49D': 'Seattle-Tacoma-Bellevue',
  'S49E': 'San Diego-Carlsbad',
  'S49F': 'Urban Hawaii',
  'S49G': 'Urban Alaska',
  // Regional CPI areas (fallback for non-metro counties)
  '0100': 'Northeast Urban',
  '0200': 'Midwest Urban',
  '0300': 'South Urban',
  '0400': 'West Urban',
}

describe('BLS CPI area code verification against ground truth', () => {
  test.each(Object.entries(VERIFIED_MAPPINGS))(
    'area code %s maps to "%s"',
    (code, expectedName) => {
      const actual = BLS_CPI_AREAS[code]
      expect(actual).toBeDefined()
      expect(actual.name).toBe(expectedName)
    }
  )

  test('our mapping has no extra codes not in verified list', () => {
    for (const code of Object.keys(BLS_CPI_AREAS)) {
      expect(VERIFIED_MAPPINGS[code]).toBeDefined()
    }
  })

  test('verified list has no codes missing from our mapping', () => {
    for (const code of Object.keys(VERIFIED_MAPPINGS)) {
      expect(BLS_CPI_AREAS[code]).toBeDefined()
    }
  })
})
