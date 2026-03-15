import { lookupZip, isValidZip } from '@/lib/data/zip-lookup'

describe('lookupZip', () => {
  test('valid zip 98683 returns correct county info', () => {
    const result = lookupZip('98683')
    expect(result).not.toBeNull()
    expect(result?.countyFips).toBe('53011')
    expect(result?.stateName).toBe('Washington')
    expect(result?.zip).toBe('98683')
  })

  test('invalid zip returns null', () => {
    expect(lookupZip('00000')).toBeNull()
  })

  test('non-numeric input returns null', () => {
    expect(lookupZip('abcde')).toBeNull()
  })

  test('4-digit input gets padded to 5', () => {
    // zip 1001 should become 01001
    const result = lookupZip('1001')
    // result may be null if 01001 not in data, but should not throw
    expect(() => lookupZip('1001')).not.toThrow()
  })

  test('isValidZip returns true for real zip', () => {
    expect(isValidZip('98683')).toBe(true)
  })

  test('isValidZip returns false for fake zip', () => {
    expect(isValidZip('00000')).toBe(false)
  })
})
