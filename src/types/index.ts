import type { DollarImpact } from '@/lib/compute/dollar-translations'
import type { ElectricitySeriesData, ElectricityPoint } from '@/lib/api/eia-electricity'
import type { SnapshotTrace } from '@/lib/resolution/types'

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

export interface CpiPoint {
  date: string
  /** null for a month where this area's groceries series has no value (another item does). */
  groceries: number | null
  shelter: number | null
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
  /**
   * BLS CPI "Rent of primary residence" (CUUR{area}SEHA) % change since its own baseline month. Used only
   * for the shelter card's dollar figure (local median rent × 12 × this %). Omitted when the series has no
   * usable baseline/latest value, and absent on payloads cached before it was fetched: no dollar figure then.
   */
  rentIndexChange?: number
  rentIndexCurrent?: number
  rentIndexBaseline?: number
  rentIndexBaselinePeriod?: string
  rentIndexLatestPeriod?: string
  series: CpiPoint[]
  metro: string
  tier: 1 | 2 | 3 | 4
  areaCode?: string
  /** `rent` (CUUR{area}SEHA) is absent on payloads cached before the rent index was fetched. */
  seriesIds?: { groceries: string; shelter: string; rent?: string }
  nationalSeries?: CpiPoint[]
  /** 'national' when the local CPI area failed and national CPI is shown instead (shelter $ impact is then null). */
  fallback?: 'national'
  /**
   * Items whose own latest month is stale (or all items when a last-good copy is served).
   * Set per snapshot, not cached; absent on older payloads (then `cpi.stale` applies to every item).
   */
  staleItems?: Array<'groceries' | 'shelter'>
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
  /**
   * Outage stand-ins (not the area's native series): 'national' = the local series failed and the
   * national average is shown; 'eia' = the zip's BLS monthly series failed and its EIA weekly tier
   * (state / PADD) is shown instead, local and national both from EIA.
   */
  fallback?: 'national' | 'eia'
  geoLevel?: string
  /**
   * Static sources (bundled by the data pipeline) for places EIA and BLS don't price:
   * 'dcra' = Alaska DCRA Community Fuel Price Survey (twice yearly; dates YYYY-01 / YYYY-07),
   * 'daco' = Puerto Rico DACO monthly island-wide average. Neither has a U.S. comparison from the same source.
   */
  staticSource?: { kind: 'dcra' | 'daco'; match?: 'community' | 'nearest' | 'region'; place: string; km?: number }
  /**
   * 'eia' = EIA weekly retail regular gasoline (dates YYYY-MM-DD, baseline = last week ≤ Jan 20 2025);
   * 'bls' = BLS CPI average price, regular gasoline (monthly, dates YYYY-MM, baseline = Jan 2025).
   * Absent on older payloads = 'eia'. Series, baseline and nationalSeries always come from this one source.
   */
  source?: 'eia' | 'bls' | 'dcra' | 'daco'
  /** Absent on older payloads = 'weekly'. 'semiannual' = DCRA's January and July surveys. */
  frequency?: 'weekly' | 'monthly' | 'semiannual'
  /** Upstream series id (EMM_EPMR_PTE_{duoarea}_DPG, APU{area}74714, or a static source's own label). */
  seriesId?: string
  duoarea?: string  // EIA area code used for the API query (EIA only)
  /** BLS CPI area code (BLS only), e.g. "S12B", "S49F". */
  blsArea?: string
  /** BLS area name (BLS only), e.g. "Philadelphia-Camden-Wilmington", "Honolulu". */
  areaName?: string
  /**
   * HI / AK zip outside the Honolulu / Anchorage CBSA: no EIA or BLS series covers it, so that
   * metro's series stands in ("Honolulu-area price"); local prices are typically higher and may have changed differently.
   */
  standIn?: boolean
  tier?: 1 | 2 | 3
  /** BLS monthly only: months (YYYY-MM) inside the series BLS did not publish; charted as gaps. */
  unpublished?: string[]
}

/** Census ACS median gross rent for the zip (bundled JSON): the base of the shelter card's dollar figure. */
export interface CensusData {
  /** Local median gross rent, or the U.S. median when isRentFallback (never used for a dollar figure then). */
  medianRent: number
  zip: string
  /** ACS 5-year end year of the rent figure. */
  year: number
  /** Same value as medianRent. */
  rent?: number
  /** 'acs' = Census ACS (zip or donor zip); 'national' = no local rent figure. */
  source?: 'acs' | 'national'
  /** USPS-only zip: ACS values borrowed from this residential zip. */
  donorZip?: string
  /** How donorZip was chosen: largest residential zip in the same city ('city') or most populous in the county ('county'). */
  donorScope?: 'city' | 'county'
  /** Human-readable provenance, e.g. "Census ACS 2023 5-year, zip 98683". */
  sourceLabel?: string
  isFallback?: boolean
  isRentFallback?: boolean
  /** Set for USPS-only zips (no ZCTA): ACS values borrowed from this residential zip (an estimate). */
  approxFromZip?: string
}

