#!/usr/bin/env npx tsx
/**
 * build-cbsa-cpi-crosswalk.ts
 *
 * Downloads the NBER copy of the OMB **February 2013** CBSA delineation
 * (Bulletin 13-01) and combines it with a hardcoded CBSA→CPI area mapping to
 * produce a county FIPS → CPI area code crosswalk JSON file.
 *
 * Why 2013: the BLS 2018 CPI geographic revision defines its self-representing
 * metro areas using the 2013 OMB delineations. Later delineations (2018, 2020,
 * 2023) added/removed counties that BLS does NOT sample for those CPI areas
 * (e.g. 2023 drops Kenosha WI from Chicago and Pike PA / Orange & Dutchess NY
 * from New York, and adds San Jacinto TX to Houston).
 *
 * Connecticut: the 2013 delineation uses the legacy CT counties (09001–09015),
 * which is what zip-county.json uses. No CT county is in any CPI metro CBSA.
 *
 * Output: src/lib/data/cbsa-cpi-crosswalk.json
 * Run with: npx tsx scripts/build-cbsa-cpi-crosswalk.ts
 */

import { writeFileSync } from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// NBER CSV URL
// ---------------------------------------------------------------------------

const NBER_CSV_URL =
  'https://data.nber.org/cbsa-csa-fips-county-crosswalk/2013/cbsa2fipsxw2013.csv'

// ---------------------------------------------------------------------------
// CBSA → CPI area mapping
//
// Each CPI area = exactly one CBSA (the BLS "self-representing" metro).
// Source: BLS 2018 CPI geographic revision (CBSA codes/titles as of OMB 2013).
// Counties not in these 23 CBSAs fall to Census-division CPI (Tier 2).
// ---------------------------------------------------------------------------

const CBSA_TO_CPI: Record<string, string> = {
  '14460': 'S11A', // Boston-Cambridge-Newton, MA-NH
  '35620': 'S12A', // New York-Newark-Jersey City, NY-NJ-PA
  '37980': 'S12B', // Philadelphia-Camden-Wilmington, PA-NJ-DE-MD
  '16980': 'S23A', // Chicago-Naperville-Elgin, IL-IN-WI
  '19820': 'S23B', // Detroit-Warren-Dearborn, MI
  '33460': 'S24A', // Minneapolis-St. Paul-Bloomington, MN-WI
  '41180': 'S24B', // St. Louis, MO-IL
  '47900': 'S35A', // Washington-Arlington-Alexandria, DC-VA-MD-WV
  '33100': 'S35B', // Miami-Fort Lauderdale-West Palm Beach, FL
  '12060': 'S35C', // Atlanta-Sandy Springs-Roswell, GA
  '45300': 'S35D', // Tampa-St. Petersburg-Clearwater, FL
  '12580': 'S35E', // Baltimore-Columbia-Towson, MD
  '19100': 'S37A', // Dallas-Fort Worth-Arlington, TX
  '26420': 'S37B', // Houston-The Woodlands-Sugar Land, TX
  '38060': 'S48A', // Phoenix-Mesa-Scottsdale, AZ
  '19740': 'S48B', // Denver-Aurora-Lakewood, CO
  '31080': 'S49A', // Los Angeles-Long Beach-Anaheim, CA
  '41860': 'S49B', // San Francisco-Oakland-Hayward, CA
  '40140': 'S49C', // Riverside-San Bernardino-Ontario, CA
  '42660': 'S49D', // Seattle-Tacoma-Bellevue, WA
  '41740': 'S49E', // San Diego-Carlsbad, CA
  '46520': 'S49F', // Urban Honolulu, HI
  '11260': 'S49G', // Anchorage, AK
}

