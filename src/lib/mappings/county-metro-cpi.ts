import cbsaCrosswalk from '@/lib/data/cbsa-cpi-crosswalk.json'

// BLS CPI area codes — verified against https://data.bls.gov/timeseries/CUUR{code}SAF11
// on 2026-03-22. Each code was checked by loading the series page and reading the Area field.
export const BLS_CPI_AREAS: Record<string, { code: string; name: string }> = {
  // Northeast
  S11A: { code: 'S11A', name: 'Boston-Cambridge-Newton' },
  S12A: { code: 'S12A', name: 'New York-Newark-Jersey City' },
  S12B: { code: 'S12B', name: 'Philadelphia-Camden-Wilmington' },
  // Midwest
  S23A: { code: 'S23A', name: 'Chicago-Naperville-Elgin' },
  S23B: { code: 'S23B', name: 'Detroit-Warren-Dearborn' },
  S24A: { code: 'S24A', name: 'Minneapolis-St. Paul-Bloomington' },
  S24B: { code: 'S24B', name: 'St. Louis' },
  // South
  S35A: { code: 'S35A', name: 'Washington-Arlington-Alexandria' },
  S35B: { code: 'S35B', name: 'Miami-Fort Lauderdale-West Palm Beach' },
  S35C: { code: 'S35C', name: 'Atlanta-Sandy Springs-Roswell' },
  S35D: { code: 'S35D', name: 'Tampa-St. Petersburg-Clearwater' },
  S35E: { code: 'S35E', name: 'Baltimore-Columbia-Towson' },
  S37A: { code: 'S37A', name: 'Dallas-Fort Worth-Arlington' },
  S37B: { code: 'S37B', name: 'Houston-The Woodlands-Sugar Land' },
  // West
  S48A: { code: 'S48A', name: 'Phoenix-Mesa-Scottsdale' },
  S48B: { code: 'S48B', name: 'Denver-Aurora-Lakewood' },
  S49A: { code: 'S49A', name: 'Los Angeles-Long Beach-Anaheim' },
  S49B: { code: 'S49B', name: 'San Francisco-Oakland-Hayward' },
  S49C: { code: 'S49C', name: 'Riverside-San Bernardino-Ontario' },
  S49D: { code: 'S49D', name: 'Seattle-Tacoma-Bellevue' },
  S49E: { code: 'S49E', name: 'San Diego-Carlsbad' },
  S49F: { code: 'S49F', name: 'Urban Hawaii' },
  S49G: { code: 'S49G', name: 'Urban Alaska' },
  // Regional CPI areas (fallback for non-metro counties)
  '0100': { code: '0100', name: 'Northeast Urban' },
  '0200': { code: '0200', name: 'Midwest Urban' },
  '0300': { code: '0300', name: 'South Urban' },
  '0400': { code: '0400', name: 'West Urban' },
}

export const STATE_TO_REGION: Record<string, string> = {
  CT: '0100', ME: '0100', MA: '0100', NH: '0100', NJ: '0100',
  NY: '0100', PA: '0100', RI: '0100', VT: '0100',
  IL: '0200', IN: '0200', IA: '0200', KS: '0200', MI: '0200',
  MN: '0200', MO: '0200', NE: '0200', ND: '0200', OH: '0200',
  SD: '0200', WI: '0200',
  AL: '0300', AR: '0300', DE: '0300', DC: '0300', FL: '0300',
  GA: '0300', KY: '0300', LA: '0300', MD: '0300', MS: '0300',
  NC: '0300', OK: '0300', SC: '0300', TN: '0300', TX: '0300',
  VA: '0300', WV: '0300',
  AK: '0400', AZ: '0400', CA: '0400', CO: '0400', HI: '0400',
  ID: '0400', MT: '0400', NV: '0400', NM: '0400', OR: '0400',
  UT: '0400', WA: '0400', WY: '0400',
}

export function getMetroCpiAreaForCounty(
  countyFips: string,
  stateAbbr: string
): { areaCode: string; areaName: string; tier: 1 | 2 | 3 } {
  // Tier 1: CBSA-based lookup (official OMB → BLS mapping)
  const cbsaArea = (cbsaCrosswalk as Record<string, string>)[countyFips]
  if (cbsaArea && BLS_CPI_AREAS[cbsaArea]) {
    return { areaCode: cbsaArea, areaName: BLS_CPI_AREAS[cbsaArea].name, tier: 1 }
  }

  // Tier 2: Regional CPI fallback
  const regionCode = STATE_TO_REGION[stateAbbr.toUpperCase()]
  if (regionCode && BLS_CPI_AREAS[regionCode]) {
    return { areaCode: regionCode, areaName: BLS_CPI_AREAS[regionCode].name, tier: 2 }
  }

  // Tier 3: National fallback (territories)
  return { areaCode: '0000', areaName: 'National', tier: 3 }
}
