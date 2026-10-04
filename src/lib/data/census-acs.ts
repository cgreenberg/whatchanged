import censusData from './census-acs.json'
import poBoxAcs from './po-box-acs.json'
import { lookupZip } from './zip-lookup'
import { CITY_ZIP_LOOKUP } from './city-zip-lookup'
import { NATIONAL_MEDIAN_RENT } from '@/lib/compute/dollar-translations'
import type { CensusData } from '@/types'

// Census ACS 5-year median gross rent by zip (bundled; scripts/build-census-acs.ts). Its only use on
// the site is the base of the Shelter (CPI) card's "≈ $/yr in rent" figure. (The bundled file also
// carries median household income, which nothing reads since the tariff estimate was removed.)
type ZipCensusEntry = { medianRent: number | null; year: number }
const ZIP_CENSUS = censusData as unknown as Record<string, ZipCensusEntry | undefined>
/** USPS-only zip (no ZCTA) → residential donor ZCTA; built by scripts/build-po-box-acs.ts. */
const PO_BOX_DONOR = poBoxAcs.byZip as Record<string, string | undefined>

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
 * true when a city/state from a link actually contains the zip: the state must match the zip's
 * state, and the city must be the zip's own city name or a curated city→zip entry for this zip.
 * The page metadata echoes city/state into og:url only then (never e.g. ?zip=04101&city=portland&state=or).
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

/**
 * Local median gross rent for a zip: its own ACS figure, else (USPS-only zips) a donor zip's — the
 * largest residential zip in the same city, else the most populous in the county; labeled. No local
 * figure → the U.S. median flagged `isRentFallback` (never used for a dollar figure).
 */
export function getCensusData(zip: string): CensusData {
  const entry = ZIP_CENSUS[zip]
  if (entry && typeof entry.medianRent === 'number' && entry.medianRent > 0) {
    return {
      zip,
      medianRent: entry.medianRent,
      rent: entry.medianRent,
      year: entry.year,
      source: 'acs',
      sourceLabel: acsLabel(entry.year, `zip ${zip}`),
      isFallback: false,
      isRentFallback: false,
    }
  }

  const donor = PO_BOX_DONOR[zip]
  const donorEntry = donor ? ZIP_CENSUS[donor] : undefined
  if (!entry && donor && donorEntry && typeof donorEntry.medianRent === 'number' && donorEntry.medianRent > 0) {
    const donorScope = donorScopeOf(zip, donor)
    return {
      zip,
      medianRent: donorEntry.medianRent,
      rent: donorEntry.medianRent,
      year: donorEntry.year,
      source: 'acs',
      donorZip: donor,
      donorScope,
      sourceLabel: acsLabel(
        donorEntry.year,
        `zip ${donor} (largest residential zip in the same ${donorScope === 'city' ? 'city' : 'county'})`
      ),
      isFallback: false,
      isRentFallback: false,
      approxFromZip: donor,
    }
  }

  return {
    zip,
    medianRent: NATIONAL_MEDIAN_RENT,
    rent: NATIONAL_MEDIAN_RENT,
    year: (entry ?? donorEntry)?.year ?? 0,
    source: 'national',
    sourceLabel: 'no local Census rent figure',
    isFallback: true,
    isRentFallback: true,
  }
}
