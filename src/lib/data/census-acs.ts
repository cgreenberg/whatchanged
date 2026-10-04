import censusData from './census-acs.json'
import censusPlaces from './census-places.json'
import poBoxAcs from './po-box-acs.json'
import countyIncome from './county-income.json'
import { lookupZip } from './zip-lookup'
import { CITY_ZIP_LOOKUP } from './city-zip-lookup'
import { getLausAreaFipsForZip, getLausAreaName } from '@/lib/mappings/laus-area'
import { NATIONAL_MEDIAN_INCOME, NATIONAL_MEDIAN_RENT } from '@/lib/compute/dollar-translations'
import type { CensusData } from '@/types'

/**
 * Provenance of NATIONAL_MEDIAN_INCOME ($74,580): U.S. median household income
 * for 2022 from the Census Current Population Survey ASEC (report P60-279,
 * "Income in the United States: 2022") — NOT the ACS. Labeled as such.
 */
export const NATIONAL_INCOME_SOURCE_LABEL = 'U.S. median household income, Census CPS ASEC 2022'
export const NATIONAL_INCOME_YEAR = 2022

/** County median household income, ACS 5-year B19013 (scripts/build-county-income.ts). */
const COUNTY_INCOME = countyIncome.byCounty as Record<string, number | undefined>
const COUNTY_INCOME_YEAR = countyIncome.year

type ZipCensusEntry = { medianIncome: number; medianRent: number | null; year: number }
const ZIP_CENSUS = censusData as unknown as Record<string, ZipCensusEntry | undefined>
/** USPS-only zip (no ZCTA) → residential donor ZCTA; built by scripts/build-po-box-acs.ts. */
const PO_BOX_DONOR = poBoxAcs.byZip as Record<string, string | undefined>

const NATIONAL_FALLBACK = {
  medianIncome: NATIONAL_MEDIAN_INCOME,
  medianRent: NATIONAL_MEDIAN_RENT,
}

const acsLabel = (year: number, where: string) => `Census ACS ${year} 5-year, ${where}`

