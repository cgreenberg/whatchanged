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
}

// --- Tier 2: State-level EIA data (8 states) ---

export const STATE_LEVEL_CODES: Record<string, { duoarea: string; label: string }> = {
  WA: { duoarea: 'SWA', label: 'Washington state avg' },
  CA: { duoarea: 'SCA', label: 'California state avg' },
  CO: { duoarea: 'SCO', label: 'Colorado state avg' },
  FL: { duoarea: 'SFL', label: 'Florida state avg' },
  MN: { duoarea: 'SMN', label: 'Minnesota state avg' },
  NY: { duoarea: 'SNY', label: 'New York state avg' },
  OH: { duoarea: 'SOH', label: 'Ohio state avg' },
  TX: { duoarea: 'STX', label: 'Texas state avg' },
}

// --- Tier 3: PAD District (fallback) ---

export const STATE_TO_PAD: Record<string, number> = {
  // PAD 1 — East Coast
  ME: 1, NH: 1, VT: 1, MA: 1, RI: 1, CT: 1, NY: 1, NJ: 1, PA: 1,
  DE: 1, MD: 1, DC: 1, VA: 1, WV: 1, NC: 1, SC: 1, GA: 1, FL: 1,
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

export const PAD_NAMES: Record<number, string> = {
  1: 'East Coast',
  2: 'Midwest',
  3: 'Gulf Coast',
  4: 'Rocky Mountain',
  5: 'West Coast',
}
