/**
 * audit-zip-mappings.ts
 *
 * Audits every zip code in the HUD crosswalk for CPI and gas-tier mapping issues.
 * Run with: npx tsx scripts/audit-zip-mappings.ts
 *
 * This script makes NO API calls — it only reads static bundled data.
 */

import * as path from 'path'
import * as fs from 'fs'

// ---------------------------------------------------------------------------
// Imports from source files (relative paths — no @/ aliases needed at top level)
// ---------------------------------------------------------------------------

import cbsaCrosswalk from '../src/lib/data/cbsa-cpi-crosswalk.json'

import {
  getMetroCpiAreaForCounty,
  BLS_CPI_AREAS,
  STATE_TO_REGION,
} from '../src/lib/mappings/county-metro-cpi'

import { getGasLookup } from '../src/lib/api/eia'
import {
  CPI_TO_EIA_CITY,
  COUNTY_EIA_CITY_OVERRIDES,
  STATE_TO_PAD,
  PAD_NAMES,
} from '../src/lib/mappings/eia-gas'

// ---------------------------------------------------------------------------
// Load static zip-county data (relative path from scripts/ to src/lib/data/)
// ---------------------------------------------------------------------------

const ZIP_COUNTY_PATH = path.resolve(__dirname, '../src/lib/data/zip-county.json')

interface ZipEntry {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
}

const zipCountyData: Record<string, ZipEntry> = JSON.parse(
  fs.readFileSync(ZIP_COUNTY_PATH, 'utf-8')
)

// ---------------------------------------------------------------------------
// Analysis data structures
// ---------------------------------------------------------------------------

type GasTier = 1 | 2 | 3 | 'national'

interface ZipAuditResult {
  zip: string
  stateAbbr: string
  countyFips: string
  countyName: string
  cityName: string
  cpiAreaCode: string
  cpiAreaName: string
  gasDuoarea: string
  gasLabel: string
  gasTier: GasTier
  gasTierName: string
  cpiSource: 'cbsa-metro' | 'regional' | 'national-fallback'
}

// ---------------------------------------------------------------------------
// Run the audit
// ---------------------------------------------------------------------------

console.log('Loading zip-county data...')
const allZips = Object.keys(zipCountyData)
console.log(`Loaded ${allZips.length.toLocaleString()} zip codes.\n`)

const results: ZipAuditResult[] = []

for (const zip of allZips) {
  const entry = zipCountyData[zip]
  const { countyFips, countyName, stateAbbr, cityName } = entry
  const state = stateAbbr.toUpperCase()

  const cpi = getMetroCpiAreaForCounty(countyFips, state)
  const gasLookup = getGasLookup(state, cpi.areaCode, countyFips)

  // Determine audit-level tier: national fallback has duoarea 'NUS'
  const gasTier: GasTier = gasLookup.duoarea === 'NUS' ? 'national' : gasLookup.tier
  const gasTierName =
    gasLookup.duoarea === 'NUS'
      ? 'national'
      : gasLookup.tier === 1
      ? (() => {
          if (COUNTY_EIA_CITY_OVERRIDES[countyFips]) return 'city (county override)'
          return 'city (via CPI area)'
        })()
      : gasLookup.tier === 2
      ? 'state'
      : 'PAD district'

  const cpiSource: ZipAuditResult['cpiSource'] = (cbsaCrosswalk as Record<string, string>)[countyFips]
    ? 'cbsa-metro'
    : STATE_TO_REGION[state]
    ? 'regional'
    : 'national-fallback'

  results.push({
    zip,
    stateAbbr: state,
    countyFips,
    countyName,
    cityName,
    cpiAreaCode: cpi.areaCode,
    cpiAreaName: cpi.areaName,
    gasDuoarea: gasLookup.duoarea,
    gasLabel: gasLookup.geoLevel,
    gasTier,
    gasTierName,
    cpiSource,
  })
}

// ---------------------------------------------------------------------------
// Issue detection helpers
// ---------------------------------------------------------------------------

