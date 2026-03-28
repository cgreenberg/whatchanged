#!/usr/bin/env npx tsx
/**
 * build-cbsa-cpi-crosswalk.ts
 *
 * Downloads the NBER CBSA-to-FIPS county crosswalk CSV and combines it with
 * a hardcoded CBSA→CPI area mapping to produce a county FIPS → CPI area code
 * crosswalk JSON file.
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
  'https://data.nber.org/cbsa-csa-fips-county-crosswalk/2023/cbsa2fipsxw_2023.csv'

// ---------------------------------------------------------------------------
// CBSA → CPI area mapping
//
// Maps CBSA codes to the 23 BLS CPI metro area codes. Includes both primary
// CBSAs and known multi-CBSA expansions from BLS geographic sample definitions.
//
// IMPORTANT: Only use actual CBSA codes here, NOT metro division codes.
// Metro divisions (e.g., 31084 "Los Angeles-Long Beach-Glendale") share
// their parent CBSA code (31080) in the crosswalk, so counties in metro
// divisions are already captured by the parent CBSA entry.
// ---------------------------------------------------------------------------

const CBSA_TO_CPI: Record<string, string> = {
  // === S11A: Boston-Cambridge-Newton, MA-NH ===
  '14460': 'S11A', // Boston-Cambridge-Newton, MA-NH (primary)
  '39300': 'S11A', // Providence-Warwick, RI-MA
  '49340': 'S11A', // Worcester, MA-CT
  '44140': 'S11A', // Springfield, MA
  '38860': 'S11A', // Portland-South Portland, ME
  '31700': 'S11A', // Manchester-Nashua, NH

  // === S12A: New York-Newark-Jersey City, NY-NJ-PA ===
  '35620': 'S12A', // New York-Newark-Jersey City (primary)
  '14860': 'S12A', // Bridgeport-Stamford-Norwalk, CT
  '35300': 'S12A', // New Haven-Milford, CT
  '25540': 'S12A', // Hartford-East Hartford-Middletown, CT
  '45940': 'S12A', // Trenton-Princeton, NJ
  // 39100 (Poughkeepsie-Newburgh-Middletown) was retired/renamed in 2023
  // delineations — Dutchess County falls back to state-level NY → S12A

  // === S12B: Philadelphia-Camden-Wilmington, PA-NJ-DE-MD ===
  '37980': 'S12B', // Philadelphia-Camden-Wilmington (primary)
  '10900': 'S12B', // Allentown-Bethlehem-Easton, PA-NJ
  '39740': 'S12B', // Reading, PA
  '25420': 'S12B', // Harrisburg-Carlisle, PA
  '42540': 'S12B', // Scranton--Wilkes-Barre, PA
  '29540': 'S12B', // Lancaster, PA

  // === S23A: Chicago-Naperville-Elgin, IL-IN-WI ===
  '16980': 'S23A', // Chicago-Naperville-Elgin (primary)
  '40420': 'S23A', // Rockford, IL
  '33340': 'S23A', // Milwaukee-Waukesha, WI
  '26900': 'S23A', // Indianapolis-Carmel-Greenwood, IN
  '28450': 'S23A', // Kenosha, WI

  // === S23B: Detroit-Warren-Dearborn, MI ===
  '19820': 'S23B', // Detroit-Warren-Dearborn (primary)
  '24340': 'S23B', // Grand Rapids-Kentwood, MI
  '11460': 'S23B', // Ann Arbor, MI
  '17410': 'S23B', // Cleveland, OH
  '18140': 'S23B', // Columbus, OH
  '38300': 'S23B', // Pittsburgh, PA
  '15380': 'S23B', // Buffalo-Cheektowaga, NY
  '22420': 'S23B', // Flint, MI

  // === S24A: Minneapolis-St. Paul-Bloomington, MN-WI ===
  '33460': 'S24A', // Minneapolis-St. Paul-Bloomington (primary)
  '22020': 'S24A', // Fargo, ND-MN
  '43620': 'S24A', // Sioux Falls, SD-MN
  '19340': 'S24A', // Davenport-Moline-Rock Island, IA-IL
  '16300': 'S24A', // Cedar Rapids, IA
  '19780': 'S24A', // Des Moines-West Des Moines, IA

  // === S24B: St. Louis, MO-IL ===
  '41180': 'S24B', // St. Louis (primary)
  '28140': 'S24B', // Kansas City, MO-KS
  '17860': 'S24B', // Columbia, MO
  '17140': 'S24B', // Cincinnati, OH-KY-IN
  '30460': 'S24B', // Lexington-Fayette, KY
  '31140': 'S24B', // Louisville/Jefferson County, KY-IN
  '36540': 'S24B', // Omaha, NE-IA

  // === S35A: Washington-Arlington-Alexandria, DC-VA-MD-WV ===
  '47900': 'S35A', // Washington-Arlington-Alexandria (primary)

  // === S35B: Miami-Fort Lauderdale-West Palm Beach, FL ===
  '33100': 'S35B', // Miami-Fort Lauderdale-West Palm Beach (primary)
  '36740': 'S35B', // Orlando-Kissimmee-Sanford, FL
  '27260': 'S35B', // Jacksonville, FL
  '38940': 'S35B', // Port St. Lucie, FL
  '42680': 'S35B', // Sebastian-Vero Beach, FL
  '19660': 'S35B', // Deltona-Daytona Beach-Ormond Beach, FL
  '37340': 'S35B', // Palm Bay-Melbourne-Titusville, FL

  // === S35C: Atlanta-Sandy Springs-Roswell, GA ===
  '12060': 'S35C', // Atlanta-Sandy Springs-Roswell (primary)
  '16860': 'S35C', // Chattanooga, TN-GA
  '34980': 'S35C', // Nashville-Davidson--Murfreesboro--Franklin, TN
  '16740': 'S35C', // Charlotte-Concord-Gastonia, NC-SC
  '39580': 'S35C', // Raleigh-Cary, NC
  '24860': 'S35C', // Greenville-Anderson-Mauldin, SC
  '28940': 'S35C', // Knoxville, TN
  '32820': 'S35C', // Memphis, TN-MS-AR

  // === S35D: Tampa-St. Petersburg-Clearwater, FL ===
  '45300': 'S35D', // Tampa-St. Petersburg-Clearwater (primary)
  '29460': 'S35D', // Lakeland-Winter Haven, FL
  '35840': 'S35D', // North Port-Bradenton-Sarasota, FL
  '15980': 'S35D', // Cape Coral-Fort Myers, FL
  '34940': 'S35D', // Naples-Marco Island, FL
  '36100': 'S35D', // Ocala, FL

  // === S35E: Baltimore-Columbia-Towson, MD ===
  '12580': 'S35E', // Baltimore-Columbia-Towson (primary)

  // === S37A: Dallas-Fort Worth-Arlington, TX ===
  '19100': 'S37A', // Dallas-Fort Worth-Arlington (primary)
  '12420': 'S37A', // Austin-Round Rock-Georgetown, TX
  '41700': 'S37A', // San Antonio-New Braunfels, TX

  // === S37B: Houston-The Woodlands-Sugar Land, TX ===
  '26420': 'S37B', // Houston-The Woodlands-Sugar Land (primary)
  '13140': 'S37B', // Beaumont-Port Arthur, TX
  '47020': 'S37B', // Victoria, TX
  '17780': 'S37B', // College Station-Bryan, TX

  // === S48A: Phoenix-Mesa-Scottsdale, AZ ===
  '38060': 'S48A', // Phoenix-Mesa-Scottsdale (primary)
  '46060': 'S48A', // Tucson, AZ
  '29820': 'S48A', // Las Vegas-Henderson-Paradise, NV
  '29420': 'S48A', // Lake Havasu City-Kingman, AZ
  '39150': 'S48A', // Prescott Valley-Prescott, AZ
  '22380': 'S48A', // Flagstaff, AZ

  // === S48B: Denver-Aurora-Lakewood, CO ===
  '19740': 'S48B', // Denver-Aurora-Lakewood (primary)
  '17820': 'S48B', // Colorado Springs, CO
  '41620': 'S48B', // Salt Lake City, UT
  '14500': 'S48B', // Boulder, CO
  '24540': 'S48B', // Greeley, CO
  '39340': 'S48B', // Provo-Orem-Lehi, UT
  '36260': 'S48B', // Ogden, UT

  // === S49A: Los Angeles-Long Beach-Anaheim, CA ===
  '31080': 'S49A', // Los Angeles-Long Beach-Anaheim (primary)
  '37100': 'S49A', // Oxnard-Thousand Oaks-Ventura, CA
  '42200': 'S49A', // Santa Maria-Santa Barbara, CA
  '42020': 'S49A', // San Luis Obispo-Paso Robles, CA
  '12540': 'S49A', // Bakersfield-Delano, CA

  // === S49B: San Francisco-Oakland-Hayward, CA ===
  '41860': 'S49B', // San Francisco-Oakland-Hayward (primary)
  '41940': 'S49B', // San Jose-Sunnyvale-Santa Clara, CA
  '42100': 'S49B', // Santa Cruz-Watsonville, CA
  '34900': 'S49B', // Napa, CA
  '46700': 'S49B', // Vallejo, CA
  '40900': 'S49B', // Sacramento-Roseville-Folsom, CA
  '44700': 'S49B', // Stockton-Lodi, CA
  '33700': 'S49B', // Modesto, CA
  '32900': 'S49B', // Merced, CA
  '42220': 'S49B', // Santa Rosa-Petaluma, CA

  // === S49C: Riverside-San Bernardino-Ontario, CA ===
  '40140': 'S49C', // Riverside-San Bernardino-Ontario (primary)

  // === S49D: Seattle-Tacoma-Bellevue, WA ===
  '42660': 'S49D', // Seattle-Tacoma-Bellevue (primary)
  '38900': 'S49D', // Portland-Vancouver-Hillsboro, OR-WA
  '14740': 'S49D', // Bremerton-Silverdale-Port Orchard, WA
  '36500': 'S49D', // Olympia-Lacey-Tumwater, WA

  // === S49E: San Diego-Carlsbad, CA ===
  '41740': 'S49E', // San Diego-Carlsbad (primary)
  '20940': 'S49E', // El Centro, CA (Imperial County)

  // === S49F: Urban Hawaii (Honolulu) ===
  '46520': 'S49F', // Urban Honolulu, HI (primary)

  // === S49G: Urban Alaska (Anchorage) ===
  '11260': 'S49G', // Anchorage, AK (primary)
}

// ---------------------------------------------------------------------------
// Connecticut old→new FIPS mapping
// CT abolished counties in 2022; Census/OMB now uses Planning Region FIPS
// (09110-09190) but HUD crosswalk still uses old county FIPS (09001-09015).
// We generate entries for both so lookups work regardless of which FIPS
// the caller has.
// ---------------------------------------------------------------------------

const CT_OLD_TO_NEW: Record<string, string[]> = {
  '09001': ['09110'], // Fairfield → Western CT Planning Region
  '09003': ['09120'], // Hartford → Capitol Planning Region
  '09005': ['09130'], // Litchfield → Northwest Hills Planning Region
  '09007': ['09140'], // Middlesex → Lower CT River Valley Planning Region
  '09009': ['09150'], // New Haven → South Central CT Planning Region
  '09011': ['09160'], // New London → Southeastern CT Planning Region
  '09013': ['09170'], // Tolland → Capitol Planning Region (shares)
  '09015': ['09180'], // Windham → Northeastern CT Planning Region
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

  // Handle Connecticut: propagate CPI mappings from new planning region
  // FIPS to old county FIPS (and vice versa) so lookups work with either.
  for (const [oldFips, newFipsList] of Object.entries(CT_OLD_TO_NEW)) {
    if (!result[oldFips]) {
      for (const newFips of newFipsList) {
        if (result[newFips]) {
          result[oldFips] = result[newFips]
          break
        }
      }
    }
    // Also propagate old→new if the CSV used old FIPS
    for (const newFips of newFipsList) {
      if (!result[newFips] && result[oldFips]) {
        result[newFips] = result[oldFips]
      }
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
  ]
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
