import censusData from './census-acs.json'
import type { CensusData } from '@/types'

const NATIONAL_FALLBACK: Omit<CensusData, 'zip' | 'year'> = {
  medianIncome: 74580,
  medianRent: 1271,
}

export function getCensusData(zip: string): CensusData {
  const entry = (censusData as Record<string, any>)[zip]
  if (entry) {
    return { zip, ...entry }
  }
  return { zip, year: 2023, ...NATIONAL_FALLBACK }
}
