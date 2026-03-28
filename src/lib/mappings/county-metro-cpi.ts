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
  // Census Divisions (Tier 2)
  '0110': { code: '0110', name: 'New England' },
  '0120': { code: '0120', name: 'Middle Atlantic' },
  '0230': { code: '0230', name: 'East North Central' },
  '0240': { code: '0240', name: 'West North Central' },
  '0350': { code: '0350', name: 'South Atlantic' },
  '0360': { code: '0360', name: 'East South Central' },
  '0370': { code: '0370', name: 'West South Central' },
  '0480': { code: '0480', name: 'Mountain' },
  '0490': { code: '0490', name: 'Pacific' },
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

export const STATE_TO_DIVISION: Record<string, { code: string; name: string }> = {
  // Northeast divisions
  CT: { code: '0110', name: 'New England' },
  ME: { code: '0110', name: 'New England' },
  MA: { code: '0110', name: 'New England' },
  NH: { code: '0110', name: 'New England' },
  RI: { code: '0110', name: 'New England' },
  VT: { code: '0110', name: 'New England' },
  NJ: { code: '0120', name: 'Middle Atlantic' },
  NY: { code: '0120', name: 'Middle Atlantic' },
  PA: { code: '0120', name: 'Middle Atlantic' },
  // Midwest divisions
  IL: { code: '0230', name: 'East North Central' },
  IN: { code: '0230', name: 'East North Central' },
  MI: { code: '0230', name: 'East North Central' },
  OH: { code: '0230', name: 'East North Central' },
  WI: { code: '0230', name: 'East North Central' },
  IA: { code: '0240', name: 'West North Central' },
  KS: { code: '0240', name: 'West North Central' },
  MN: { code: '0240', name: 'West North Central' },
  MO: { code: '0240', name: 'West North Central' },
  NE: { code: '0240', name: 'West North Central' },
  ND: { code: '0240', name: 'West North Central' },
  SD: { code: '0240', name: 'West North Central' },
  // South divisions
  DE: { code: '0350', name: 'South Atlantic' },
  DC: { code: '0350', name: 'South Atlantic' },
  FL: { code: '0350', name: 'South Atlantic' },
  GA: { code: '0350', name: 'South Atlantic' },
  MD: { code: '0350', name: 'South Atlantic' },
  NC: { code: '0350', name: 'South Atlantic' },
  SC: { code: '0350', name: 'South Atlantic' },
  VA: { code: '0350', name: 'South Atlantic' },
  WV: { code: '0350', name: 'South Atlantic' },
  AL: { code: '0360', name: 'East South Central' },
  KY: { code: '0360', name: 'East South Central' },
  MS: { code: '0360', name: 'East South Central' },
  TN: { code: '0360', name: 'East South Central' },
  AR: { code: '0370', name: 'West South Central' },
  LA: { code: '0370', name: 'West South Central' },
  OK: { code: '0370', name: 'West South Central' },
  TX: { code: '0370', name: 'West South Central' },
  // West divisions
  AZ: { code: '0480', name: 'Mountain' },
  CO: { code: '0480', name: 'Mountain' },
  ID: { code: '0480', name: 'Mountain' },
  MT: { code: '0480', name: 'Mountain' },
  NV: { code: '0480', name: 'Mountain' },
  NM: { code: '0480', name: 'Mountain' },
  UT: { code: '0480', name: 'Mountain' },
  WY: { code: '0480', name: 'Mountain' },
  AK: { code: '0490', name: 'Pacific' },
  CA: { code: '0490', name: 'Pacific' },
  HI: { code: '0490', name: 'Pacific' },
  OR: { code: '0490', name: 'Pacific' },
  WA: { code: '0490', name: 'Pacific' },
}

export function getMetroCpiAreaForCounty(
  countyFips: string,
  stateAbbr: string
): { areaCode: string; areaName: string; tier: 1 | 2 | 3 | 4 } {
  // Tier 1: CBSA-based lookup (official OMB → BLS mapping)
  const cbsaArea = (cbsaCrosswalk as Record<string, string>)[countyFips]
  if (cbsaArea && BLS_CPI_AREAS[cbsaArea]) {
    return { areaCode: cbsaArea, areaName: BLS_CPI_AREAS[cbsaArea].name, tier: 1 }
  }

  // Tier 2: Census Division lookup
  const division = STATE_TO_DIVISION[stateAbbr.toUpperCase()]
  if (division) {
    return { areaCode: division.code, areaName: division.name, tier: 2 }
  }

  // Tier 3: Regional CPI fallback
  const regionCode = STATE_TO_REGION[stateAbbr.toUpperCase()]
  if (regionCode && BLS_CPI_AREAS[regionCode]) {
    return { areaCode: regionCode, areaName: BLS_CPI_AREAS[regionCode].name, tier: 3 }
  }

  // Tier 4: National fallback (territories)
  return { areaCode: '0000', areaName: 'National', tier: 4 }
}
