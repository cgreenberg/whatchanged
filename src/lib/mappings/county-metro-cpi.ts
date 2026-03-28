// BLS CPI area codes — verified against https://data.bls.gov/timeseries/CUUR{code}SAF11
// on 2026-03-22. Each code was checked by loading the series page and reading the Area field.
export const BLS_CPI_AREAS: Record<string, { code: string; name: string }> = {
  // Northeast
  'S11A': { code: 'S11A', name: 'Boston-Cambridge-Newton' },
  'S12A': { code: 'S12A', name: 'New York-Newark-Jersey City' },
  'S12B': { code: 'S12B', name: 'Philadelphia-Camden-Wilmington' },
  // Midwest
  'S23A': { code: 'S23A', name: 'Chicago-Naperville-Elgin' },
  'S23B': { code: 'S23B', name: 'Detroit-Warren-Dearborn' },
  'S24A': { code: 'S24A', name: 'Minneapolis-St. Paul-Bloomington' },
  'S24B': { code: 'S24B', name: 'St. Louis' },
  // South
  'S35A': { code: 'S35A', name: 'Washington-Arlington-Alexandria' },
  'S35B': { code: 'S35B', name: 'Miami-Fort Lauderdale-West Palm Beach' },
  'S35C': { code: 'S35C', name: 'Atlanta-Sandy Springs-Roswell' },
  'S35D': { code: 'S35D', name: 'Tampa-St. Petersburg-Clearwater' },
  'S35E': { code: 'S35E', name: 'Baltimore-Columbia-Towson' },
  'S37A': { code: 'S37A', name: 'Dallas-Fort Worth-Arlington' },
  'S37B': { code: 'S37B', name: 'Houston-The Woodlands-Sugar Land' },
  // West
  'S48A': { code: 'S48A', name: 'Phoenix-Mesa-Scottsdale' },
  'S48B': { code: 'S48B', name: 'Denver-Aurora-Lakewood' },
  'S49A': { code: 'S49A', name: 'Los Angeles-Long Beach-Anaheim' },
  'S49B': { code: 'S49B', name: 'San Francisco-Oakland-Hayward' },
  'S49C': { code: 'S49C', name: 'Riverside-San Bernardino-Ontario' },
  'S49D': { code: 'S49D', name: 'Seattle-Tacoma-Bellevue' },
  'S49E': { code: 'S49E', name: 'San Diego-Carlsbad' },
  'S49F': { code: 'S49F', name: 'Urban Hawaii' },
  'S49G': { code: 'S49G', name: 'Urban Alaska' },
}

// Map state abbreviation to closest BLS CPI area code
export const STATE_TO_CPI_AREA: Record<string, string> = {
  // States with direct metro CPI coverage
  MA: 'S11A', // Boston
  CT: 'S11A', // Boston (closest)
  RI: 'S11A',
  NH: 'S11A',
  VT: 'S11A',
  ME: 'S11A',
  NY: 'S12A', // New York
  NJ: 'S12A',
  PA: 'S12B', // Philadelphia
  DE: 'S12B',
  MD: 'S35E', // Baltimore
  DC: 'S35A', // Washington
  VA: 'S35A', // Washington (DC/NoVA corridor)
  WV: 'S35A', // Washington (closest)
  GA: 'S35C', // Atlanta
  FL: 'S35B', // Miami
  AL: 'S35C', // Atlanta (closest)
  SC: 'S35C', // Atlanta (closest)
  NC: 'S35C', // Atlanta (closest)
  TN: 'S35C', // Atlanta (closest)
  MS: 'S35C', // Atlanta (closest)
  TX: 'S37A', // Dallas
  OK: 'S37A', // Dallas (closest)
  AR: 'S37A', // Dallas (closest)
  LA: 'S37B', // Houston (closest Gulf Coast CPI metro)
  IL: 'S23A', // Chicago
  IN: 'S23A', // Chicago (closest)
  WI: 'S23A', // Chicago (closest)
  MI: 'S23B', // Detroit
  OH: 'S23B', // Detroit (closest)
  MN: 'S24A', // Minneapolis
  IA: 'S24A', // Minneapolis (closest)
  ND: 'S24A', // Minneapolis (closest)
  SD: 'S24A', // Minneapolis (closest)
  NE: 'S24A', // Minneapolis (closest)
  MO: 'S24B', // St. Louis
  KY: 'S24B', // St. Louis (closest)
  KS: 'S24B', // St. Louis (closest)
  AZ: 'S48A', // Phoenix
  NM: 'S48A', // Phoenix (closest)
  CO: 'S48B', // Denver
  UT: 'S48B', // Denver (closest)
  WY: 'S48B', // Denver (closest)
  MT: 'S48B', // Denver (closest)
  CA: 'S49A', // Los Angeles (default for CA)
  NV: 'S49A', // Los Angeles (closest — Las Vegas has no BLS CPI metro)
  WA: 'S49D', // Seattle
  OR: 'S49D', // Seattle (closest — Portland has no BLS CPI metro)
  ID: 'S48B', // Denver (closest — Idaho is PAD 4 Rocky Mountain, not West Coast)
  HI: 'S49F', // Urban Hawaii
  AK: 'S49G', // Urban Alaska
  // PR and VI have no nearby BLS CPI metro — remain national
}

