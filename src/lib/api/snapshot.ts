import { lookupZip } from '@/lib/data/zip-lookup'
import { getCensusData } from '@/lib/data/census-acs'
import { safelyFetch } from './sources'
import { getCachedOrFetch } from '@/lib/cache/kv'
import type {
  EconomicSnapshot,
  DataResult,
  CensusData,
  TariffData,
  CacheStatus,
  UnemploymentData,
  CpiData,
  GasPriceData,
  FederalFundingData,
} from '@/types'
import { estimateTariffCost } from '@/lib/tariff'
import censusJson from '@/lib/data/census-acs.json'
import { blsSource, blsCpiSource, eiaSource, usaSpendingSource } from './source-registry'
import { getGasLookup } from './eia'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'

const TTL_7_DAYS = 604800
const TTL_24_HOURS = 86400

export async function fetchSnapshot(zip: string): Promise<EconomicSnapshot | null> {
  const location = lookupZip(zip)
  if (!location) return null

  const fetchedAt = new Date().toISOString()

  // Compute per-source cache keys
  const { areaCode: cpiAreaCode } = getMetroCpiAreaForCounty(location.countyFips, location.stateAbbr)
  const gasLookup = getGasLookup(location.stateAbbr, cpiAreaCode, location.countyFips)

  const unemploymentKey = `bls:unemployment:${location.countyFips}`
  const cpiKey = `bls:cpi:${cpiAreaCode}:all`
  const gasKey = gasLookup.cacheKey
  const federalKey = `usaspending:cuts:${location.countyFips}`

  // Fetch all 4 external sources in parallel, each with per-source caching
  const [unemploymentResult, cpiResult, gasResult, federalResult] = await Promise.all([
    getCachedOrFetch<UnemploymentData>(
      unemploymentKey, TTL_7_DAYS,
      async () => {
        const result = await safelyFetch(blsSource, [location.countyFips])
        if (result.data === null) throw new Error(result.error ?? 'fetch failed')
        return result.data
      }
    ).catch(() => ({ data: null as UnemploymentData | null, cacheHit: false })),

    getCachedOrFetch<CpiData>(
      cpiKey, TTL_7_DAYS,
      async () => {
        const result = await safelyFetch(blsCpiSource, [location.countyFips, location.stateAbbr])
        if (result.data === null) throw new Error(result.error ?? 'fetch failed')
        return result.data
      },
      300,
      // Invalidate stale cache entries missing shelterChange field
      (cached) => cached.shelterChange !== undefined
    ).catch(() => ({ data: null as CpiData | null, cacheHit: false })),

    getCachedOrFetch<GasPriceData>(
      gasKey, TTL_24_HOURS,
      async () => {
        const result = await safelyFetch(eiaSource, [location.stateAbbr, cpiAreaCode, location.countyFips])
        if (result.data === null) throw new Error(result.error ?? 'fetch failed')
        return result.data
      },
      300,
      // Reject cached gas data where the latest series entry is stale (>10 days old).
      // EIA releases weekly; if somehow a stale entry survives TTL, this catches it.
      (cached) => {
        if (!cached.series?.length) return false
        const latest = cached.series[cached.series.length - 1].date
        return Date.now() - new Date(latest).getTime() < 10 * 24 * 60 * 60 * 1000
      }
    ).catch(() => ({ data: null as GasPriceData | null, cacheHit: false })),

    getCachedOrFetch<FederalFundingData>(
      federalKey, TTL_24_HOURS,
      async () => {
        const result = await safelyFetch(usaSpendingSource, [location.countyFips, location.stateAbbr])
        if (result.data === null) throw new Error(result.error ?? 'fetch failed')
        return result.data
      }
    ).catch(() => ({ data: null as FederalFundingData | null, cacheHit: false })),
  ])

  // Build DataResult wrappers
  const unemployment: DataResult<UnemploymentData> = {
    data: unemploymentResult.data,
    error: unemploymentResult.data ? null : 'Data unavailable',
    fetchedAt,
    sourceId: 'bls-laus',
  }

  const cpi: DataResult<CpiData> = {
    data: cpiResult.data,
    error: cpiResult.data ? null : 'Data unavailable',
    fetchedAt,
    sourceId: 'bls-cpi',
  }

  const gas: DataResult<GasPriceData> = {
    data: gasResult.data,
    error: gasResult.data ? null : 'Data unavailable',
    fetchedAt,
    sourceId: 'eia-gas',
  }

  const federal: DataResult<FederalFundingData> = {
    data: federalResult.data,
    error: federalResult.data ? null : 'Data unavailable',
    fetchedAt,
    sourceId: 'usaspending',
  }

  // Census is synchronous (bundled static data)
  const censusIsFallback = !((censusJson as Record<string, any>)[zip])
  const censusData = getCensusData(zip)
  const census: DataResult<CensusData> = {
    data: censusData,
    error: censusData ? null : 'Census data unavailable for this zip',
    fetchedAt,
    sourceId: 'census-acs',
  }

  // Tariff estimate (derived from Census income + Yale Budget Lab rate)
  const tariffData: TariffData | null = censusData ? {
    medianIncome: censusData.medianIncome,
    tariffRate: 0.0205,
    estimatedCost: estimateTariffCost(censusData.medianIncome),
    source: 'Yale Budget Lab',
    incomeSource: censusIsFallback ? 'national-average' : `census-acs-${censusData.year}`,
    isFallback: censusIsFallback,
  } : null

  const tariff: DataResult<TariffData> = {
    data: tariffData,
    error: tariffData ? null : 'Tariff estimate unavailable',
    fetchedAt,
    sourceId: 'yale-budget-lab',
  }

  // Build cache status
  const cacheStatus: CacheStatus = {
    unemployment: unemploymentResult.cacheHit ? 'hit' : 'miss',
    cpi: cpiResult.cacheHit ? 'hit' : 'miss',
    gas: gasResult.cacheHit ? 'hit' : 'miss',
    federal: federalResult.cacheHit ? 'hit' : 'miss',
    census: 'hit',
  }

  return {
    zip,
    location,
    unemployment,
    cpi,
    gas,
    federal,
    census,
    tariff,
    fetchedAt,
    cacheStatus,
  }
}
