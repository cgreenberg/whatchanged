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

import {
  getMetroCpiAreaForCounty,
  BLS_CPI_AREAS,
  STATE_TO_CPI_AREA,
  COUNTY_CPI_OVERRIDES,
} from '../src/lib/mappings/county-metro-cpi'

import {
  getGasLookup,
  CPI_TO_EIA_CITY,
  COUNTY_EIA_CITY_OVERRIDES,
  STATE_TO_PAD,
  PAD_NAMES,
} from '../src/lib/api/eia'

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
  cpiSource: 'county-override' | 'state-default' | 'national-fallback'
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

  const cpiSource: ZipAuditResult['cpiSource'] = COUNTY_CPI_OVERRIDES[countyFips]
    ? 'county-override'
    : STATE_TO_CPI_AREA[state]
    ? 'state-default'
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

// ---- Issue A: Missing state CPI mapping ----
const statesInData = new Set(results.map(r => r.stateAbbr))
const missingStateCpi: string[] = []
for (const state of statesInData) {
  if (!STATE_TO_CPI_AREA[state]) missingStateCpi.push(state)
}

// ---- Issue B: Missing PAD mapping ----
const missingPad: string[] = []
for (const state of statesInData) {
  if (STATE_TO_PAD[state] === undefined) missingPad.push(state)
}

// ---- Issue C: Gas tier downgrade ----
// For each CPI area that has city-level gas data, find counties that RESOLVE
// to that CPI area but land on a lower tier because their state default routes
// differently — i.e., counties whose state default CPI IS in CPI_TO_EIA_CITY
// but the state itself has a STATE_LEVEL_CODES entry that intercepts first.
//
// Also: find counties in states where the state default CPI IS in
// CPI_TO_EIA_CITY but the county resolves to a DIFFERENT CPI area (no override)
// so it misses city-level gas.
//
// Primary pattern (the Houston bug): county's state default IS a CPI area
// with city gas, but the county has a COUNTY_CPI_OVERRIDE pointing to a
// DIFFERENT CPI area — meaning it might get better or worse gas resolution.
//
// Secondary pattern: county has NO override, state default CPI has no city
// gas, but the county is actually in a metro whose CPI area DOES have city gas.
// We can't detect this perfectly without MSA data, but we can flag counties
// whose FIPS number is numerically adjacent to override counties in the same state.

interface GasTierDowngrade {
  countyFips: string
  countyName: string
  stateAbbr: string
  resolvedCpiArea: string
  resolvedCpiName: string
  gasTier: GasTier
  gasTierName: string
  issue: string
  suggestedFix: string
}

const gasTierDowngrades: GasTierDowngrade[] = []

// Pattern 2 (primary downgrade): county has a COUNTY_CPI_OVERRIDE pointing
// to a CPI area WITHOUT city gas, while the state default CPI area HAS city
// gas. This means the override is HURTING the gas resolution.
for (const county of uniqueCounties) {
  const hasOverride = !!COUNTY_CPI_OVERRIDES[county.countyFips]
  if (!hasOverride) continue

  const overrideCpi = COUNTY_CPI_OVERRIDES[county.countyFips]
  const stateDefaultCpi = STATE_TO_CPI_AREA[county.stateAbbr]

  const overrideHasCity = !!CPI_TO_EIA_CITY[overrideCpi]
  const stateDefaultHasCity = stateDefaultCpi ? !!CPI_TO_EIA_CITY[stateDefaultCpi] : false

  if (stateDefaultHasCity && !overrideHasCity) {
    gasTierDowngrades.push({
      countyFips: county.countyFips,
      countyName: county.countyName,
      stateAbbr: county.stateAbbr,
      resolvedCpiArea: overrideCpi,
      resolvedCpiName: BLS_CPI_AREAS[overrideCpi]?.name ?? overrideCpi,
      gasTier: county.gasTier,
      gasTierName: county.gasTierName,
      issue: `COUNTY_CPI_OVERRIDE → ${overrideCpi} (no city gas), but state default ${stateDefaultCpi} HAS city gas (${CPI_TO_EIA_CITY[stateDefaultCpi!].label})`,
      suggestedFix: `Add COUNTY_EIA_CITY_OVERRIDES['${county.countyFips}'] pointing to the correct city duoarea, OR reconsider the CPI override.`,
    })
  }
}

// Pattern 3 (the core Houston pattern): county has NO CPI override; state
// default CPI has city gas BUT the county is in a metro that should map to a
// DIFFERENT CPI area (one that also has city gas). We detect this by looking
// for counties numerically adjacent to existing CPI overrides in the same state
// that lack their own override. These are likely in the same MSA.
interface NearbyMissingOverride {
  countyFips: string
  countyName: string
  stateAbbr: string
  currentCpiArea: string
  currentCpiName: string
  nearbyOverrideFips: string
  nearbyOverrideName: string
  nearbyOverrideCpi: string
  nearbyOverrideCpiName: string
  gasTier: GasTier
}
const nearbyMissingOverrides: NearbyMissingOverride[] = []

