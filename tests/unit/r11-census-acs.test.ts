import censusAcs from '@/lib/data/census-acs.json'
import { getCensusData } from '@/lib/data/census-acs'
import { NATIONAL_MEDIAN_RENT } from '@/lib/compute/dollar-translations'

// The bundled ACS file must carry only published Census estimates. scripts/build-census-acs.ts once
// wrote the U.S. median ($1,271) whenever a zip's rent was suppressed (4,912 zips), and the app
// treated it as local rent. Suppressed values are null now.
type Entry = { medianIncome: number | null; medianRent: number | null; year: number }
const ACS = censusAcs as unknown as Record<string, Entry>

/**
 * ZCTAs whose PUBLISHED ACS 2023 5-year median gross rent (B25064_E001, summary file
 * acsdt5y2023-b25064.dat) is exactly $1,271 — genuine, not a fallback.
 */
const GENUINE_1271 = new Set([
  '02920', '04255', '31909', '49248', '55703', '60438', '60634', '73503', '78112', '83262', '83552', '99001', '99789',
])

describe('census-acs.json carries no synthetic values', () => {
  const entries = Object.entries(ACS)

  test('every value is a published positive estimate or null', () => {
    const bad = entries.filter(([, e]) =>
      [e.medianRent, e.medianIncome].some(v => v !== null && !(Number.isInteger(v) && v > 0)),
    )
    expect(bad).toEqual([])
    expect(entries.every(([, e]) => e.medianRent !== null || e.medianIncome !== null)).toBe(true)
  })

  test('no zip carries the U.S. median rent fallback unless Census published exactly that figure', () => {
    const at = entries.filter(([, e]) => e.medianRent === NATIONAL_MEDIAN_RENT).map(([z]) => z).sort()
    expect(at).toEqual([...GENUINE_1271].sort())
  })

  test('suppressed rents are recorded as null (not dropped or replaced)', () => {
    expect(ACS['35460']).toMatchObject({ medianRent: null, medianIncome: 30096 })
    expect(entries.filter(([, e]) => e.medianRent === null).length).toBeGreaterThan(4000)
  })

  test('a zip with a suppressed rent never uses a synthetic value: it borrows a labeled real one (tests/unit/r11-rent-basis.test.ts)', () => {
    const r = getCensusData('35460')
    expect(r).toMatchObject({ source: 'acs', basis: 'nearest-zip', isFallback: false, isRentFallback: false })
    expect(r.medianRent).toBe(ACS[r.donorZip!]!.medianRent)
  })

  test('a genuine $1,271 median is still local', () => {
    expect(getCensusData('04255')).toMatchObject({ source: 'acs', medianRent: 1271, isRentFallback: false })
  })
})
