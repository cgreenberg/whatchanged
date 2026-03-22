/**
 * Verifies the state FIPS → abbreviation mapping is complete and correct.
 * Source: US Census Bureau FIPS codes.
 */

import { STATE_FIPS_TO_ABBR } from '@/lib/mappings/state-fips'

// Ground truth: all 50 states + DC with their FIPS codes
const VERIFIED_FIPS: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
}

describe('STATE_FIPS_TO_ABBR mapping', () => {
  test('covers all 50 states + DC (51 entries)', () => {
    expect(Object.keys(STATE_FIPS_TO_ABBR)).toHaveLength(51)
  })

  test.each(Object.entries(VERIFIED_FIPS))(
    'FIPS %s maps to %s',
    (fips, expectedAbbr) => {
      expect(STATE_FIPS_TO_ABBR[fips]).toBe(expectedAbbr)
    }
  )

  test('all FIPS codes are 2-digit zero-padded strings', () => {
    for (const fips of Object.keys(STATE_FIPS_TO_ABBR)) {
      expect(fips).toMatch(/^\d{2}$/)
    }
  })

  test('all abbreviations are 2-letter uppercase', () => {
    for (const abbr of Object.values(STATE_FIPS_TO_ABBR)) {
      expect(abbr).toMatch(/^[A-Z]{2}$/)
    }
  })

  test('no duplicate abbreviations', () => {
    const abbrs = Object.values(STATE_FIPS_TO_ABBR)
    expect(new Set(abbrs).size).toBe(abbrs.length)
  })

  test('FIPS 03 (old AL code) is not present — skipped in federal numbering', () => {
    expect(STATE_FIPS_TO_ABBR['03']).toBeUndefined()
  })

  test('FIPS 14 (old canal zone) is not present', () => {
    expect(STATE_FIPS_TO_ABBR['14']).toBeUndefined()
  })
})
