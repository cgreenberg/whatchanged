import { lookupZip } from '@/lib/data/zip-lookup'
import { getCensusData } from '@/lib/data/census-acs'
import type { CachedResult } from '@/lib/cache/kv'
import type {
  EconomicSnapshot,
  DataResult,
  CensusData,
  TariffData,
  CacheStatus,
  UnemploymentData,
  CpiData,
  GasPriceData,
} from '@/types'
import { estimateTariffCost } from '@/lib/tariff'
import { getCountyRent } from '@/lib/rent'
import { computeDollarImpact } from '@/lib/compute/dollar-translations'
import { getGasLookup, isGasStale, toGasPriceData } from './eia'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import { resolveLausArea } from '@/lib/mappings/laus-area'
import { NATIONAL_CPI_AREA } from './bls-cpi'
import { monthOlderThan } from '@/lib/hero-cards'
import {
  getUnemploymentCached,
  getCpiCached,
  getGasSeriesCached,
  getNationalGasCached,
  NATIONAL_CPI,
  NATIONAL_GAS_LOOKUP,
  settle,
} from './cached-sources'

/**
 * BLS data whose latest month ended more than this many days ago is shown with the stale badge.
 * Normal lag at its worst (just before the next release) is ~45 days for CPI and ~62 for county
 * LAUS, so 75 days means at least one monthly release was missed (refresh stuck, or BLS stopped).
 */
export const BLS_STALE_DAYS = 75

/** true when a YYYY-MM BLS period ended more than BLS_STALE_DAYS before `now`. Unknown period → false. */
export function isBlsPeriodStale(period: string | null | undefined, now: Date = new Date()): boolean {
  return monthOlderThan(period?.slice(0, 7), BLS_STALE_DAYS, now)
}

export interface SnapshotOptions {
  /** Bypass cache reads and refetch every upstream source (still charged to the upstream budget). */
  forceRefresh?: boolean
}

function cacheStatusOf(r: CachedResult<unknown> | null): 'hit' | 'miss' | 'stale' | 'error' {
  if (!r) return 'error'
  if (r.stale) return 'stale'
  return r.cacheHit ? 'hit' : 'miss'
}

function wrap<T>(
  data: T | null,
  sourceId: string,
  fetchedAt: string | undefined,
  now: string,
  stale = false
): DataResult<T> {
  return {
    data,
    error: data ? null : 'Data unavailable',
    fetchedAt: fetchedAt ?? now,
    sourceId,
    ...(data && stale ? { stale: true } : {}),
  }
}