// Group override counties by state+targetCpi
interface OverrideGroup {
  targetCpi: string
  fipsNumbers: number[]
  counties: Array<{ fips: string; name: string }>
}
const overridesByStateAndCpi = new Map<string, OverrideGroup>()

for (const [fips, cpiCode] of Object.entries(COUNTY_CPI_OVERRIDES)) {
  const state = fips.slice(0, 2) // FIPS state prefix (numeric)
  const key = `${state}:${cpiCode}`
  if (!overridesByStateAndCpi.has(key)) {
    overridesByStateAndCpi.set(key, { targetCpi: cpiCode, fipsNumbers: [], counties: [] })
  }
  const group = overridesByStateAndCpi.get(key)!
  group.fipsNumbers.push(parseInt(fips))
  group.counties.push({ fips, name: countyMap.get(fips)?.countyName ?? fips })
}

// For each non-override county in the same state (numeric FIPS prefix),
// check if it's within 50 FIPS units of an override county targeting a CPI
// area that HAS city gas. (Counties in the same state share the same 2-digit
// FIPS prefix, and MSA counties often have adjacent numeric codes.)
const FIPS_PROXIMITY_THRESHOLD = 50

for (const county of uniqueCounties) {
  if (COUNTY_CPI_OVERRIDES[county.countyFips]) continue // already overridden
  if (county.gasTier === 1) continue // already getting city gas — no issue

  const statePrefix = county.countyFips.slice(0, 2)
  const countyNum = parseInt(county.countyFips)

  for (const [key, group] of overridesByStateAndCpi) {
    if (!key.startsWith(statePrefix + ':')) continue
    if (!CPI_TO_EIA_CITY[group.targetCpi]) continue // target CPI has no city gas — skip

    const closestDistance = Math.min(...group.fipsNumbers.map(n => Math.abs(n - countyNum)))
    if (closestDistance > 0 && closestDistance <= FIPS_PROXIMITY_THRESHOLD) {
      const nearestOverrideFips = group.counties.reduce((best, c) => {
        const dist = Math.abs(parseInt(c.fips) - countyNum)
        return dist < Math.abs(parseInt(best.fips) - countyNum) ? c : best
      })
      nearbyMissingOverrides.push({
        countyFips: county.countyFips,
        countyName: county.countyName,
        stateAbbr: county.stateAbbr,
        currentCpiArea: county.cpiAreaCode,
        currentCpiName: county.cpiAreaName,
        nearbyOverrideFips: nearestOverrideFips.fips,
        nearbyOverrideName: nearestOverrideFips.name,
        nearbyOverrideCpi: group.targetCpi,
        nearbyOverrideCpiName: BLS_CPI_AREAS[group.targetCpi]?.name ?? group.targetCpi,
        gasTier: county.gasTier,
      })
    }
  }
}

// ---- Issue D: CPI metros whose city gas data is available but some
// counties in those states resolve to a non-city gas tier ----
// For each CPI area in CPI_TO_EIA_CITY, show how many counties reach it
// vs. how many counties in the same state fall to state/PAD tier.
interface CpiGasCoverageGap {
  cpiAreaCode: string
  cpiAreaName: string
  cityGasLabel: string
  states: string[]
  countiesWithCityGas: number
  countiesWithoutCityGas: number
  exampleMissingCounties: Array<{ fips: string; name: string; state: string; gasTierName: string }>
}
const cpiGasCoverageGaps: CpiGasCoverageGap[] = []

