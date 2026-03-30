/**
 * Exhaustive mapping test: every zip in zip-county.json resolves through the
 * full mapping chain (county FIPS, CPI area, EIA gas, LAUS series, census).
 *
 * Collects ALL failures into an array so every broken zip is reported in one run.
 */

import { getGasLookup } from '@/lib/api/eia'
import { buildSeriesId } from '@/lib/api/bls'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import zipCounty from '@/lib/data/zip-county.json'
import censusAcs from '@/lib/data/census-acs.json'

// --- Known valid sets ---

const VALID_CPI_AREA_CODES = new Set([
  // National
  '0000',
  // Metros (23)
  'S11A', 'S12A', 'S12B',
  'S23A', 'S23B', 'S24A', 'S24B',
  'S35A', 'S35B', 'S35C', 'S35D', 'S35E', 'S37A', 'S37B',
  'S48A', 'S48B', 'S49A', 'S49B', 'S49C', 'S49D', 'S49E', 'S49F', 'S49G',
  // Divisions (9)
  '0110', '0120', '0230', '0240', '0350', '0360', '0370', '0480', '0490',
  // Regions (4)
  '0100', '0200', '0300', '0400',
])

const VALID_EIA_DUOAREA_CODES = new Set([
  // Cities (10)
  'YBOS', 'Y35NY', 'YMIA', 'YORD', 'YCLE', 'Y44HO', 'YDEN', 'Y05LA', 'Y05SF', 'Y48SE',
  // States (9)
  'SCA', 'SCO', 'SFL', 'SMA', 'SMN', 'SNY', 'SOH', 'STX', 'SWA',
  // PADs (7)
  'R1X', 'R1Y', 'R1Z', 'R20', 'R30', 'R40', 'R50',
  // Special (3)
  'NUS', 'R5XCA', 'R10',
])

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
])

// --- Types ---

interface ZipEntry {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName?: string
}

interface CensusEntry {
  medianIncome: number
  medianRent: number
  year: number
}

describe('exhaustive zip mappings', () => {
  jest.setTimeout(120_000)

  it('every zip resolves through the full mapping chain', () => {
    const zips = zipCounty as Record<string, ZipEntry>
    const census = censusAcs as Record<string, CensusEntry>
    const failures: string[] = []

    // Tier distribution counters
    const cpiTierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
    const gasTierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
    let censusHits = 0
    let censusMisses = 0

    const zipCodes = Object.keys(zips)

    for (const zip of zipCodes) {
      const entry = zips[zip]
      const { countyFips, stateAbbr } = entry

      // 1. countyFips must be a 5-digit string
      if (!/^\d{5}$/.test(countyFips)) {
        failures.push(`${zip}: countyFips "${countyFips}" is not a 5-digit string`)
        continue
      }

      // 2. CPI area lookup
      const cpiArea = getMetroCpiAreaForCounty(countyFips, stateAbbr)

      if (!VALID_CPI_AREA_CODES.has(cpiArea.areaCode)) {
        failures.push(`${zip}: CPI areaCode "${cpiArea.areaCode}" not in valid set`)
      }

      if (![1, 2, 3, 4].includes(cpiArea.tier)) {
        failures.push(`${zip}: CPI tier ${cpiArea.tier} not in [1,2,3,4]`)
      }

      // US states (50 + DC) should never get tier 3 or 4 — only territories
      if (US_STATES.has(stateAbbr.toUpperCase()) && (cpiArea.tier === 3 || cpiArea.tier === 4)) {
        failures.push(
          `${zip}: US state ${stateAbbr} got CPI tier ${cpiArea.tier} (area: ${cpiArea.areaCode}, name: ${cpiArea.areaName})`
        )
      }

      cpiTierCounts[cpiArea.tier] = (cpiTierCounts[cpiArea.tier] ?? 0) + 1

      // 3. EIA gas lookup
      const gasLookup = getGasLookup(stateAbbr, cpiArea.areaCode, countyFips)

      if (!gasLookup.duoarea || !VALID_EIA_DUOAREA_CODES.has(gasLookup.duoarea)) {
        failures.push(`${zip}: EIA duoarea "${gasLookup.duoarea}" not in valid set`)
      }

      gasTierCounts[gasLookup.tier] = (gasTierCounts[gasLookup.tier] ?? 0) + 1

      // 4. LAUS series ID (with CT remapping via buildSeriesId)
      const lausId = buildSeriesId(countyFips)

      if (!/^LAUCN\d{5}0000000003$/.test(lausId)) {
        failures.push(`${zip}: LAUS series ID "${lausId}" does not match expected format`)
      }

      // 5. Census data (optional — not every zip has census data)
      const censusEntry = census[zip]
      if (censusEntry) {
        censusHits++
        if (!(censusEntry.medianIncome > 0)) {
          failures.push(`${zip}: census medianIncome ${censusEntry.medianIncome} is not > 0`)
        }
        if (!(censusEntry.medianRent > 0)) {
          failures.push(`${zip}: census medianRent ${censusEntry.medianRent} is not > 0`)
        }
      } else {
        censusMisses++
      }
    }

    // Print tier distribution summary
    console.log('\n=== Exhaustive Zip Mapping Summary ===')
    console.log(`Total zips: ${zipCodes.length}`)
    console.log(`\nCPI Tier Distribution:`)
    console.log(`  Tier 1 (metro):    ${cpiTierCounts[1]}`)
    console.log(`  Tier 2 (division): ${cpiTierCounts[2]}`)
    console.log(`  Tier 3 (regional): ${cpiTierCounts[3]}`)
    console.log(`  Tier 4 (national): ${cpiTierCounts[4]}`)
    console.log(`\nEIA Gas Tier Distribution:`)
    console.log(`  Tier 1 (city):  ${gasTierCounts[1]}`)
    console.log(`  Tier 2 (state): ${gasTierCounts[2]}`)
    console.log(`  Tier 3 (PAD):   ${gasTierCounts[3]}`)
    console.log(`\nCensus ACS:`)
    console.log(`  With data:    ${censusHits}`)
    console.log(`  Without data: ${censusMisses}`)

    if (failures.length > 0) {
      console.log(`\n=== FAILURES (${failures.length}) ===`)
      // Group failures by category
      const cpiFailures = failures.filter((f) => f.includes('CPI'))
      const gasFailures = failures.filter((f) => f.includes('EIA'))
      const lausFailures = failures.filter((f) => f.includes('LAUS'))
      const censusFailures = failures.filter((f) => f.includes('census'))
      const fipsFailures = failures.filter((f) => f.includes('countyFips'))

      if (fipsFailures.length) console.log(`\nFIPS failures (${fipsFailures.length}):`, fipsFailures.slice(0, 10))
      if (cpiFailures.length) console.log(`\nCPI failures (${cpiFailures.length}):`, cpiFailures.slice(0, 10))
      if (gasFailures.length) console.log(`\nGas failures (${gasFailures.length}):`, gasFailures.slice(0, 10))
      if (lausFailures.length) console.log(`\nLAUS failures (${lausFailures.length}):`, lausFailures.slice(0, 10))
      if (censusFailures.length) console.log(`\nCensus failures (${censusFailures.length}):`, censusFailures.slice(0, 10))
    }

    expect(failures).toEqual([])
  })
})