/** 'city' when the donor shares the zip's county and city name (build-po-box-acs.ts tier 1), else 'county'. */
function donorScopeOf(zip: string, donor: string): 'city' | 'county' {
  const a = lookupZip(zip)
  const b = lookupZip(donor)
  if (a && b && a.countyFips === b.countyFips && a.cityName && norm(a.cityName) === norm(b.cityName ?? '')) {
    return 'city'
  }
  return 'county'
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * City/state query params may only override the zip's income when that city
 * actually contains the zip: the state must match the zip's state, and the city
 * must be the zip's own city name or a curated city→zip entry for this zip.
 * (Prevents e.g. /api/data/04101?city=portland&state=or using Portland OR income.)
 */
export function cityContainsZip(zip: string, city: string, state: string): boolean {
  const location = lookupZip(zip)
  if (!location) return false
  const c = norm(city)
  const s = norm(state)
  if (s !== location.stateAbbr.toLowerCase()) return false
  if (location.cityName && norm(location.cityName) === c) return true
  return CITY_ZIP_LOOKUP.some((e) => e.zip === zip && norm(e.city) === c && norm(e.state) === s)
}

export function getCensusData(zip: string, city?: string, state?: string): CensusData {
  // City-level income only when the city provably contains this zip
  if (city && state && cityContainsZip(zip, city, state)) {
    const placeKey = `${norm(city)}|${norm(state)}`
    const placeEntry = (censusPlaces as Record<string, { medianIncome: number; year: number }>)[placeKey]
    if (placeEntry && typeof placeEntry.medianIncome === 'number' && placeEntry.medianIncome > 0) {
      // Use zip-level rent if available, otherwise national fallback (flagged)
      const zipEntry = ZIP_CENSUS[zip]
      const hasZipRent = typeof zipEntry?.medianRent === 'number' && zipEntry.medianRent > 0
      const rent = hasZipRent ? (zipEntry!.medianRent as number) : NATIONAL_FALLBACK.medianRent
      return {
        zip,
        medianIncome: placeEntry.medianIncome,
        medianRent: rent,
        income: placeEntry.medianIncome,
        rent,
        source: 'acs',
        incomeGeo: 'city',
        sourceLabel: acsLabel(placeEntry.year, `${city} city median`),
        year: placeEntry.year,
        isFallback: false,
        isRentFallback: !hasZipRent,
        isCityLevel: true,
        cityName: city,
      }
    }
  }

  // Zip-level lookup
  const entry = ZIP_CENSUS[zip]
  if (entry) {
    const hasRent = typeof entry.medianRent === 'number' && entry.medianRent > 0
    const rent = hasRent ? (entry.medianRent as number) : NATIONAL_FALLBACK.medianRent
    return {
      zip,
      ...entry,
      medianRent: rent,
      income: entry.medianIncome,
      rent,
      source: 'acs',
      incomeGeo: 'zip',
      sourceLabel: acsLabel(entry.year, `zip ${zip}`),
      isFallback: false,
      isRentFallback: !hasRent,
      isCityLevel: false,
    }
  }

  // USPS-only zip (PO box / unique zip, no ZCTA): borrow the ACS values of a
  // residential "donor" zip — the zip in the same county AND city with the most
  // housing units (donorScope 'city'), else the county's most populous zip
  // (donorScope 'county'). Not necessarily the nearest zip. Always an estimate.
  const donor = PO_BOX_DONOR[zip]
  const donorEntry = donor ? ZIP_CENSUS[donor] : undefined
  if (donor && donorEntry && donorEntry.medianIncome > 0) {
    const hasRent = typeof donorEntry.medianRent === 'number' && donorEntry.medianRent > 0
    const rent = hasRent ? (donorEntry.medianRent as number) : NATIONAL_FALLBACK.medianRent
    const donorScope = donorScopeOf(zip, donor)
    return {
      zip,
      ...donorEntry,
      medianRent: rent,
      income: donorEntry.medianIncome,
      rent,
      source: 'acs',
      incomeGeo: 'zip',
      donorZip: donor,
      donorScope,
      sourceLabel: acsLabel(
        donorEntry.year,
        `zip ${donor} (largest residential zip in the same ${donorScope === 'city' ? 'city' : 'county'})`
      ),
      isFallback: false,
      isRentFallback: !hasRent,
      isCityLevel: false,
      approxFromZip: donor,
    }
  }

  // County fallback: ACS county median household income (CT zips use their
  // 2022 planning region, which is how ACS 2023 publishes Connecticut).
  const location = lookupZip(zip)
  const countyFips = location ? (getLausAreaFipsForZip(zip) ?? location.countyFips) : null
  const countyMedian = countyFips ? COUNTY_INCOME[countyFips] : undefined
  if (location && countyFips && typeof countyMedian === 'number' && countyMedian > 0) {
    return {
      zip,
      medianIncome: countyMedian,
      medianRent: NATIONAL_FALLBACK.medianRent,
      income: countyMedian,
      rent: NATIONAL_FALLBACK.medianRent,
      source: 'acs',
      incomeGeo: 'county',
      incomeCountyFips: countyFips,
      sourceLabel: acsLabel(
        COUNTY_INCOME_YEAR,
        `county median (${getLausAreaName(countyFips) ?? location.countyName}, ${location.stateAbbr})`
      ),
      year: COUNTY_INCOME_YEAR,
      isFallback: false,
      isRentFallback: true,
      isCityLevel: false,
    }
  }

  // National fallback (labeled with its real source: CPS 2022, not ACS)
  return {
    zip,
    ...NATIONAL_FALLBACK,
    income: NATIONAL_FALLBACK.medianIncome,
    rent: NATIONAL_FALLBACK.medianRent,
    source: 'national',
    incomeGeo: 'national',
    sourceLabel: NATIONAL_INCOME_SOURCE_LABEL,
    year: NATIONAL_INCOME_YEAR,
    isFallback: true,
    isRentFallback: true,
    isCityLevel: false,
  }
}
