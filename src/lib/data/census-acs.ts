import censusData from './census-acs.json'
import censusPlaces from './census-places.json'
import type { CensusData } from '@/types'

const NATIONAL_FALLBACK: Omit<CensusData, 'zip' | 'year'> = {
  medianIncome: 74580,
  medianRent: 1271,
}

export function getCensusData(zip: string, city?: string, state?: string): CensusData {
  // Try city-level lookup first when city + state are provided
  if (city && state) {
    const placeKey = `${city.toLowerCase()}|${state.toLowerCase()}`
    const placeEntry = (censusPlaces as Record<string, { medianIncome: number; year: number }>)[placeKey]
    if (placeEntry && typeof placeEntry.medianIncome === 'number' && placeEntry.medianIncome > 0) {
      // Use zip-level rent if available, otherwise national fallback
      const zipEntry = (censusData as Record<string, any>)[zip]
      const medianRent = zipEntry?.medianRent ?? NATIONAL_FALLBACK.medianRent
      const isRentFallback = !zipEntry
      return {
        zip,
        medianIncome: placeEntry.medianIncome,
        medianRent,
        year: placeEntry.year,
        isFallback: false,
        isRentFallback,
        isCityLevel: true,
        cityName: city,
      }
    }
  }

  // Fall back to zip-level lookup
  const entry = (censusData as Record<string, any>)[zip]
  if (entry) {
    return { zip, ...entry, isFallback: false, isRentFallback: false, isCityLevel: false }
  }

  // National fallback
  return { zip, year: 2023, ...NATIONAL_FALLBACK, isFallback: true, isRentFallback: true, isCityLevel: false }
}
