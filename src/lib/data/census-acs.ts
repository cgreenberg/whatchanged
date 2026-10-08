import censusData from './census-acs.json'
import poBoxAcs from './po-box-acs.json'
import { lookupZip } from './zip-lookup'
import { CITY_ZIP_LOOKUP } from './city-zip-lookup'
import { getLausAreaFipsForZip } from '@/lib/mappings/laus-area'
import type { CensusData } from '@/types'

// Census ACS 5-year median gross rent by zip (bundled; scripts/build-census-acs.ts). Its only use on
// the site is the base of the Shelter (CPI) card's "≈ $/yr in rent" figure. (The bundled file also
// carries median household income, which nothing reads since the tariff estimate was removed.)
type ZipCensusEntry = { medianRent: number | null; year: number; rentCoded?: 'top' | 'bottom' }
const ZIP_CENSUS = censusData as unknown as Record<string, ZipCensusEntry | undefined>
/** Rent bases for zips without their own published ACS rent; built by scripts/build-po-box-acs.ts. */
interface RentBasisFile {
  /** USPS-only zip (no ZCTA) → residential donor ZCTA. */
  byZip: Record<string, string | undefined>
  /**
   * Zip whose own ACS rent is suppressed/missing → [nearest same-county residential zip with a reliable one (MOE ≤ 30%,
   * not top/bottom-coded) within 100 mi, miles, 1 when a same-town zip was preferred over a nearer one].
   */
  nearest?: Record<string, [string, number] | [string, number, 1] | undefined>
  /** Donor zip → its B25064 margin of error ($, 90%). */
  donorMoe?: Record<string, number | undefined>
  /**
   * Zip whose donor (PO-box or nearest) was rejected as unrepresentative — its rent outside [county median / 1.5,
   * county median × 1.5] → [that donor zip, its median rent]; the zip uses its county median.
   */
  unrepresentative?: Record<string, [string, number] | undefined>
  /** ACS 5-year county / state median gross rent (B25064), published values only (CT: planning-region FIPS keys). */
  counties?: Record<string, { rent: number; name: string } | undefined>
  states?: Record<string, { rent: number; name: string } | undefined>
}
const BASIS = poBoxAcs as unknown as RentBasisFile
const PO_BOX_DONOR = BASIS.byZip
/** Same ACS vintage as census-acs.json (scripts/build-po-box-acs.ts reads the 2023 5-year B25064 file). */
const ACS_GEO_YEAR = 2023

const acsLabel = (year: number, where: string) => `Census ACS ${year} 5-year, ${where}`

/** A donor's rent must be a published, uncoded median (the build also requires MOE ≤ 30%; this guards stale data). */
const usableDonor = (e: ZipCensusEntry | undefined): e is ZipCensusEntry & { medianRent: number } =>
  !!e && typeof e.medianRent === 'number' && e.medianRent > 0 && !e.rentCoded

/** Note for a zip's own top/bottom-coded median. */
const CODED_NOTE = {
  top: 'top-coded: Census reports only that the median is $3,500 or more, so the $ figure is a floor',
  bottom: 'bottom-coded: Census reports only that the median is under $100',
} as const

