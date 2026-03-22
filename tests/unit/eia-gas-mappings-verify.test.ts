/**
 * Verifies EIA gas price mapping integrity.
 *
 * Checks that:
 * - CPI area codes used in EIA mappings exist in our BLS CPI area table
 * - PAD district assignments cover all 50 states + DC
 * - State-level codes use correct duoarea format
 * - County FIPS overrides have valid 5-digit keys
 * - No mapping references a nonexistent CPI area code
 */

import { BLS_CPI_AREAS } from '@/lib/mappings/county-metro-cpi'
import {
  CPI_TO_EIA_CITY,
  COUNTY_EIA_CITY_OVERRIDES,
  STATE_LEVEL_CODES,
  STATE_TO_PAD,
} from '@/lib/mappings/eia-gas'

describe('CPI_TO_EIA_CITY mapping integrity', () => {
  test('all CPI area codes in EIA city mapping exist in BLS_CPI_AREAS', () => {
    for (const cpiCode of Object.keys(CPI_TO_EIA_CITY)) {
      expect(BLS_CPI_AREAS[cpiCode]).toBeDefined()
    }
  })

  test('all entries have a non-empty duoarea and label', () => {
    for (const [code, entry] of Object.entries(CPI_TO_EIA_CITY)) {
      expect(entry.duoarea).toBeTruthy()
      expect(entry.label).toBeTruthy()
    }
  })

  // Ground truth: verified EIA city duoarea codes
  const VERIFIED_CPI_TO_EIA: Record<string, string> = {
    'S49D': 'Y48SE',  // Seattle
    'S49A': 'Y05LA',  // Los Angeles
    'S49B': 'Y05SF',  // San Francisco
    'S12A': 'Y35NY',  // New York
    'S11A': 'YBOS',   // Boston
    'S23A': 'YORD',   // Chicago
    'S48B': 'YDEN',   // Denver
    'S37B': 'Y44HO',  // Houston
    'S35B': 'YMIA',   // Miami
  }

  test.each(Object.entries(VERIFIED_CPI_TO_EIA))(
    'CPI area %s maps to EIA duoarea %s',
    (cpiCode, expectedDuoarea) => {
      expect(CPI_TO_EIA_CITY[cpiCode]?.duoarea).toBe(expectedDuoarea)
    }
  )
})

describe('STATE_TO_PAD mapping integrity', () => {
  const ALL_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
    'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
    'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
    'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
    'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
    'WY',
  ]

  test('all 50 states + DC are assigned a PAD district', () => {
    for (const state of ALL_STATES) {
      expect(STATE_TO_PAD[state]).toBeDefined()
    }
  })

  // Ground truth: verified PAD assignments for key states
  const VERIFIED_PADS: Record<string, number> = {
    NY: 1, FL: 1, GA: 1, VA: 1,  // East Coast
    IL: 2, OH: 2, MI: 2, MN: 2,  // Midwest
    TX: 3, LA: 3, AL: 3,          // Gulf Coast
    CO: 4, MT: 4, UT: 4,          // Rocky Mountain
    CA: 5, WA: 5, OR: 5, AZ: 5,  // West Coast
  }

  test.each(Object.entries(VERIFIED_PADS))(
    '%s is in PAD district %i',
    (state, expectedPad) => {
      expect(STATE_TO_PAD[state]).toBe(expectedPad)
    }
  )
})

describe('STATE_LEVEL_CODES mapping integrity', () => {
  test('all state codes use S{XX} duoarea format', () => {
    for (const [state, entry] of Object.entries(STATE_LEVEL_CODES)) {
      expect(entry.duoarea).toBe(`S${state}`)
    }
  })

  test('all keys are 2-letter state abbreviations', () => {
    for (const state of Object.keys(STATE_LEVEL_CODES)) {
      expect(state).toMatch(/^[A-Z]{2}$/)
    }
  })
})

describe('COUNTY_EIA_CITY_OVERRIDES integrity', () => {
  test('all keys are 5-digit FIPS codes', () => {
    for (const fips of Object.keys(COUNTY_EIA_CITY_OVERRIDES)) {
      expect(fips).toMatch(/^\d{5}$/)
    }
  })

  test('all entries have non-empty duoarea and label', () => {
    for (const entry of Object.values(COUNTY_EIA_CITY_OVERRIDES)) {
      expect(entry.duoarea).toBeTruthy()
      expect(entry.label).toBeTruthy()
    }
  })
})
