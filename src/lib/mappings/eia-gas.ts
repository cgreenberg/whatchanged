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

// --- Tier 1a: county FIPS → EIA series overrides ---
//
// Only needed where the default chain (CPI metro → EIA city, then state, then
// PADD) gives the wrong series. Since the CPI crosswalk is built from the exact
// BLS CPI metro CBSAs (2013 OMB delineation), the CPI→city chain only fires for
// counties inside those metros, so nearly every county gets the right series
// without an override. (The previous ~770 distance-based overrides were all
// equivalent to the default chain and were removed.)
//
// Cleveland has an EIA city series but is not a BLS CPI metro, so its counties
// (Cleveland-Elyria MSA) are mapped explicitly.
export const COUNTY_EIA_CITY_OVERRIDES: Record<string, { duoarea: string; label: string }> = {
  '39035': { duoarea: 'YCLE', label: 'Cleveland area avg' }, // Cuyahoga County
  '39055': { duoarea: 'YCLE', label: 'Cleveland area avg' }, // Geauga County
  '39085': { duoarea: 'YCLE', label: 'Cleveland area avg' }, // Lake County
  '39093': { duoarea: 'YCLE', label: 'Cleveland area avg' }, // Lorain County
  '39103': { duoarea: 'YCLE', label: 'Cleveland area avg' }, // Medina County
}

// --- Tier 2: State-level EIA data (the 9 states EIA publishes) ---

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

// PADD 5 note: every PADD 5 state that reaches the PADD tier (AZ, NV, OR, AK,
// HI) is outside California — CA and WA always resolve to their state series
// (SCA / SWA) first. So PADD 5 maps to R5XCA "PADD 5 except California", whose
// prices track those states far better than the CA-dominated R50 average.
// (EIA has no AK or HI series; R5XCA is still only an approximation there.)
export const PAD_NAMES: Record<string | number, string> = {
  '1A': 'New England (PADD 1A)',
  '1B': 'Central Atlantic (PADD 1B)',
  '1C': 'Lower Atlantic (PADD 1C)',
  2: 'Midwest (PADD 2)',
  3: 'Gulf Coast (PADD 3)',
  4: 'Rocky Mountain (PADD 4)',
  5: 'West Coast excl. California (PADD 5)',
}

export const PAD_DUOAREA: Record<string | number, string> = {
  '1A': 'R1X',
  '1B': 'R1Y',
  '1C': 'R1Z',
  2: 'R20',
  3: 'R30',
  4: 'R40',
  5: 'R5XCA',
}