/**
 * EIA average residential electricity price for the zip's state (statewide), with the U.S. average
 * over the same months. `change` is the seasonally adjusted % change since Jan 2025.
 */
export interface ElectricityData extends ElectricitySeriesData {
  /** U.S. average series (same method) for the graph's "Show national". */
  nationalSeries?: ElectricityPoint[]
  /** U.S. seasonally adjusted % change over the same months as the local figure. */
  nationalChange?: number
  nationalLatestPeriod?: string
}

/**
 * Asking rent on new leases (Zillow ZORI): the county (src/lib/data/county-rent.json) or, where Zillow has no
 * county series, the county's metro (src/lib/data/metro-rent.json; OMB March 2020 CBSA, as Zillow uses).
 */
export interface RentData {
  /** 'metro' = the county's metro-area series (absent on older payloads = 'county'). */
  level?: 'county' | 'metro'
  /** Metro rows: OMB CBSA code and the county the zip is in (the metro series stands in for it). */
  cbsa?: string
  countyName?: string
  /** Metro rows: why the county's own series isn't used ('none' = Zillow publishes none; 'too-new' = too short;
   * 'no-baseline' = it has no Jan 2025 value). */
  countyWhy?: 'none' | 'too-new' | 'no-baseline'
  /**
   * The series is too short to estimate its own seasonal pattern, so it is adjusted with this pool's typical
   * pattern ("Maine counties", "U.S. counties").
   */
  saPool?: string
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
  geoName: string // e.g. "Travis County, TX", or "Portland-South Portland, ME metro"
  source: string
  sourceUrl: string
  adjustment: string
  /** Statistical outlier among U.S. counties (build-time robust z-score); shown with an "unusual value" caveat. */
  flagged?: boolean
  /** Documented explanation for an unusual county rent figure. */
  note?: string
}

export interface CacheStatus {
  cpi: 'hit' | 'miss' | 'stale' | 'error'
  gas: 'hit' | 'miss' | 'stale' | 'error'
  electricity?: 'hit' | 'miss' | 'stale' | 'error'
  census: 'hit' | 'miss'
}

export interface EconomicSnapshot {
  zip: string
  location: ZipInfo
  cpi: DataResult<CpiData>
  gas: DataResult<GasPriceData>
  census: DataResult<CensusData>
  /** Statewide EIA residential electricity price (data null for territories: EIA publishes none). */
  electricity: DataResult<ElectricityData>
  /** Zillow rent: county, else metro (null when neither has a seasonally adjusted series back to Jan 2025). */
  rent?: RentData | null
  /**
   * Home heating fuel (Home heating graph; not a hero card): weekly residential heating oil and propane.
   * Absent on older payloads; a product is null where no source publishes it for the place.
   */
  heating?: { oil: DataResult<HeatingFuelData> | null; propane: DataResult<HeatingFuelData> | null }
  dollarImpact?: DollarImpact
  fetchedAt: string
  cacheStatus?: CacheStatus
  /**
   * How each metric's number was chosen: one step per rung of its ladder (src/lib/resolution/ladders.ts),
   * most local first, with ✓ used / ✗ unavailable / – not needed outcomes. Absent on older payloads.
   */
  trace?: SnapshotTrace
}

/** One weekly residential heating-fuel series (EIA SHOPP state average or NYSERDA New York region). */
export interface HeatingFuelData {
  product: 'oil' | 'propane'
  source: 'eia' | 'nyserda'
  /** EIA series id (W_EPD2F_PRS_SME_DPG) or the NYSERDA column (lower_hudson_average_gal). */
  seriesId: string
  /** "Maine (statewide)", "Upper Hudson region". */
  geography: string
  current: number
  latestDate: string // YYYY-MM-DD
  baseline: number
  baselineDate: string // last reading on or before 2025-01-20
  change: number // % change since baseline
  series: Array<{ date: string; price: number }>
  /** Same source, same weeks: EIA U.S. average (SHOPP) or NYSERDA statewide average. */
  nationalSeries?: Array<{ date: string; price: number }>
  nationalLabel?: string
  /** Heating-season survey (EIA SHOPP, Oct–Mar) that is between seasons: the honest off-season note. */
  offSeasonNote?: string
}
