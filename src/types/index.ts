import type { DollarImpact } from '@/lib/compute/dollar-translations'

export interface ZipInfo {
  zip: string
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
}

export interface DataResult<T> {
  data: T | null
  error: string | null
  fetchedAt: string // ISO date string
  sourceId: string
  /** true when a last-good copy is served because the live fetch failed, or gas data is >10 days old */
  stale?: boolean
}

export interface UnemploymentPoint {
  date: string // YYYY-MM format
  rate: number
  /** BLS footnote code "P": preliminary month, revised in the next release. */
  preliminary?: true
}

export interface UnemploymentData {
  current: number
  latestPeriod?: string // YYYY-MM of `current`
  /** true when the latest month (`current`) is a BLS preliminary estimate. */
  latestPreliminary?: boolean
  baseline: number | null // Jan 2025 value (null if BLS has no Jan 2025 value)
  baselinePeriod?: string | null // YYYY-MM of `baseline`
  /**
   * current - baseline (percentage points, NOT seasonally adjusted, Jan 2025 vs latest
   * month, latest may be preliminary); null when baseline missing. Not the page headline.
   */
  change: number | null
  series: UnemploymentPoint[]
  countyFips: string
  /** LAUS area FIPS actually published by BLS (CT: 2022 planning region 09110–09190). */
  lausFips?: string
  /** LAUS area display name when it differs from the county (CT planning regions). */
  lausAreaName?: string
  seriesId?: string
  nationalSeriesId?: string // LNU04000000 (NSA, matches county LAUS)
  nationalSeries?: UnemploymentPoint[]
}

export interface CpiPoint {
  date: string
  /** null for a month where this area's groceries series has no value (another item does). */
  groceries: number | null
  shelter: number | null
  energy: number | null
  /** true when any item value at this date is a BLS preliminary estimate. */
  preliminary?: true
}

export interface CpiData {
  groceriesCurrent: number
  groceriesBaseline: number
  groceriesChange: number // % change, latest vs baseline
  groceriesBaselinePeriod?: string // YYYY-MM (2025-01, or 2024-12 for areas without a Jan release)
  groceriesLatestPeriod?: string // YYYY-MM
  /** Omitted when the shelter series has no usable baseline/latest value. */
  shelterChange?: number
  shelterCurrent?: number
  shelterBaseline?: number
  shelterBaselinePeriod?: string
  shelterLatestPeriod?: string
  series: CpiPoint[]
  metro: string
  tier: 1 | 2 | 3 | 4
  areaCode?: string
  seriesIds?: { groceries: string; shelter: string; energy: string }
  nationalSeries?: CpiPoint[]
  /** 'national' when the local CPI area failed and national CPI is shown instead (shelter $ impact is then null). */
  fallback?: 'national'
  /**
   * Items whose own latest month is stale (or all items when a last-good copy is served).
   * Set per snapshot, not cached; absent on older payloads (then `cpi.stale` applies to every item).
   */
  staleItems?: Array<'groceries' | 'shelter' | 'energy'>
}

export interface GasPriceData {
  current: number
  baseline: number
  change: number
  baselineDate?: string // YYYY-MM-DD of the weekly reading used as baseline (≤ 2025-01-20)
  latestDate?: string // YYYY-MM-DD of `current`
  region: string
  series: Array<{ date: string; price: number }>
  nationalSeries?: Array<{ date: string; price: number }>
  isNationalFallback?: boolean
  /** 'national' when the local gas series failed and the national average is shown instead (an outage, not the area's native series). */
  fallback?: 'national'
  geoLevel?: string
  duoarea?: string  // EIA area code used for the API query
  tier?: 1 | 2 | 3
}

export interface CensusData {
  medianIncome: number
  medianRent: number
  zip: string
  /** Data year of `income`: ACS 5-year end year (e.g. 2023), or 2022 for the national CPS fallback. */
  year: number
  /** Median household income used for this zip (same value as medianIncome). */
  income?: number
  /** Median gross rent shown for this zip (same value as medianRent; national when isRentFallback). */
  rent?: number
  /** 'acs' = Census ACS (zip, city, donor zip or county); 'national' = U.S. median (Census CPS ASEC 2022). */
  source?: 'acs' | 'national'
  /** Geography of `income`. 'zip' with donorZip set = borrowed from another zip. */
  incomeGeo?: 'city' | 'zip' | 'county' | 'national'
  /** County/planning-region FIPS whose ACS median is used when incomeGeo === 'county'. */
  incomeCountyFips?: string
  /** USPS-only zip: ACS values borrowed from this residential zip. */
  donorZip?: string
  /** How donorZip was chosen: largest residential zip in the same city ('city') or most populous in the county ('county'). */
  donorScope?: 'city' | 'county'
  /** Human-readable provenance, e.g. "Census ACS 2023 5-year, county median (Clark County, WA)". */
  sourceLabel?: string
  isFallback?: boolean
  isRentFallback?: boolean
  isCityLevel?: boolean
  cityName?: string
  /** Set for USPS-only zips (no ZCTA): ACS values borrowed from this residential zip (an estimate). */
  approxFromZip?: string
}

export interface TariffData {
  medianIncome: number
  tariffRate: number
  estimatedCost: number
  source: string
  incomeSource: string
  isFallback: boolean
}

/** County asking rent on new leases (Zillow ZORI), from src/lib/data/county-rent.json. */
export interface RentData {
  /** % change since the baseline month, seasonally adjusted by whatchanged. */
  pct: number
  /** Observed (not seasonally adjusted) typical asking rent in the baseline month, $/mo. */
  baseRent: number
  /** Observed typical asking rent in the latest month, $/mo. */
  curRent: number
  /** Signed $/mo change on a typical new lease consistent with `pct`: curRent − curRent / (1 + pct/100). */
  monthlyChange: number
  baseMonth: string // YYYY-MM
  asOf: string // YYYY-MM of curRent
  countyFips: string
  geoName: string // e.g. "Travis County, TX"
  source: string
  sourceUrl: string
  adjustment: string
  /** Statistical outlier among U.S. counties (build-time robust z-score); shown with an "unusual value" caveat. */
  flagged?: boolean
  /** Documented explanation for an unusual county rent figure. */
  note?: string
}

export interface CacheStatus {
  unemployment: 'hit' | 'miss' | 'stale' | 'error'
  cpi: 'hit' | 'miss' | 'stale' | 'error'
  gas: 'hit' | 'miss' | 'stale' | 'error'
  census: 'hit' | 'miss'
}

export interface EconomicSnapshot {
  zip: string
  location: ZipInfo
  unemployment: DataResult<UnemploymentData>
  cpi: DataResult<CpiData>
  gas: DataResult<GasPriceData>
  census: DataResult<CensusData>
  tariff: DataResult<TariffData>
  /** County Zillow rent (null when the zip's county has no seasonally adjusted rent series). */
  rent?: RentData | null
  dollarImpact?: DollarImpact
  fetchedAt: string
  cacheStatus?: CacheStatus
}
