import { lookupZip } from '@/lib/data/zip-lookup'
import { getCensusData } from '@/lib/data/census-acs'
import { safelyFetch } from './sources'
import type { EconomicSnapshot, DataResult, CensusData } from '@/types'
import { blsSource, blsCpiSource, eiaSource, usaSpendingSource } from './source-registry'

export async function fetchSnapshot(zip: string): Promise<EconomicSnapshot | null> {
  const location = lookupZip(zip)
  if (!location) return null

  const fetchedAt = new Date().toISOString()

  // Run all external fetches in parallel
  const [unemployment, cpi, gas, federal] = await Promise.all([
    safelyFetch(blsSource, [location.countyFips]),
    safelyFetch(blsCpiSource, []),
    safelyFetch(eiaSource, [location.stateAbbr]),
    safelyFetch(usaSpendingSource, [location.countyFips, location.stateAbbr]),
  ])

  // Census is synchronous (bundled static data)
  const censusData = getCensusData(zip)
  const census: DataResult<CensusData> = {
    data: censusData,
    error: null,
    fetchedAt,
    sourceId: 'census-acs',
  }

  return {
    zip,
    location,
    unemployment,
    cpi,
    gas,
    federal,
    census,
    fetchedAt,
  }
}
