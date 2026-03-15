const BLS_CPI_AREAS: Record<string, { code: string; name: string }> = {
  // Northeast
  'S11A': { code: 'S11A', name: 'Boston-Cambridge-Newton' },
  'S12A': { code: 'S12A', name: 'New York-Newark-Jersey City' },
  'S12B': { code: 'S12B', name: 'Philadelphia-Camden-Wilmington' },
  // South
  'S23A': { code: 'S23A', name: 'Atlanta-Sandy Springs-Roswell' },
  'S23B': { code: 'S23B', name: 'Miami-Fort Lauderdale-West Palm Beach' },
  'S23C': { code: 'S23C', name: 'Tampa-St. Petersburg-Clearwater' },
  'S35A': { code: 'S35A', name: 'Dallas-Fort Worth-Arlington' },
  'S35B': { code: 'S35B', name: 'Houston-The Woodlands-Sugar Land' },
  // Midwest
  'S24A': { code: 'S24A', name: 'Chicago-Naperville-Elgin' },
  'S24B': { code: 'S24B', name: 'Detroit-Warren-Dearborn' },
  'S24C': { code: 'S24C', name: 'Minneapolis-St. Paul-Bloomington' },
  'S24D': { code: 'S24D', name: 'St. Louis' },
  // West
  'S35C': { code: 'S35C', name: 'Phoenix-Mesa-Scottsdale' },
  'S35D': { code: 'S35D', name: 'Denver-Aurora-Lakewood' },
  'S37A': { code: 'S37A', name: 'Los Angeles-Long Beach-Anaheim' },
  'S48A': { code: 'S48A', name: 'Seattle-Tacoma-Bellevue' },
  'S48B': { code: 'S48B', name: 'San Diego-Carlsbad' },
  'S49A': { code: 'S49A', name: 'San Francisco-Oakland-Hayward' },
  'S49B': { code: 'S49B', name: 'Urban Hawaii' },
}

// Map state abbreviation to closest BLS CPI area code
const STATE_TO_CPI_AREA: Record<string, string> = {
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
  MD: 'S12B', // closest
  DC: 'S12B',
  GA: 'S23A', // Atlanta
  FL: 'S23B', // Miami
  AL: 'S23A', // Atlanta (closest)
  SC: 'S23A',
  NC: 'S23A',
  TN: 'S23A',
  TX: 'S35A', // Dallas
  OK: 'S35A',
  IL: 'S24A', // Chicago
  IN: 'S24A',
  WI: 'S24A',
  MI: 'S24B', // Detroit
  OH: 'S24B',
  MN: 'S24C', // Minneapolis
  IA: 'S24C',
  MO: 'S24D', // St. Louis
  KY: 'S24D',
  AZ: 'S35C', // Phoenix
  NM: 'S35C',
  CO: 'S35D', // Denver
  UT: 'S35D',
  CA: 'S37A', // Los Angeles (default for CA)
  WA: 'S48A', // Seattle
  OR: 'S48A',
  HI: 'S49B', // Urban Hawaii
  // States that fall back to national
  // AK, WY, MT, ND, SD, NE, KS, AR, LA, MS, WV, VA, ID, NV not covered
}

// County FIPS overrides for metros that don't match the state default
const COUNTY_CPI_OVERRIDES: Record<string, string> = {
  '06075': 'S49A', // San Francisco County → SF metro
  '06081': 'S49A', // San Mateo County → SF metro
  '06085': 'S49A', // Santa Clara County → SF metro
  '06001': 'S49A', // Alameda County → SF metro
  '06013': 'S49A', // Contra Costa County → SF metro
  '06041': 'S49A', // Marin County → SF metro
  '06073': 'S48B', // San Diego County → San Diego metro
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
