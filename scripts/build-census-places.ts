#!/usr/bin/env npx tsx
/**
 * build-census-places.ts
 *
 * Fetches city-level median household income from the Census ACS 2023
 * 5-year estimates (place-level geography) and writes it to
 * src/lib/data/census-places.json.
 *
 * Fields fetched:
 *   B19013_001E — Median household income
 *
 * Requires CENSUS_API_KEY environment variable (set in .env.local or externally).
 *
 * Run with: npx tsx scripts/build-census-places.ts
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Env loader — reads .env.local manually so we don't need dotenv installed
// ---------------------------------------------------------------------------

function loadEnv() {
  try {
    const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex)
      let value = trimmed.slice(eqIndex + 1)
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  } catch {
    // .env.local not found — env vars should already be set externally
  }
}

loadEnv()

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CENSUS_API_KEY = process.env.CENSUS_API_KEY
const CENSUS_SENTINEL = -666666666

const OUTPUT_PATH = resolve(process.cwd(), 'src/lib/data/census-places.json')

// State FIPS codes for all 50 states + DC
const STATE_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09',
  DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17',
  IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24',
  MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31',
  NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38',
  OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46',
  TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54',
  WI: '55', WY: '56',
}

// State FIPS → state abbreviation (for reverse lookup)
const FIPS_TO_STATE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_FIPS).map(([abbr, fips]) => [fips, abbr])
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlaceEntry {
  medianIncome: number
  year: number
}

// ---------------------------------------------------------------------------
// Fetch one state's place-level data
// ---------------------------------------------------------------------------

async function fetchStatePlaces(
  stateFips: string,
  stateAbbr: string
): Promise<Array<{ city: string; state: string; medianIncome: number }>> {
  const variable = 'B19013_001E'
  const forClause = encodeURIComponent('place:*')
  const inClause = encodeURIComponent(`state:${stateFips}`)
  let url = `https://api.census.gov/data/2023/acs/acs5?get=NAME,${variable}&for=${forClause}&in=${inClause}`
  if (CENSUS_API_KEY) {
    url += `&key=${CENSUS_API_KEY}`
  }

  const response = await fetch(url)
  if (!response.ok) {
    console.warn(`  State ${stateAbbr} (${stateFips}): HTTP ${response.status} — skipping`)
    return []
  }

  const raw: string[][] = await response.json()
  const headers = raw[0]
  const rows = raw.slice(1)

  const nameIdx = headers.indexOf('NAME')
  const incomeIdx = headers.indexOf(variable)

  if (nameIdx === -1 || incomeIdx === -1) {
    console.warn(`  State ${stateAbbr}: unexpected headers: ${JSON.stringify(headers)}`)
    return []
  }

  const results: Array<{ city: string; state: string; medianIncome: number }> = []

  for (const row of rows) {
    const name = row[nameIdx] // e.g. "San Francisco city, California"
    const incomeRaw = row[incomeIdx]

    const income = incomeRaw === null ? null : Number(incomeRaw)
    if (income === null || income === CENSUS_SENTINEL || isNaN(income) || income <= 0) {
      continue
    }

    // Extract city name from "City Name city, State Name" or "City Name town, State Name"
    // Strip suffixes: city, town, village, CDP, borough, municipality, etc.
    const commaIdx = name.indexOf(',')
    if (commaIdx === -1) continue
    const placePart = name.slice(0, commaIdx).trim()
    // Remove common place-type suffixes
    const cityName = placePart
      .replace(/\s+(city|town|village|CDP|borough|municipality|consolidated government|urban county|metro government|metro|unified government|charter township|township|plantation|comunidad|zona urbana|base|pueblo|reservation|rancheria|colony)\s*$/i, '')
      .trim()

    results.push({
      city: cityName.toLowerCase(),
      state: stateAbbr.toLowerCase(),
      medianIncome: income,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!CENSUS_API_KEY) {
    console.log('WARNING: No CENSUS_API_KEY found — proceeding without key (may be rate-limited).')
  } else {
    console.log('Using CENSUS_API_KEY from environment.')
  }

  console.log('Fetching Census ACS 2023 5-year place-level estimates for all states...')

  const allEntries: Record<string, { medianIncome: number; year: number }> = {}
  let totalPlaces = 0
  let statesProcessed = 0

  const stateEntries = Object.entries(STATE_FIPS)

  for (const [stateAbbr, stateFips] of stateEntries) {
    process.stdout.write(`  ${stateAbbr}... `)
    const places = await fetchStatePlaces(stateFips, stateAbbr)
    for (const place of places) {
      const key = `${place.city}|${place.state}`
      // If duplicate city name in same state, keep the one with higher income
      // (usually the larger/primary place)
      if (!allEntries[key] || place.medianIncome > allEntries[key].medianIncome) {
        allEntries[key] = { medianIncome: place.medianIncome, year: 2023 }
      }
    }
    totalPlaces += places.length
    statesProcessed++
    console.log(`${places.length} places`)

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 200))
  }

  // Sort keys for clean diffs
  const sorted: Record<string, PlaceEntry> = {}
  for (const key of Object.keys(allEntries).sort()) {
    sorted[key] = allEntries[key]
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + '\n')

  console.log('\n--- Stats ---')
  console.log(`States processed:    ${statesProcessed}`)
  console.log(`Total places found:  ${totalPlaces}`)
  console.log(`Unique place keys:   ${Object.keys(sorted).length}`)
  console.log(`Written to:          ${OUTPUT_PATH}`)

  // Sample spot-checks
  const spotChecks = [
    'san francisco|ca',
    'new york|ny',
    'chicago|il',
    'detroit|mi',
    'seattle|wa',
    'st. louis|mo',
  ]
  console.log('\n--- Spot Checks ---')
  for (const key of spotChecks) {
    const entry = sorted[key]
    if (entry) {
      console.log(`  ${key}: income=$${entry.medianIncome.toLocaleString()}`)
    } else {
      console.log(`  ${key}: NOT FOUND`)
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