// County FIPS overrides for metros that don't match the state default
export const COUNTY_CPI_OVERRIDES: Record<string, string> = {
  // San Francisco-Oakland-Hayward metro (CA default is Los Angeles)
  '06075': 'S49B', // San Francisco County → SF metro
  '06081': 'S49B', // San Mateo County → SF metro
  '06085': 'S49B', // Santa Clara County → SF metro
  '06001': 'S49B', // Alameda County → SF metro
  '06013': 'S49B', // Contra Costa County → SF metro
  '06041': 'S49B', // Marin County → SF metro
  '06097': 'S49B', // Sonoma County → SF metro
  '06055': 'S49B', // Napa County → SF metro
  // San Diego-Carlsbad metro
  '06073': 'S49E', // San Diego County → San Diego metro
  // Riverside-San Bernardino-Ontario metro
  '06065': 'S49C', // Riverside County → Riverside metro
  '06071': 'S49C', // San Bernardino County → Riverside metro
  // Houston-The Woodlands-Sugar Land metro (TX default is Dallas)
  '48201': 'S37B', // Harris County → Houston metro
  '48039': 'S37B', // Brazoria County → Houston metro
  '48157': 'S37B', // Fort Bend County → Houston metro
  '48167': 'S37B', // Galveston County → Houston metro
  '48071': 'S37B', // Chambers County → Houston metro
  '48291': 'S37B', // Liberty County → Houston metro
  '48339': 'S37B', // Montgomery County → Houston metro
  '48473': 'S37B', // Waller County → Houston metro
  // Tampa metro (FL default is Miami)
  '12057': 'S35D', // Hillsborough County → Tampa metro
  '12103': 'S35D', // Pinellas County → Tampa metro
  '12101': 'S35D', // Pasco County → Tampa metro
  '12053': 'S35D', // Hernando County → Tampa metro
  // Orlando metro → Tampa CPI (closer than Miami default)
  '12095': 'S35D', // Orange County (Orlando)
  '12117': 'S35D', // Seminole County (Sanford, north Orlando)
  '12097': 'S35D', // Osceola County (Kissimmee, south Orlando)
  '12069': 'S35D', // Lake County (west of Orlando)
  '12127': 'S35D', // Volusia County (Daytona Beach, northeast of Orlando)
  '12035': 'S35D', // Flagler County (Palm Coast, northeast)
  '12119': 'S35D', // Sumter County (The Villages, northwest of Orlando)
  '12105': 'S35D', // Polk County (Lakeland, between Orlando and Tampa)
  '12009': 'S35D', // Brevard County (Melbourne/Space Coast, east of Orlando)
  // Atlanta metro (GA is already Atlanta default, but include for clarity)
  // Baltimore metro (MD default is now Baltimore)
  // Washington DC metro counties in MD (override MD's Baltimore default)
  '24031': 'S35A', // Montgomery County, MD → Washington metro
  '24033': 'S35A', // Prince George's County, MD → Washington metro
  '24017': 'S35A', // Charles County, MD → Washington metro
  // Philadelphia metro — South NJ counties (NJ default is NYC)
  '34007': 'S12B', // Camden County → Philadelphia metro
  '34005': 'S12B', // Burlington County → Philadelphia metro
  // Fairfield County CT — NYC metro, not Boston (CT default is Boston)
  '09001': 'S12A', // Fairfield County (Bridgeport, Stamford) → NYC metro
  // Reno NV — closer to SF than LA (NV default is Los Angeles)
  '32031': 'S49B', // Washoe County (Reno) → SF metro
  // Southaven MS — Memphis suburb, Houston CPI closer than Atlanta (MS default is Atlanta)
  '28033': 'S37B', // DeSoto County (Southaven) → Houston metro
  // Covington KY — Cincinnati suburb, Detroit/Ohio CPI closer than St. Louis (KY default is St. Louis)
  '21117': 'S23B', // Kenton County (Covington) → Detroit metro
  '21015': 'S23B', // Boone County KY (Florence) → Detroit metro
  '21037': 'S23B', // Campbell County KY (Newport) → Detroit metro
}

export function getMetroCpiArea(stateAbbr: string): { areaCode: string; areaName: string } {
  const code = STATE_TO_CPI_AREA[stateAbbr.toUpperCase()]
  if (code && BLS_CPI_AREAS[code]) {
    return { areaCode: code, areaName: BLS_CPI_AREAS[code].name }
  }
  return { areaCode: '0000', areaName: 'National' }
}

export function getMetroCpiAreaForCounty(countyFips: string, stateAbbr: string): { areaCode: string; areaName: string } {
  const override = COUNTY_CPI_OVERRIDES[countyFips]
  if (override && BLS_CPI_AREAS[override]) {
    return { areaCode: override, areaName: BLS_CPI_AREAS[override].name }
  }
  return getMetroCpiArea(stateAbbr)
}