for (const [cpiCode, cityData] of Object.entries(CPI_TO_EIA_CITY)) {
  // Find all states whose default maps to this CPI area
  const statesWithThisCpiDefault = Object.entries(STATE_TO_CPI_AREA)
    .filter(([, code]) => code === cpiCode)
    .map(([state]) => state)

  // Find all counties (via override) that explicitly map to this CPI area
  const statesViaOverride = new Set(
    Object.entries(COUNTY_CPI_OVERRIDES)
      .filter(([, code]) => code === cpiCode)
      .map(([fips]) => countyMap.get(fips)?.stateAbbr ?? '')
      .filter(Boolean)
  )

  const relevantStates = [...new Set([...statesWithThisCpiDefault, ...statesViaOverride])]

  const relevantCounties = uniqueCounties.filter(c => relevantStates.includes(c.stateAbbr))
  const withCity = relevantCounties.filter(c => c.cpiAreaCode === cpiCode)
  const withoutCity = relevantCounties.filter(c => c.cpiAreaCode !== cpiCode && c.gasTier !== 1)

  // Only report if there's a meaningful gap
  if (withoutCity.length > 0 && withCity.length > 0) {
    cpiGasCoverageGaps.push({
      cpiAreaCode: cpiCode,
      cpiAreaName: BLS_CPI_AREAS[cpiCode]?.name ?? cpiCode,
      cityGasLabel: cityData.label,
      states: relevantStates,
      countiesWithCityGas: withCity.length,
      countiesWithoutCityGas: withoutCity.length,
      exampleMissingCounties: withoutCity.slice(0, 5).map(c => ({
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
h2('ISSUE A — MISSING STATE CPI MAPPING (falls back to national CPI)')

if (missingStateCpi.length === 0) {
  console.log('  PASS: All states in zip data have a STATE_TO_CPI_AREA entry.')
} else {
  missingStateCpi.sort().forEach(state => {
    const zipsInState = results.filter(r => r.stateAbbr === state).length
    console.log(`  MISSING: ${state} — ${zipsInState.toLocaleString()} zips fall back to National CPI`)
    console.log(`    FIX: Add ${state} to STATE_TO_CPI_AREA in county-metro-cpi.ts`)
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
h2('ISSUE C — GAS TIER DOWNGRADE: CPI override hurts gas resolution')
console.log('  (County has COUNTY_CPI_OVERRIDE pointing to a CPI area WITHOUT city gas,')
console.log('   while the state default CPI area HAS city gas)')

if (gasTierDowngrades.length === 0) {
  console.log('\n  PASS: No counties found where a CPI override causes a gas tier downgrade.')
} else {
  for (const d of gasTierDowngrades) {
    console.log(`\n  COUNTY: ${d.countyFips} — ${d.countyName}, ${d.stateAbbr}`)
    console.log(`    Issue:  ${d.issue}`)
    console.log(`    Gas:    Tier ${d.gasTier} (${d.gasTierName})`)
    console.log(`    Fix:    ${d.suggestedFix}`)
  }
}

// ---------------------------------------------------------------------------
h2('ISSUE D — POSSIBLE MISSING CPI OVERRIDES (counties adjacent to override counties)')
console.log('  (Counties within FIPS ±50 of an overridden county in the same state,')
console.log('   suggesting they may be in the same MSA but lack an override)')

if (nearbyMissingOverrides.length === 0) {
  console.log('\n  PASS: No numerically adjacent counties found missing overrides.')
} else {
  // Group by state + targetCpi for readability
  const grouped = new Map<string, NearbyMissingOverride[]>()
  for (const r of nearbyMissingOverrides) {
    const key = `${r.stateAbbr}:${r.nearbyOverrideCpi}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(r)
  }

  for (const [key, items] of grouped) {
    const first = items[0]
    console.log(`\n  METRO: ${first.nearbyOverrideCpiName} (${first.nearbyOverrideCpi}) — ${first.stateAbbr}`)
    console.log(`    City gas available via: ${CPI_TO_EIA_CITY[first.nearbyOverrideCpi]?.label}`)
    console.log(`    Counties possibly in MSA but missing CPI override (gas tier ${items[0].gasTier}):`)
    for (const item of items) {
      console.log(`      ${item.countyFips} ${item.countyName} (currently → ${item.currentCpiName})`)
    }
    console.log(`    Adjacent override anchor: ${first.nearbyOverrideFips} (${first.nearbyOverrideName})`)
    console.log(`    FIX: Verify if these counties are in the ${first.nearbyOverrideCpiName} MSA.`)
    console.log(`         If so, add to COUNTY_CPI_OVERRIDES: { '${items.map(i => i.countyFips).join("': '") + "': '" + first.nearbyOverrideCpi}' }`)
  }
}

// ---------------------------------------------------------------------------
h2('ISSUE E — CPI AREA GAS COVERAGE GAPS')
console.log('  (CPI areas with city-level gas data where some counties in the same')
console.log('   state resolve to a different CPI area and miss city gas)')

if (cpiGasCoverageGaps.length === 0) {
  console.log('\n  PASS: No coverage gaps detected.')
} else {
  for (const gap of cpiGasCoverageGaps) {
    console.log(`\n  CPI AREA: ${gap.cpiAreaCode} — ${gap.cpiAreaName}`)
    console.log(`    City gas: ${gap.cityGasLabel}`)
    console.log(`    States covered by this CPI: ${gap.states.join(', ')}`)
    console.log(`    Counties WITH city gas:    ${gap.countiesWithCityGas}`)
    console.log(`    Counties WITHOUT city gas: ${gap.countiesWithoutCityGas}`)
    console.log(`    Example counties missing city gas:`)
    for (const c of gap.exampleMissingCounties) {
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

h2('States with no CPI mapping (full national fallback)')
const nationalFallbackStates = [...statesInData].filter(s => !STATE_TO_CPI_AREA[s]).sort()
if (nationalFallbackStates.length === 0) {
  console.log('  None — all states have CPI coverage.')
} else {
  for (const state of nationalFallbackStates) {
    const count = results.filter(r => r.stateAbbr === state).length
    console.log(`  ${state}  —  ${count.toLocaleString()} zips fall back to National CPI`)
  }
}

h2('Counties with COUNTY_CPI_OVERRIDES')
const overrideCounties = Object.keys(COUNTY_CPI_OVERRIDES)
console.log(`  Total overridden counties: ${overrideCounties.length}`)
for (const fips of overrideCounties.sort()) {
  const cpiCode = COUNTY_CPI_OVERRIDES[fips]
  const countyEntry = countyMap.get(fips)
  const name = countyEntry ? `${countyEntry.countyName}, ${countyEntry.stateAbbr}` : '(not in zip data)'
  console.log(`  ${fips}  →  ${cpiCode} (${BLS_CPI_AREAS[cpiCode]?.name ?? cpiCode})  —  ${name}`)
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
