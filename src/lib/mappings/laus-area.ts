// LAUS area resolution (BLS county-equivalent geography). No longer used for
// a runtime unemployment fetch: the Census income lookup (census-acs.ts) and
// build/audit scripts use it to resolve CT zips to their 2022 planning region.
//
// Connecticut abolished its 8 counties in 2022; BLS LAUS now publishes
// "county" series for the 9 Census planning regions (FIPS 09110–09190).
// zip-county.json keeps the legacy CT counties (09001–09015) because the OMB
// 2013 CBSA delineation that BLS CPI uses is defined on them, so LAUS needs
// its own translation:
//   - per zip: the planning region holding most of the zip's housing units
//     (2020 blocks → CT town → 2022 planning region; see build-zip-county.ts)
//   - per legacy county: the region holding most of the county's housing
//     units — an approximation, because 5 of 8 legacy counties are split
//     across regions.
import ctPlanningRegions from '@/lib/data/ct-planning-regions.json'
import zipCountyData from '@/lib/data/zip-county.json'

export const CT_PLANNING_REGION_NAMES: Record<string, string> = {
  '09110': 'Capitol Planning Region',
  '09120': 'Greater Bridgeport Planning Region',
  '09130': 'Lower Connecticut River Valley Planning Region',
  '09140': 'Naugatuck Valley Planning Region',
  '09150': 'Northeastern Connecticut Planning Region',
  '09160': 'Northwest Hills Planning Region',
  '09170': 'South Central Connecticut Planning Region',
  '09180': 'Southeastern Connecticut Planning Region',
  '09190': 'Western Connecticut Planning Region',
}

const CT_BY_ZIP = ctPlanningRegions.byZip as Record<string, string>
const CT_BY_COUNTY = ctPlanningRegions.byCounty as Record<string, string>
const ZIP_COUNTY = zipCountyData as Record<string, { countyFips: string }>

export interface LausArea {
  /** 5-digit FIPS used in the LAUS series ID LAUCN{fips}0000000003 */
  fips: string
  /** true when a legacy CT county was mapped to its dominant planning region */
  approx: boolean
}

/**
 * LAUS area for a county FIPS. CT legacy counties → dominant planning region
 * (approx: true); CT planning-region FIPS and every other county pass through.
 */
export function getLausAreaForCounty(countyFips: string): LausArea {
  const fips = countyFips.padStart(5, '0')
  const region = CT_BY_COUNTY[fips]
  if (region) return { fips: region, approx: true }
  return { fips, approx: false }
}

/**
 * LAUS area FIPS for a zip: the CT planning region for CT zips, otherwise the
 * zip's county FIPS. Returns null for zips not in zip-county.json.
 */
export function getLausAreaFipsForZip(zip: string): string | null {
  const ctRegion = CT_BY_ZIP[zip]
  if (ctRegion) return ctRegion
  const entry = ZIP_COUNTY[zip]
  if (!entry) return null
  return getLausAreaForCounty(entry.countyFips).fips
}

/** Display name of a LAUS area that is not a county (CT planning regions); undefined otherwise. */
export function getLausAreaName(lausFips: string): string | undefined {
  return CT_PLANNING_REGION_NAMES[lausFips]
}
