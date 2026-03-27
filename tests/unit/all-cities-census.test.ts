import { getCensusData } from '@/lib/data/census-acs'
import { CITY_ZIP_LOOKUP } from '@/lib/data/city-zip-lookup'
import censusPlaces from '@/lib/data/census-places.json'

const NATIONAL_FALLBACK_INCOME = 74580

describe('city-level income — all 50 metros', () => {
  test.each(CITY_ZIP_LOOKUP)(
    '$display uses city proper income, not zip income',
    ({ zip, city, state }) => {
      const result = getCensusData(zip, city, state)

      expect(result.isCityLevel).toBe(true)
      expect(result.medianIncome).toBeGreaterThan(0)
      expect(result.medianIncome).not.toBe(NATIONAL_FALLBACK_INCOME)

      const placeKey = `${city.toLowerCase()}|${state.toLowerCase()}`
      const expected = (censusPlaces as Record<string, { medianIncome: number; year: number }>)[placeKey]
      expect(expected).toBeDefined()
      expect(result.medianIncome).toBe(expected.medianIncome)
    }
  )

  test('all 50 cities in lookup have a census-places.json entry', () => {
    const placeKeys = Object.keys(censusPlaces)
    expect(placeKeys).toHaveLength(50)

    for (const { city, state } of CITY_ZIP_LOOKUP) {
      const placeKey = `${city.toLowerCase()}|${state.toLowerCase()}`
      expect(placeKeys).toContain(placeKey)
    }
  })
})
