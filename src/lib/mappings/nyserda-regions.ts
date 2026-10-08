// NYSERDA home heating oil survey regions (data.ny.gov rc94-5y2u) → New York counties, as NYSERDA defines them
// on its Average Home Heating Oil Prices page ("New York State Regions", checked 2026-10-04):
// https://www.nyserda.ny.gov/Researchers-and-Policymakers/Energy-Prices/Home-Heating-Oil/Average-Home-Heating-Oil-Prices
// Every one of New York's 62 counties is in exactly one region (tests/unit/heating.test.ts).

export interface NyserdaRegion {
  /** Column in the data.ny.gov dataset. */
  column: string
  name: string
  counties: readonly string[]
}

export const NYSERDA_REGIONS: readonly NyserdaRegion[] = [
  { column: 'long_island_average_gal', name: 'Long Island', counties: ['36059', '36103'] },
  { column: 'new_york_city_average_gal', name: 'New York City', counties: ['36005', '36047', '36061', '36081', '36085'] },
  { column: 'lower_hudson_average_gal', name: 'Lower Hudson', counties: ['36027', '36079', '36087', '36119'] },
  { column: 'upper_hudson_average_gal', name: 'Upper Hudson', counties: ['36021', '36039', '36071', '36105', '36111'] },
  { column: 'capital_district_average', name: 'Capital District', counties: ['36001', '36035', '36057', '36083', '36091', '36093', '36095', '36115'] },
  { column: 'north_country_average_gal', name: 'North Country', counties: ['36019', '36031', '36033', '36041', '36045', '36049', '36089', '36113'] },
  { column: 'central_new_york_average', name: 'Central New York', counties: ['36007', '36011', '36017', '36023', '36025', '36043', '36053', '36065', '36067', '36075', '36077', '36107', '36109'] },
  { column: 'western_new_york_average', name: 'Western New York', counties: ['36003', '36009', '36013', '36015', '36029', '36037', '36051', '36055', '36063', '36069', '36073', '36097', '36099', '36101', '36117', '36121', '36123'] },
]

/** Statewide average column (the comparison line for a regional figure: same survey, same weeks). */
export const NYSERDA_STATEWIDE_COLUMN = 'new_york_statewide_average'

export function nyserdaRegionForCounty(countyFips: string | null | undefined): NyserdaRegion | null {
  if (!countyFips) return null
  return NYSERDA_REGIONS.find((r) => r.counties.includes(countyFips)) ?? null
}