/** County key for the rent median: Connecticut's ACS "counties" are its 2022 planning regions. */
function rentCountyKey(zip: string, stateAbbr: string, countyFips: string): string {
  return stateAbbr === 'CT' ? getLausAreaFipsForZip(zip) ?? countyFips : countyFips
}

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
 * Local median gross rent for a zip — the base of the Shelter card's "≈ $/yr in rent". Never blank and never a
 * national constant; each step is labeled (basis + basisNote + sourceLabel):
 *   1. the zip's own ACS figure ('zip'; a top-coded "$3,500+" median is kept and flagged rentCoded);
 *   2. USPS-only zips: a residential donor zip in the same city, else county ('po-donor');
 *   3. suppressed/missing rent: the nearest residential zip in the same county with a reliable rent — margin of
 *      error ≤ 30%, not top/bottom-coded — within 100 mi, same town preferred ('nearest-zip');
 *   4. the county's ACS median gross rent ('county'; Connecticut: the zip's planning region) — also when the PO-box /
 *      nearest donor's rent is more than 1.5× above or below it (unrepresentative; the note names the rejected zip);
 *   5. the state's ACS median gross rent ('state').
 * Only a zip with none of these (territories ACS doesn't cover, unknown zips) → basis 'none', isRentFallback.
 */
export function getCensusData(zip: string): CensusData {
  const entry = ZIP_CENSUS[zip]
  if (entry && typeof entry.medianRent === 'number' && entry.medianRent > 0) {
    const coded = entry.rentCoded
    return {
      zip,
      medianRent: entry.medianRent,
      rent: entry.medianRent,
      year: entry.year,
      source: 'acs',
      basis: 'zip',
      ...(coded ? { rentCoded: coded, basisNote: CODED_NOTE[coded] } : {}),
      sourceLabel: acsLabel(entry.year, coded ? `zip ${zip} (${coded === 'top' ? '$3,500+, top-coded' : 'under $100, bottom-coded'})` : `zip ${zip}`),
      isFallback: false,
      isRentFallback: false,
    }
  }

  const donor = PO_BOX_DONOR[zip]
  const donorEntry = donor ? ZIP_CENSUS[donor] : undefined
  if (!entry && donor && usableDonor(donorEntry)) {
    const donorScope = donorScopeOf(zip, donor)
    const where = `zip ${donor} (largest residential zip in the same ${donorScope === 'city' ? 'city' : 'county'})`
    const moe = BASIS.donorMoe?.[donor]
    return {
      zip,
      medianRent: donorEntry.medianRent,
      rent: donorEntry.medianRent,
      year: donorEntry.year,
      source: 'acs',
      basis: 'po-donor',
      basisNote: `borrowed from ${where}`,
      donorZip: donor,
      donorScope,
      ...(moe ? { donorMoe: moe } : {}),
      sourceLabel: acsLabel(donorEntry.year, where),
      isFallback: false,
      isRentFallback: false,
      approxFromZip: donor,
    }
  }

  const near = BASIS.nearest?.[zip]
  const nearEntry = near ? ZIP_CENSUS[near[0]] : undefined
  if (near && usableDonor(nearEntry)) {
    const [nz, mi] = near
    const sameTown = near[2] === 1
    const what = `${sameTown ? 'nearest in the same town' : 'nearest'} with a reliable Census rent, ${mi.toFixed(1)} mi`
    const note = `borrowed from zip ${nz} (${what})`
    const moe = BASIS.donorMoe?.[nz]
    return {
      zip,
      medianRent: nearEntry.medianRent,
      rent: nearEntry.medianRent,
      year: nearEntry.year,
      source: 'acs',
      basis: 'nearest-zip',
      basisNote: note,
      donorZip: nz,
      donorMiles: mi,
      ...(sameTown ? { donorSameTown: true } : {}),
      ...(moe ? { donorMoe: moe } : {}),
      sourceLabel: acsLabel(nearEntry.year, `zip ${nz} (${what})`),
      isFallback: false,
      isRentFallback: false,
      approxFromZip: nz,
    }
  }

  const loc = lookupZip(zip)
  const county = loc ? BASIS.counties?.[rentCountyKey(zip, loc.stateAbbr, loc.countyFips)] : undefined
  if (loc && county && county.rent > 0) {
    const rejected = BASIS.unrepresentative?.[zip]
    return {
      zip,
      medianRent: county.rent,
      rent: county.rent,
      year: ACS_GEO_YEAR,
      source: 'acs',
      basis: 'county',
      basisNote: rejected
        ? `${county.name} median (zip ${rejected[0]}'s $${rejected[1].toLocaleString('en-US')} rent is unrepresentative)`
        : `${county.name} median (no zip figure)`,
      basisArea: county.name,
      sourceLabel: acsLabel(ACS_GEO_YEAR, `${county.name} median`),
      isFallback: false,
      isRentFallback: false,
    }
  }

  const state = loc ? BASIS.states?.[loc.stateAbbr] : undefined
  if (loc && state && state.rent > 0) {
    return {
      zip,
      medianRent: state.rent,
      rent: state.rent,
      year: ACS_GEO_YEAR,
      source: 'acs',
      basis: 'state',
      basisNote: `${state.name} median (no zip or county figure)`,
      basisArea: state.name,
      sourceLabel: acsLabel(ACS_GEO_YEAR, `${state.name} median`),
      isFallback: false,
      isRentFallback: false,
    }
  }

  // No published ACS rent for this place at any level (e.g. Guam, the U.S. Virgin Islands): no $ figure
  return {
    zip,
    medianRent: 0,
    rent: 0,
    year: (entry ?? donorEntry)?.year ?? 0,
    source: 'none',
    basis: 'none',
    sourceLabel: 'no Census rent figure for this place',
    isFallback: true,
    isRentFallback: true,
  }
}