// Build a map of unique counties (fips → first result)
const countyMap = new Map<string, ZipAuditResult>()
for (const r of results) {
  if (!countyMap.has(r.countyFips)) countyMap.set(r.countyFips, r)
}
const uniqueCounties = Array.from(countyMap.values())

// ---- Issue A: Missing state regional CPI mapping ----
const statesInData = new Set(results.map(r => r.stateAbbr))
const missingRegionCpi: string[] = []
for (const state of statesInData) {
  if (!STATE_TO_REGION[state]) missingRegionCpi.push(state)
}

// ---- Issue B: Missing PAD mapping ----
const missingPad: string[] = []
for (const state of statesInData) {
  if (STATE_TO_PAD[state] === undefined) missingPad.push(state)
}

// ---- Issue C: Metro counties at regional/national CPI (CBSA crosswalk gaps) ----
// Counties that resolve to a metro CPI area via EIA gas (city tier 1) but
// whose CPI is coming from regional fallback instead of a CBSA metro — this
// indicates a gap in the CBSA crosswalk for that county.
interface CbsaGap {
  countyFips: string
  countyName: string
  stateAbbr: string
  cpiSource: ZipAuditResult['cpiSource']
  cpiAreaCode: string
  gasTier: GasTier
  gasTierName: string
}

const cbsaGaps: CbsaGap[] = []
for (const county of uniqueCounties) {
  // Flag counties that get city-level gas (tier 1 — they're clearly in a metro)
  // but are NOT in the CBSA crosswalk (they fall back to regional CPI).
  if (county.gasTier === 1 && county.cpiSource !== 'cbsa-metro') {
    cbsaGaps.push({
      countyFips: county.countyFips,
      countyName: county.countyName,
      stateAbbr: county.stateAbbr,
      cpiSource: county.cpiSource,
      cpiAreaCode: county.cpiAreaCode,
      gasTier: county.gasTier,
      gasTierName: county.gasTierName,
    })
  }
}

// ---- Issue D: CPI metros with city gas — counties that get the metro gas
// but are assigned only regional CPI (crosswalk may be missing them) ----
interface CpiGasCoverageGap {
  cpiAreaCode: string
  cpiAreaName: string
  cityGasLabel: string
  countiesWithMetroCpi: number
  countiesWithRegionalCpi: number
  exampleRegionalCounties: Array<{ fips: string; name: string; state: string; gasTierName: string }>
}
const cpiGasCoverageGaps: CpiGasCoverageGap[] = []

for (const [cpiCode, cityData] of Object.entries(CPI_TO_EIA_CITY)) {
  // Counties that have this metro CPI assignment (via CBSA)
  const withMetroCpi = uniqueCounties.filter(c => c.cpiAreaCode === cpiCode)
  // Counties that get this metro's city gas but have only regional CPI
  const withCityGasButRegionalCpi = uniqueCounties.filter(
    c => c.gasTier === 1 && c.gasDuoarea === cityData.duoarea && c.cpiAreaCode !== cpiCode
  )

  if (withCityGasButRegionalCpi.length > 0) {
    cpiGasCoverageGaps.push({
      cpiAreaCode: cpiCode,
      cpiAreaName: BLS_CPI_AREAS[cpiCode]?.name ?? cpiCode,
      cityGasLabel: cityData.label,
      countiesWithMetroCpi: withMetroCpi.length,
      countiesWithRegionalCpi: withCityGasButRegionalCpi.length,
      exampleRegionalCounties: withCityGasButRegionalCpi.slice(0, 5).map(c => ({
        fips: c.countyFips,
        name: c.countyName,
        state: c.stateAbbr,
        gasTierName: c.gasTierName,
      })),
    })
  }
}

// ---------------------------------------------------------------------------
// Coverage statistics
// ---------------------------------------------------------------------------

const tierCounts: Record<string, number> = { '1': 0, '2': 0, '3': 0, 'national': 0 }
const cpiAreaCounts: Record<string, number> = {}
const gasDuoareaCounts: Record<string, number> = {}

let nationalCpiFallback = 0

