import { getCensusData } from '@/lib/data/census-acs'

describe('getCensusData — city-level lookup', () => {
  test('city-level lookup returns city income for San Francisco', () => {
    const result = getCensusData('94102', 'san francisco', 'ca')
    expect(result.medianIncome).toBe(136689)
    expect(result.isCityLevel).toBe(true)
    expect(result.cityName).toBe('san francisco')
    expect(result.isFallback).toBe(false)
  })

  test('city-level lookup with zip in ZCTA data sets isRentFallback false', () => {
    // 94102 is a SF zip that should be in ZCTA data
    const result = getCensusData('94102', 'san francisco', 'ca')
    expect(result.isCityLevel).toBe(true)
    expect(result.isRentFallback).toBe(false)
  })

  test('city-level lookup with zip NOT in ZCTA data sets isRentFallback true', () => {
    // 94119 is a San Francisco PO-box zip with no ZCTA entry → city income, national rent fallback
    const result = getCensusData('94119', 'san francisco', 'ca')
    expect(result.isCityLevel).toBe(true)
    expect(result.isFallback).toBe(false)
    expect(result.isRentFallback).toBe(true)
  })

  test('zip-level lookup when no city provided returns isCityLevel false', () => {
    const result = getCensusData('98683')
    expect(result.isCityLevel).toBe(false)
    expect(result.medianIncome).toBeGreaterThan(0)
  })

  test('zip-level lookup sets isRentFallback false', () => {
    const result = getCensusData('98683')
    expect(result.isRentFallback).toBe(false)
  })

  test('city name not in places file falls back to zip level without crashing', () => {
    const result = getCensusData('12345', 'nonexistent city', 'xx')
    // Should not throw; should return zip-level or national fallback
    expect(result).toBeDefined()
    expect(result.medianIncome).toBeGreaterThan(0)
    expect(result.isCityLevel).toBe(false)
  })

  test('national fallback returned for unknown zip with no city', () => {
    const result = getCensusData('00000')
    expect(result.isFallback).toBe(true)
    expect(result.isRentFallback).toBe(true)
    expect(result.medianIncome).toBeGreaterThan(0)
  })

  test('case insensitive: San Francisco with mixed case still finds city-level data', () => {
    const result = getCensusData('94102', 'San Francisco', 'CA')
    expect(result.medianIncome).toBe(136689)
    expect(result.isCityLevel).toBe(true)
    expect(result.cityName).toBe('San Francisco')
  })

  test('city/state that does not contain the zip is ignored (Portland OR params on Portland ME zip)', () => {
    const plain = getCensusData('04101')
    const result = getCensusData('04101', 'portland', 'or')
    expect(result.isCityLevel).toBe(false)
    expect(result.medianIncome).toBe(plain.medianIncome)
  })

  test('city in another state is ignored (Beverly Hills zip with SF params)', () => {
    const result = getCensusData('98683', 'beverly hills', 'ca')
    expect(result.isCityLevel).toBe(false)
  })
})
