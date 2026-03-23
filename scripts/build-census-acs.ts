#!/usr/bin/env npx tsx
/**
 * build-census-acs.ts
 *
 * Fetches all ZCTA (zip code tabulation area) data from the Census ACS 2023
 * 5-year estimates and writes it to src/lib/data/census-acs.json.
 *
 * Fields fetched:
 *   B19013_001E — Median household income
 *   B25064_001E — Median gross rent
 *
 * Run with: npx tsx scripts/build-census-acs.ts
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
const NATIONAL_RENT_FALLBACK = 1271
const CENSUS_SENTINEL = -666666666

const OUTPUT_PATH = resolve(process.cwd(), 'src/lib/data/census-acs.json')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AcsEntry {
  medianIncome: number
  medianRent: number
  year: number
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const variables = 'B19013_001E,B25064_001E'
  const forClause = 'zip%20code%20tabulation%20area:*'
  let url = `https://api.census.gov/data/2023/acs/acs5?get=${variables}&for=${forClause}`
  if (CENSUS_API_KEY) {
    url += `&key=${CENSUS_API_KEY}`
    console.log('Using CENSUS_API_KEY from environment.')
  } else {
    console.log('No CENSUS_API_KEY found — proceeding without key (may be rate-limited).')
  }

  console.log('Fetching Census ACS 2023 5-year estimates for all ZCTAs...')
  console.log(`URL: ${url.replace(CENSUS_API_KEY ?? '', '[REDACTED]')}`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Census API request failed: ${response.status} ${response.statusText}`)
  }

  // Census returns a 2D array: first row is headers, rest are data rows
  const raw: string[][] = await response.json()

  const headers = raw[0]
  const rows = raw.slice(1)

  const incomeIdx = headers.indexOf('B19013_001E')
  const rentIdx = headers.indexOf('B25064_001E')
  const zipIdx = headers.indexOf('zip code tabulation area')

  if (incomeIdx === -1 || rentIdx === -1 || zipIdx === -1) {
    throw new Error(
      `Unexpected Census API response headers: ${JSON.stringify(headers)}`
    )
  }

  console.log(`Total rows returned from Census API: ${rows.length}`)

  let validIncome = 0
  let validRent = 0
  let skippedNoIncome = 0
  let rentFallbackUsed = 0

  const result: Record<string, AcsEntry> = {}

  for (const row of rows) {
    const zip = row[zipIdx]
    const incomeRaw = row[incomeIdx]
    const rentRaw = row[rentIdx]

    const income = incomeRaw === null ? null : Number(incomeRaw)
    const rent = rentRaw === null ? null : Number(rentRaw)

    // Skip entries where income is null or the Census suppression sentinel
    if (income === null || income === CENSUS_SENTINEL || isNaN(income)) {
      skippedNoIncome++
      continue
    }

    validIncome++

    let finalRent: number
    if (rent === null || rent === CENSUS_SENTINEL || isNaN(rent)) {
      finalRent = NATIONAL_RENT_FALLBACK
      rentFallbackUsed++
    } else {
      finalRent = rent
      validRent++
    }

    result[zip] = {
      medianIncome: income,
      medianRent: finalRent,
      year: 2023,
    }
  }

  // Sort keys for clean diffs
  const sorted: Record<string, AcsEntry> = {}
  for (const key of Object.keys(result).sort()) {
    sorted[key] = result[key]
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + '\n')

  console.log('\n--- Stats ---')
  console.log(`Total Census rows:          ${rows.length}`)
  console.log(`Entries with valid income:  ${validIncome}`)
  console.log(`Entries with valid rent:    ${validRent}`)
  console.log(`Entries using rent fallback:${rentFallbackUsed}`)
  console.log(`Entries skipped (no income):${skippedNoIncome}`)
  console.log(`Written to:                 ${OUTPUT_PATH}`)

  // Sample spot-checks
  const spotChecks = ['98683', '10001', '60601', '90210', '73301']
  console.log('\n--- Spot Checks ---')
  for (const zip of spotChecks) {
    const entry = sorted[zip]
    if (entry) {
      console.log(
        `  ${zip}: income=$${entry.medianIncome.toLocaleString()}  rent=$${entry.medianRent.toLocaleString()}`
      )
    } else {
      console.log(`  ${zip}: NOT FOUND`)
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