export async function fetchSnapshot(
  zip: string,
  city?: string,
  state?: string,
  options: SnapshotOptions = {}
): Promise<EconomicSnapshot | null> {
  const location = lookupZip(zip)
  if (!location) return null

  const now = new Date().toISOString()
  const opts = { forceRefresh: options.forceRefresh }

  const cpiArea = getMetroCpiAreaForCounty(location.countyFips, location.stateAbbr)
  const gasLookup = getGasLookup(location.stateAbbr, cpiArea.areaCode, location.countyFips)
  const gasIsNational = gasLookup.duoarea === 'NUS'
  // LAUS area by zip: CT zips resolve to their 2022 planning region, others to the county.
  const lausArea = resolveLausArea(zip, location.countyFips)

  // Fetch all external sources in parallel, each through its own cache key.
  // National gas is a single shared key (used for the overlay and as fallback).
  const [unemploymentResult, cpiPrimary, gasPrimary, gasNational] = await Promise.all([
    settle(getUnemploymentCached(lausArea.fips, opts), 'bls-laus'),
    settle(getCpiCached(cpiArea, opts), 'bls-cpi'),
    settle(getGasSeriesCached(gasLookup, opts), 'eia-gas'),
    gasIsNational ? Promise.resolve(null) : settle(getNationalGasCached(opts), 'eia-gas-national'),
  ])

  // CPI: if the local area failed, fall back to the shared national CPI key
  // (labeled national, tier 4, fallback: 'national').
  let cpiResult: CachedResult<CpiData> | null = cpiPrimary
  let cpiIsNationalFallback = false
  if (!cpiResult && cpiArea.areaCode !== NATIONAL_CPI_AREA) {
    cpiResult = await settle(getCpiCached(NATIONAL_CPI), 'bls-cpi-national')
    cpiIsNationalFallback = !!cpiResult
  }

  // Gas: primary series + shared national overlay; national fallback is composed
  // here and never written under the primary cache key.
  let gasData: GasPriceData | null = null
  let gasMeta: CachedResult<unknown> | null = null
  if (gasPrimary) {
    gasData = toGasPriceData(gasLookup, gasPrimary.data, {
      nationalSeries: gasIsNational ? undefined : gasNational?.data.series,
    })
    gasMeta = gasPrimary
  } else if (gasNational) {
    gasData = { ...toGasPriceData(NATIONAL_GAS_LOOKUP, gasNational.data, { isNationalFallback: true }), fallback: 'national' }
    gasMeta = gasNational
  }
  const gasStale = !!gasData && (!!gasMeta?.stale || isGasStale(gasData.latestDate ?? ''))

  // Area name is re-attached here so older cache entries (without it) still label correctly.
  const unemploymentData: UnemploymentData | null = unemploymentResult?.data
    ? {
        ...unemploymentResult.data,
        lausFips: lausArea.fips,
        ...(lausArea.name ? { lausAreaName: lausArea.name } : {}),
      }
    : null
  const nowDate = new Date(now)
  const lausLatest = unemploymentData?.latestPeriod ?? unemploymentData?.series?.[unemploymentData.series.length - 1]?.date
  const unemployment: DataResult<UnemploymentData> = wrap(
    unemploymentData, 'bls-laus', unemploymentResult?.fetchedAt, now,
    !!unemploymentResult?.stale || isBlsPeriodStale(lausLatest, nowDate),
  )
  const cpiBase: CpiData | null = cpiResult?.data
    ? cpiIsNationalFallback
      ? { ...cpiResult.data, fallback: 'national' }
      : cpiResult.data
    : null
  // Per-item staleness: each item from its OWN latest month (a lagging series, e.g. Phoenix food at
  // home, gets the badge even when shelter is current). A last-good copy marks every item stale.
  const cpiStaleItems = cpiBase
    ? (['groceries', 'shelter', 'energy'] as const).filter((item) => {
        if (cpiResult?.stale) return true
        const latest = item === 'groceries'
          ? cpiBase.groceriesLatestPeriod
          : item === 'shelter'
            ? cpiBase.shelterLatestPeriod
            : [...(cpiBase.series ?? [])].reverse().find((p) => typeof p.energy === 'number')?.date
        return isBlsPeriodStale(latest, nowDate)
      })
    : []
  const cpiData: CpiData | null = cpiBase ? { ...cpiBase, staleItems: [...cpiStaleItems] } : null
  const cpi: DataResult<CpiData> = wrap(cpiData, 'bls-cpi', cpiResult?.fetchedAt, now, cpiStaleItems.length > 0)
  const gas: DataResult<GasPriceData> = wrap(gasData, 'eia-gas', gasMeta?.fetchedAt, now, gasStale)

  // Census is synchronous (bundled static data)
  const censusData = getCensusData(zip, city, state)
  const censusIsFallback = censusData.isFallback === true
  const censusIsCounty = censusData.incomeGeo === 'county'
  const census: DataResult<CensusData> = {
    data: censusData,
    error: censusData ? null : 'Census data unavailable for this zip',
    fetchedAt: now,
    sourceId: 'census-acs',
  }

  // Tariff estimate (derived from Census income + Yale Budget Lab rate)
  const yearSuffix = typeof censusData?.year === 'number' ? `-${censusData.year}` : ''
  const tariffData: TariffData | null = censusData ? {
    medianIncome: censusData.medianIncome,
    tariffRate: 0.0205,
    estimatedCost: estimateTariffCost(censusData.medianIncome),
    source: 'Yale Budget Lab',
    incomeSource: censusIsFallback
      ? `national-census-cps${yearSuffix}`
      : censusData.isCityLevel
        ? `city-proper-census-acs${yearSuffix}`
        : censusIsCounty
          ? `county-census-acs${yearSuffix}`
          : `census-acs${yearSuffix}`,
    isFallback: censusIsFallback,
  } : null

  const tariff: DataResult<TariffData> = {
    data: tariffData,
    error: tariffData ? null : 'Tariff estimate unavailable',
    fetchedAt: now,
    sourceId: 'yale-budget-lab',
  }

  // Dollar impact (centralized computation for hero cards).
  // Shelter uses LOCAL rent × LOCAL shelter CPI only: no national fallback rent,
  // and no national CPI % applied to local rent (national CPI fallback, or a territory whose only
  // CPI is national, e.g. Puerto Rico → null).
  const cpiIsNational = cpiIsNationalFallback || cpiArea.areaCode === NATIONAL_CPI_AREA
  const localRent = censusData && !censusData.isFallback && !censusData.isRentFallback && !cpiIsNational
    ? censusData.medianRent
    : null
  const dollarImpact = computeDollarImpact({
    groceriesChangePct: cpi.data?.groceriesChange,
    shelterChangePct: cpi.data?.shelterChange,
    gasChange: gas.data?.change,
    tariffEstimatedCost: tariffData?.estimatedCost,
    medianRent: localRent,
  })

  // County rent on new leases (bundled Zillow data, keyed by the zip's county)
  const rent = getCountyRent(location.countyFips)

  const cacheStatus: CacheStatus = {
    unemployment: cacheStatusOf(unemploymentResult),
    cpi: cacheStatusOf(cpiResult),
    gas: cacheStatusOf(gasMeta),
    census: 'hit',
  }

  return {
    zip,
    location,
    unemployment,
    cpi,
    gas,
    census,
    tariff,
    rent,
    dollarImpact,
    fetchedAt: now,
    cacheStatus,
  }
}