// ---------------------------------------------------------------------------
// CSV parser — handles quoted fields with embedded commas
// ---------------------------------------------------------------------------

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current.trim())
  return fields
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Fetching NBER CBSA-to-FIPS county crosswalk...')
  const response = await fetch(NBER_CSV_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch NBER CSV: ${response.status} ${response.statusText}`)
  }
  const csvText = await response.text()
  const lines = csvText.trim().split('\n')

  // Parse header
  const header = parseCSVLine(lines[0])
  const cbsaIdx = header.indexOf('cbsacode')
  const stateIdx = header.indexOf('fipsstatecode')
  const countyIdx = header.indexOf('fipscountycode')
  const metroMicroIdx = header.indexOf('metropolitanmicropolitanstatis')

  if (cbsaIdx === -1 || stateIdx === -1 || countyIdx === -1) {
    throw new Error(
      `Missing expected columns. Found: ${header.join(', ')}`
    )
  }

  console.log(`Parsed CSV header: ${header.length} columns, ${lines.length - 1} data rows`)

  // Build countyFips → cbsaCode map
  const countyToCBSA: Record<string, string> = {}
  let metroCount = 0
  let microCount = 0

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i])
    const cbsaCode = fields[cbsaIdx]
    const stateFips = fields[stateIdx]?.padStart(2, '0')
    const countyFips = fields[countyIdx]?.padStart(3, '0')
    const metroMicro = metroMicroIdx >= 0 ? fields[metroMicroIdx] : ''

    if (!cbsaCode || !stateFips || !countyFips) continue

    const fullFips = `${stateFips}${countyFips}`
    countyToCBSA[fullFips] = cbsaCode

    if (metroMicro.includes('Metropolitan')) metroCount++
    else microCount++
  }

  console.log(`County→CBSA map: ${Object.keys(countyToCBSA).length} counties`)
  console.log(`  Metropolitan: ${metroCount}, Micropolitan: ${microCount}`)

  // Compose: countyFips → CBSA → CPI area
  const result: Record<string, string> = {}
  let matched = 0
  let unmatched = 0

  for (const [countyFips, cbsaCode] of Object.entries(countyToCBSA)) {
    const cpiArea = CBSA_TO_CPI[cbsaCode]
    if (cpiArea) {
      result[countyFips] = cpiArea
      matched++
    } else {
      unmatched++
    }
  }

  // Sort by FIPS code
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(result).sort()) {
    sorted[key] = result[key]
  }

  // Write output
  const outPath = join(__dirname, '..', 'src', 'lib', 'data', 'cbsa-cpi-crosswalk.json')
  writeFileSync(outPath, JSON.stringify(sorted, null, 2) + '\n')

  // Summary
  console.log(`\nWrote ${Object.keys(sorted).length} county→CPI mappings to ${outPath}`)
  console.log(`  Matched to CPI area: ${matched}`)
  console.log(`  No CPI area (not in a CPI metro): ${unmatched}`)

  // Per-CPI area breakdown
  const areaCounts: Record<string, number> = {}
  for (const area of Object.values(sorted)) {
    areaCounts[area] = (areaCounts[area] || 0) + 1
  }
  console.log('\nCounties per CPI area:')
  for (const [area, count] of Object.entries(areaCounts).sort()) {
    console.log(`  ${area}: ${count} counties`)
  }

  // How many unique CBSAs matched
  const matchedCBSAs = new Set<string>()
  for (const [, cbsaCode] of Object.entries(countyToCBSA)) {
    if (CBSA_TO_CPI[cbsaCode]) matchedCBSAs.add(cbsaCode)
  }
  console.log(`\nMatched ${matchedCBSAs.size} unique CBSA codes out of ${Object.keys(CBSA_TO_CPI).length} in mapping`)

  // List unmatched CBSA codes (in our mapping but not in CSV)
  const csvCBSAs = new Set(Object.values(countyToCBSA))
  const unmatchedMappings = Object.keys(CBSA_TO_CPI).filter(c => !csvCBSAs.has(c))
  if (unmatchedMappings.length > 0) {
    console.log(`\nWarning: ${unmatchedMappings.length} CBSA codes in mapping not found in CSV:`)
    for (const code of unmatchedMappings) {
      console.log(`  ${code} → ${CBSA_TO_CPI[code]}`)
    }
  }

  // Verify known mappings
  const checks: [string, string, string][] = [
    ['36061', 'S12A', 'New York County (Manhattan)'],
    ['06037', 'S49A', 'Los Angeles County'],
    ['17031', 'S23A', 'Cook County (Chicago)'],
    ['53033', 'S49D', 'King County (Seattle)'],
    ['55059', 'S23A', 'Kenosha County WI (Chicago CBSA in 2013)'],
    ['42103', 'S12A', 'Pike County PA (New York CBSA in 2013)'],
    ['36071', 'S12A', 'Orange County NY (New York CBSA in 2013)'],
    ['36027', 'S12A', 'Dutchess County NY (New York CBSA in 2013)'],
    ['48221', 'S37A', 'Hood County TX (Dallas CBSA in 2013)'],
    ['48425', 'S37A', 'Somervell County TX (Dallas CBSA in 2013)'],
  ]
  // Counties that must NOT be in a CPI metro under the 2013 delineation
  for (const [fips, name] of [['48407', 'San Jacinto County TX']]) {
    const pass = !sorted[fips]
    console.log(`  ${pass ? '\u2713' : '\u2717'} ${fips} (${name}): ${sorted[fips] || 'not in a CPI metro'}`)
    if (!pass) process.exit(1)
  }
  console.log('\nVerification checks:')
  let allPass = true
  for (const [fips, expected, name] of checks) {
    const actual = sorted[fips]
    const pass = actual === expected
    const icon = pass ? '\u2713' : '\u2717'
    console.log(`  ${icon} ${fips} (${name}): ${actual || 'MISSING'} (expected ${expected})`)
    if (!pass) allPass = false
  }

  if (!allPass) {
    console.error('\nSome verification checks failed!')
    process.exit(1)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