for (const r of results) {
  tierCounts[String(r.gasTier)] = (tierCounts[String(r.gasTier)] ?? 0) + 1
  cpiAreaCounts[r.cpiAreaCode] = (cpiAreaCounts[r.cpiAreaCode] ?? 0) + 1
  gasDuoareaCounts[r.gasDuoarea] = (gasDuoareaCounts[r.gasDuoarea] ?? 0) + 1
  if (r.cpiAreaCode === '0000') nationalCpiFallback++
}

const sortedCpiAreas = Object.entries(cpiAreaCounts).sort((a, b) => b[1] - a[1])
const sortedGasAreas = Object.entries(gasDuoareaCounts).sort((a, b) => b[1] - a[1])

// ---------------------------------------------------------------------------
// Report output
// ---------------------------------------------------------------------------

const SEP = '─'.repeat(80)
const HR = '═'.repeat(80)

function h1(title: string) {
  console.log(`\n${HR}`)
  console.log(`  ${title}`)
  console.log(HR)
}

function h2(title: string) {
  console.log(`\n${SEP}`)
  console.log(`  ${title}`)
  console.log(SEP)
}

h1('ZIP CODE MAPPING AUDIT REPORT')
console.log(`  Total zip codes:  ${results.length.toLocaleString()}`)
console.log(`  Unique counties:  ${uniqueCounties.length.toLocaleString()}`)
console.log(`  Unique states:    ${statesInData.size}`)

// ---------------------------------------------------------------------------
h2('ISSUE A — MISSING STATE REGIONAL CPI MAPPING (falls back to national CPI)')

if (missingRegionCpi.length === 0) {
  console.log('  PASS: All states in zip data have a STATE_TO_REGION entry.')
} else {
  missingRegionCpi.sort().forEach(state => {
    const zipsInState = results.filter(r => r.stateAbbr === state).length
    console.log(`  MISSING: ${state} — ${zipsInState.toLocaleString()} zips fall back to National CPI`)
    console.log(`    FIX: Add ${state} to STATE_TO_REGION in county-metro-cpi.ts`)
  })
}

// ---------------------------------------------------------------------------
h2('ISSUE B — MISSING STATE PAD MAPPING (falls back to national gas)')

if (missingPad.length === 0) {
  console.log('  PASS: All states in zip data have a STATE_TO_PAD entry.')
} else {
  missingPad.sort().forEach(state => {
    const zipsInState = results.filter(r => r.stateAbbr === state).length
    console.log(`  MISSING: ${state} — ${zipsInState.toLocaleString()} zips fall back to National gas`)
    console.log(`    FIX: Add ${state} to STATE_TO_PAD in eia.ts`)
  })
}

// ---------------------------------------------------------------------------
h2('ISSUE C — CBSA CROSSWALK GAPS: metro counties missing from CBSA crosswalk')
console.log('  (Counties that get city-level gas — indicating they are in a metro —')
console.log('   but are NOT in the CBSA crosswalk, so they fall back to regional CPI)')

if (cbsaGaps.length === 0) {
  console.log('\n  PASS: All counties with city-level gas have a CBSA metro CPI assignment.')
} else {
  console.log(`\n  ${cbsaGaps.length} counties get city gas but only regional CPI:`)
  for (const g of cbsaGaps.sort((a, b) => a.countyFips.localeCompare(b.countyFips))) {
    console.log(`  ${g.countyFips} ${g.countyName}, ${g.stateAbbr}  →  CPI: ${g.cpiAreaCode} (${g.cpiSource})  gas: ${g.gasTierName}`)
    console.log(`    FIX: Add '${g.countyFips}' to cbsa-cpi-crosswalk.json with the correct metro CPI code.`)
  }
}

// ---------------------------------------------------------------------------
h2('ISSUE D — CPI AREA GAS COVERAGE GAPS')
console.log('  (Metro CPI areas with city-level gas where some counties get city gas')
console.log('   but have only regional CPI — likely missing from CBSA crosswalk)')

