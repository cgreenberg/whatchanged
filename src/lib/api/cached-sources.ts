// Cached accessors for each upstream data source. These are the ONLY paths
// that should call BLS/EIA at runtime: the snapshot and national data (OG
// image) go through here, and scripts/refresh-cache.ts writes the very same
// keys (via the *CacheKey helpers + TTLs below) so a runtime request is
// normally a cache hit. Runtime misses are charged to the daily upstream
// budget in kv.ts.

import { getCachedOrFetch, TTL_BLS, TTL_EIA, type CachedResult } from '@/lib/cache/kv'
import type { CpiData } from '@/types'
import { fetchCpiArea, cpiCacheKey, NATIONAL_CPI_AREA } from './bls-cpi'
import { fetchLookupSeries, describeDuoarea, type GasLookupResult, type GasSeriesData } from './eia'
import { BLS_NATIONAL_GAS_LOOKUP } from './bls-gas'
import { isValidCpi, isValidGasSeries, isValidElectricity } from './validate'
import {
  electricityCacheKey,
  fetchElectricitySeries,
  NATIONAL_ELECTRICITY,
  type ElectricitySeriesData,
} from './eia-electricity'

/** Runtime TTLs (longer than the refresh interval; see kv.ts). */
export const CPI_TTL = TTL_BLS
export const GAS_TTL = TTL_EIA
/** BLS monthly gas tiers (bls:gas:{area}) use the BLS TTL. */
export const BLS_GAS_TTL = TTL_BLS

/** Cache TTL for a gas lookup's own source. */
export function gasTtlFor(lookup: GasLookupResult): number {
  return lookup.source === 'bls' ? BLS_GAS_TTL : GAS_TTL
}

export interface FetchOpts {
  forceRefresh?: boolean
}

export type CpiArea = { areaCode: string; areaName: string; tier: 1 | 2 | 3 | 4 }

export const NATIONAL_CPI: CpiArea = { areaCode: NATIONAL_CPI_AREA, areaName: 'National', tier: 4 }

export function getCpiCached(area: CpiArea, opts: FetchOpts = {}): Promise<CachedResult<CpiData>> {
  return getCachedOrFetch(cpiCacheKey(area.areaCode), CPI_TTL, () => fetchCpiArea(area), {
    validate: isValidCpi,
    forceRefresh: opts.forceRefresh,
    budget: 'bls',
  })
}

export function getGasSeriesCached(lookup: GasLookupResult, opts: FetchOpts = {}): Promise<CachedResult<GasSeriesData>> {
  return getCachedOrFetch(lookup.cacheKey, gasTtlFor(lookup), () => fetchLookupSeries(lookup), {
    validate: isValidGasSeries,
    forceRefresh: opts.forceRefresh,
    budget: lookup.source === 'bls' ? 'bls' : 'eia',
  })
}

/** EIA U.S. average (NUS): national comparison/fallback for EIA tiers, and the OG national card. */
export const NATIONAL_GAS_LOOKUP = describeDuoarea('NUS')
export { BLS_NATIONAL_GAS_LOOKUP }

/** National gas lookup from the SAME source as `lookup` (BLS tiers → APU000074714, EIA → NUS). */
export function nationalGasLookupFor(lookup: Pick<GasLookupResult, 'source'>): GasLookupResult {
  return lookup.source === 'bls' ? BLS_NATIONAL_GAS_LOOKUP : NATIONAL_GAS_LOOKUP
}

export function getNationalGasCached(opts: FetchOpts = {}): Promise<CachedResult<GasSeriesData>> {
  return getGasSeriesCached(NATIONAL_GAS_LOOKUP, opts)
}

/** EIA residential electricity (monthly) uses the EIA TTL. */
export const ELECTRICITY_TTL = TTL_EIA

/** One state's (or 'US') residential electricity series: eia:electricity:{ST}. */
export function getElectricityCached(state: string, opts: FetchOpts = {}): Promise<CachedResult<ElectricitySeriesData>> {
  return getCachedOrFetch(electricityCacheKey(state), ELECTRICITY_TTL, () => fetchElectricitySeries(state), {
    validate: isValidElectricity,
    forceRefresh: opts.forceRefresh,
    budget: 'eia',
  })
}

/** Shared U.S. average key (eia:electricity:US): national comparison for every state. */
export function getNationalElectricityCached(opts: FetchOpts = {}): Promise<CachedResult<ElectricitySeriesData>> {
  return getElectricityCached(NATIONAL_ELECTRICITY, opts)
}

/** Resolve a promise to its value, or null on rejection (logging the error). */
export async function settle<T>(p: Promise<T>, label: string): Promise<T | null> {
  try {
    return await p
  } catch (e) {
    console.error(`[${label}] unavailable:`, e instanceof Error ? e.message : e)
    return null
  }
}
