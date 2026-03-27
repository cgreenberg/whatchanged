// EIA gas price lookup tables:
// Maps CPI metro areas, county FIPS codes, and states to EIA duoarea codes
// used when fetching weekly retail gas price data from the EIA API.

// --- Tier 1: CPI metro area → EIA city duoarea ---

export const CPI_TO_EIA_CITY: Record<string, { duoarea: string; label: string }> = {
  'S49D': { duoarea: 'Y48SE', label: 'Seattle area avg' },
  'S49A': { duoarea: 'Y05LA', label: 'Los Angeles area avg' },
  'S49B': { duoarea: 'Y05SF', label: 'San Francisco area avg' },
  'S12A': { duoarea: 'Y35NY', label: 'New York City area avg' },
  'S11A': { duoarea: 'YBOS', label: 'Boston area avg' },
  'S23A': { duoarea: 'YORD', label: 'Chicago area avg' },
  'S48B': { duoarea: 'YDEN', label: 'Denver area avg' },
  'S37B': { duoarea: 'Y44HO', label: 'Houston area avg' },
  'S35B': { duoarea: 'YMIA', label: 'Miami area avg' },
}

export const COUNTY_EIA_CITY_OVERRIDES: Record<string, { duoarea: string; label: string }> = {
  '39035': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Cuyahoga County
  '39093': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Lorain County
  '39085': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Lake County
  '39055': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Geauga County
  '39103': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Medina County
  // SW Washington counties in the Portland-Vancouver-Hillsboro OR-WA MSA
  // EIA has no Portland city-level gas series — use WA state avg (not Seattle)
  '53011': { duoarea: 'SWA', label: 'Washington state avg' },  // Clark County (Vancouver)
  '53015': { duoarea: 'SWA', label: 'Washington state avg' },  // Cowlitz County (Longview)
  '53059': { duoarea: 'SWA', label: 'Washington state avg' },  // Skamania County
  // Jacksonville FL — FL state avg, not Miami city
  '12031': { duoarea: 'SFL', label: 'Florida state avg' },  // Duval County (Jacksonville)
  // Orlando FL — FL state avg, not Miami city
  '12095': { duoarea: 'SFL', label: 'Florida state avg' },  // Orange County (Orlando)
  // Upstate NY — NY state avg, not NYC city
  '36029': { duoarea: 'SNY', label: 'New York state avg' },  // Erie County (Buffalo)
  '36055': { duoarea: 'SNY', label: 'New York state avg' },  // Monroe County (Rochester)
  '36067': { duoarea: 'SNY', label: 'New York state avg' },  // Onondaga County (Syracuse)
  // Louisiana parishes — Gulf Coast PAD 3, not Houston city
  '22071': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Orleans Parish (New Orleans)
  '22033': { duoarea: 'R30', label: 'Gulf Coast avg' },  // East Baton Rouge Parish
  '22051': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Jefferson Parish (Metairie)
  '22017': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Caddo Parish (Shreveport)
  '22055': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Lafayette Parish
  '22019': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Calcasieu Parish (Lake Charles)
  '22079': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Rapides Parish (Alexandria)
  '22073': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Ouachita Parish (Monroe)
  '22109': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Terrebonne Parish (Houma)
  '22015': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Bossier Parish
  '22063': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Livingston Parish
  '22103': { duoarea: 'R30', label: 'Gulf Coast avg' },  // St. Tammany Parish
}

// --- Tier 2: State-level EIA data (8 states) ---

export const STATE_LEVEL_CODES: Record<string, { duoarea: string; label: string }> = {
  WA: { duoarea: 'SWA', label: 'Washington state avg' },
  CA: { duoarea: 'SCA', label: 'California state avg' },
  CO: { duoarea: 'SCO', label: 'Colorado state avg' },
  FL: { duoarea: 'SFL', label: 'Florida state avg' },
  MA: { duoarea: 'SMA', label: 'Massachusetts state avg' },
  MN: { duoarea: 'SMN', label: 'Minnesota state avg' },
  NY: { duoarea: 'SNY', label: 'New York state avg' },
  OH: { duoarea: 'SOH', label: 'Ohio state avg' },
  TX: { duoarea: 'STX', label: 'Texas state avg' },
}

// --- Tier 3: PAD District (fallback) ---

export const STATE_TO_PAD: Record<string, number | string> = {
  // PAD 1A — New England
  ME: '1A', NH: '1A', VT: '1A', MA: '1A', RI: '1A', CT: '1A',
  // PAD 1B — Central Atlantic
  NY: '1B', NJ: '1B', PA: '1B', DE: '1B', MD: '1B', DC: '1B',
  // PAD 1C — Lower Atlantic
  VA: '1C', WV: '1C', NC: '1C', SC: '1C', GA: '1C', FL: '1C',
  // PAD 2 — Midwest
  OH: 2, MI: 2, IN: 2, IL: 2, WI: 2, MN: 2, IA: 2, MO: 2, ND: 2,
  SD: 2, NE: 2, KS: 2, KY: 2, TN: 2, OK: 2,
  // PAD 3 — Gulf Coast
  TX: 3, LA: 3, MS: 3, AL: 3, AR: 3, NM: 3,
  // PAD 4 — Rocky Mountain
  MT: 4, ID: 4, WY: 4, CO: 4, UT: 4,
  // PAD 5 — West Coast
  WA: 5, OR: 5, CA: 5, NV: 5, AZ: 5, AK: 5, HI: 5,
}

export const PAD_NAMES: Record<string | number, string> = {
  '1A': 'New England',
  '1B': 'Central Atlantic',
  '1C': 'Lower Atlantic',
  2: 'Midwest',
  3: 'Gulf Coast',
  4: 'Rocky Mountain',
  5: 'West Coast',
}

export const PAD_DUOAREA: Record<string | number, string> = {
  '1A': 'R1X',
  '1B': 'R1Y',
  '1C': 'R1Z',
  2: 'R20',
  3: 'R30',
  4: 'R40',
  5: 'R50',
}