if (cpiGasCoverageGaps.length === 0) {
  console.log('\n  PASS: No coverage gaps detected.')
} else {
  for (const gap of cpiGasCoverageGaps) {
    console.log(`\n  CPI AREA: ${gap.cpiAreaCode} — ${gap.cpiAreaName}`)
    console.log(`    City gas: ${gap.cityGasLabel}`)
    console.log(`    Counties with metro CPI (via CBSA):  ${gap.countiesWithMetroCpi}`)
    console.log(`    Counties with city gas but regional CPI: ${gap.countiesWithRegionalCpi}`)
    console.log(`    Example counties missing CBSA entry:`)
    for (const c of gap.exampleRegionalCounties) {
      console.log(`      ${c.fips} ${c.name}, ${c.state} → gas tier: ${c.gasTierName}`)
    }
  }
}

// ---------------------------------------------------------------------------
h1('COVERAGE SUMMARY')

h2('Gas price resolution by tier (zip count)')
console.log(`  Tier 1 — City-level:        ${(tierCounts['1'] ?? 0).toLocaleString().padStart(7)} zips  (most granular)`)
console.log(`  Tier 2 — State-level:       ${(tierCounts['2'] ?? 0).toLocaleString().padStart(7)} zips`)
console.log(`  Tier 3 — PAD District:      ${(tierCounts['3'] ?? 0).toLocaleString().padStart(7)} zips`)
console.log(`  National fallback:          ${(tierCounts['national'] ?? 0).toLocaleString().padStart(7)} zips  (worst)`)

h2('CPI area coverage (zip count)')
for (const [code, count] of sortedCpiAreas) {
  const name = code === '0000' ? 'National (fallback)' : BLS_CPI_AREAS[code]?.name ?? code
  console.log(`  ${code}  ${name.padEnd(40)}  ${count.toLocaleString().padStart(7)} zips`)
}
console.log(`\n  Total zips falling back to National CPI: ${nationalCpiFallback.toLocaleString()}`)

h2('Gas duoarea coverage (zip count)')
for (const [duoarea, count] of sortedGasAreas) {
  // Find label from results
  const sample = results.find(r => r.gasDuoarea === duoarea)
  const label = sample?.gasLabel ?? duoarea
  console.log(`  ${duoarea.padEnd(8)}  ${label.padEnd(35)}  ${count.toLocaleString().padStart(7)} zips`)
}

h2('States with no regional CPI mapping (full national fallback)')
const nationalFallbackStates = [...statesInData].filter(s => !STATE_TO_REGION[s]).sort()
if (nationalFallbackStates.length === 0) {
  console.log('  None — all states have regional CPI coverage.')
} else {
  for (const state of nationalFallbackStates) {
    const count = results.filter(r => r.stateAbbr === state).length
    console.log(`  ${state}  —  ${count.toLocaleString()} zips fall back to National CPI`)
  }
}

h2('CPI source breakdown (zip count)')
const cpiSourceCounts: Record<string, number> = {}
for (const r of results) {
  cpiSourceCounts[r.cpiSource] = (cpiSourceCounts[r.cpiSource] ?? 0) + 1
}
for (const [source, count] of Object.entries(cpiSourceCounts).sort()) {
  console.log(`  ${source.padEnd(20)}  ${count.toLocaleString().padStart(7)} zips`)
}

h2('Counties with COUNTY_EIA_CITY_OVERRIDES')
const eiaOverrideCounties = Object.keys(COUNTY_EIA_CITY_OVERRIDES)
console.log(`  Total EIA city-override counties: ${eiaOverrideCounties.length}`)
for (const fips of eiaOverrideCounties.sort()) {
  const entry = COUNTY_EIA_CITY_OVERRIDES[fips]
  const countyEntry = countyMap.get(fips)
  const name = countyEntry ? `${countyEntry.countyName}, ${countyEntry.stateAbbr}` : '(not in zip data)'
  console.log(`  ${fips}  →  ${entry.duoarea} (${entry.label})  —  ${name}`)
}

console.log(`\n${HR}`)
console.log('  END OF REPORT')
console.log(HR)
