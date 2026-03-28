/**
 * audit-gas-assignments.ts
 *
 * Detects CPI→gas chain leaks: cases where a county's CPI area chains it to
 * an EIA city gas price that is too far away (>100 miles).
 *
 * This catches both cross-PAD leaks AND same-state-but-far-away leaks
 * (e.g. Austin TX getting Houston city gas via CPI chain).
 *
 * Run in report mode:  npx tsx scripts/audit-gas-assignments.ts
 * Run in apply mode:   npx tsx scripts/audit-gas-assignments.ts --apply
 *
 * This script makes NO API calls — it only reads static bundled data.
 */

import centroids from '../src/lib/data/county-centroids.json'
import {
  COUNTY_CPI_OVERRIDES,
  STATE_TO_CPI_AREA,
} from '../src/lib/mappings/county-metro-cpi'
import {
  CPI_TO_EIA_CITY,
  COUNTY_EIA_CITY_OVERRIDES,
  STATE_LEVEL_CODES,
  STATE_TO_PAD,
  PAD_DUOAREA,
  PAD_NAMES,
} from '../src/lib/mappings/eia-gas'

// ---------------------------------------------------------------------------
// EIA city coordinates for distance-based leak detection
// ---------------------------------------------------------------------------

const EIA_CITY_COORDS: Record<string, { lat: number; lng: number; state: string }> = {
  YBOS: { lat: 42.36, lng: -71.06, state: 'MA' },
  Y35NY: { lat: 40.71, lng: -74.01, state: 'NY' },
  YORD: { lat: 41.88, lng: -87.63, state: 'IL' },
  YCLE: { lat: 41.50, lng: -81.69, state: 'OH' },
  YDEN: { lat: 39.74, lng: -104.99, state: 'CO' },
  Y44HO: { lat: 29.76, lng: -95.37, state: 'TX' },
  Y05LA: { lat: 34.05, lng: -118.24, state: 'CA' },
  Y05SF: { lat: 37.77, lng: -122.42, state: 'CA' },
  YMIA: { lat: 25.76, lng: -80.19, state: 'FL' },
  Y48SE: { lat: 47.61, lng: -122.33, state: 'WA' },
}

const MAX_CITY_DISTANCE_MILES = 100

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CountyInfo {
  fips: string
  name: string
  state: string
}

interface ChainLeak {
  county: CountyInfo
  cpiArea: string
  distanceMiles: number
  currentGas: { duoarea: string; label: string; tier: string }
  shouldBe: { duoarea: string; label: string; tier: string }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Haversine distance in miles */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getCpiArea(countyFips: string, state: string): string {
  return COUNTY_CPI_OVERRIDES[countyFips] ?? STATE_TO_CPI_AREA[state] ?? ''
}

function getCountyPad(state: string): string {
  const pad = STATE_TO_PAD[state]
  return pad != null ? String(pad) : ''
}

/**
 * Simulate the gas lookup chain and return what the county currently gets.
 * Returns null if the county has a Tier 1a override (already handled).
 */
function simulateCurrentGas(
  countyFips: string,
  cpiArea: string,
  state: string
): { duoarea: string; label: string; tier: string } | null {
  // Tier 1a: direct county override — skip
  if (COUNTY_EIA_CITY_OVERRIDES[countyFips]) {
    return null
  }

  // Tier 1b: CPI metro → EIA city
  const cityMapping = CPI_TO_EIA_CITY[cpiArea]
  if (cityMapping) {
    return { ...cityMapping, tier: '1b' }
  }

  // Tier 2: state-level
  const stateMapping = STATE_LEVEL_CODES[state]
  if (stateMapping) {
    return { ...stateMapping, tier: '2' }
  }

  // Tier 3: PAD fallback
  const pad = getCountyPad(state)
  if (pad) {
    const duoarea = PAD_DUOAREA[pad]
    const padName = PAD_NAMES[pad] ?? `PAD ${pad}`
    return { duoarea, label: `${padName} avg`, tier: '3' }
  }

  return null
}

/**
 * Determine what the county SHOULD get, ignoring the CPI→city chain.
 * This is what they'd get if Tier 1b didn't exist for them.
 */
function getCorrectGas(
  state: string
): { duoarea: string; label: string; tier: string } {
  // Tier 2: state-level
  const stateMapping = STATE_LEVEL_CODES[state]
  if (stateMapping) {
    return { ...stateMapping, tier: '2' }
  }

  // Tier 3: PAD fallback
  const pad = getCountyPad(state)
  const duoarea = PAD_DUOAREA[pad]
  const padName = PAD_NAMES[pad] ?? `PAD ${pad}`
  return { duoarea, label: `${padName} avg`, tier: '3' }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const applyMode = process.argv.includes('--apply')

const counties = Object.entries(
  centroids as Record<string, { lat: number; lng: number; name: string; state: string }>
)

let totalCounties = 0
let tier1aSkipped = 0
let validTier1b = 0
let noTier1b = 0
const leaks: ChainLeak[] = []

for (const [fips, info] of counties) {
  totalCounties++
  const state = info.state
  const cpiArea = getCpiArea(fips, state)

  // Simulate current gas assignment
  const current = simulateCurrentGas(fips, cpiArea, state)

  if (current === null) {
    // Has Tier 1a override — already handled
    tier1aSkipped++
    continue
  }

  if (current.tier !== '1b') {
    // Not using Tier 1b at all — no chain leak possible
    noTier1b++
    continue
  }

  // County is using Tier 1b (CPI→city chain). Check distance.
  const cityCoords = EIA_CITY_COORDS[current.duoarea]
  if (!cityCoords) {
    // Unknown city — shouldn't happen, but skip
    validTier1b++
    continue
  }

  const dist = haversine(info.lat, info.lng, cityCoords.lat, cityCoords.lng)

  if (dist <= MAX_CITY_DISTANCE_MILES) {
    // Close enough — Tier 1b is valid
    validTier1b++
    continue
  }

  // Chain leak detected — county is too far from the EIA city
  const shouldBe = getCorrectGas(state)
  leaks.push({
    county: { fips, name: info.name, state },
    cpiArea,
    distanceMiles: Math.round(dist),
    currentGas: current,
    shouldBe,
  })
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (!applyMode) {
  // Report mode
  console.log('Gas Chain Leak Audit (distance-based)')
  console.log('======================================')
  console.log(`Total counties: ${totalCounties}`)
  console.log(`Counties with Tier 1a override (skipped): ${tier1aSkipped}`)
  console.log(`Counties with valid Tier 1b (within ${MAX_CITY_DISTANCE_MILES} mi): ${validTier1b}`)
  console.log(`Counties not using Tier 1b: ${noTier1b}`)
  console.log(`Chain leaks found: ${leaks.length}`)
  console.log()

  if (leaks.length > 0) {
    // Group by state for readability
    const byState = new Map<string, ChainLeak[]>()
    for (const leak of leaks) {
      const arr = byState.get(leak.county.state) ?? []
      arr.push(leak)
      byState.set(leak.county.state, arr)
    }

    const header = `${'State'.padEnd(6)}${'County'.padEnd(30)}${'FIPS'.padEnd(8)}${'Dist'.padEnd(7)}${'Current gas (via CPI chain)'.padEnd(35)}${'Should be'.padEnd(25)}CPI area`
    console.log(header)
    console.log('-'.repeat(header.length))

    for (const [state, stateLeaks] of [...byState.entries()].sort()) {
      for (const leak of stateLeaks.sort((a, b) => a.county.fips.localeCompare(b.county.fips))) {
        console.log(
          `${leak.county.state.padEnd(6)}` +
          `${leak.county.name.padEnd(30)}` +
          `${leak.county.fips.padEnd(8)}` +
          `${`${leak.distanceMiles}mi`.padEnd(7)}` +
          `${`${leak.currentGas.duoarea} (${leak.currentGas.label})`.padEnd(35)}` +
          `${`${leak.shouldBe.duoarea} (${leak.shouldBe.label})`.padEnd(25)}` +
          `${leak.cpiArea}`
        )
      }
    }
  }
} else {
  // Apply mode — output TypeScript for COUNTY_EIA_CITY_OVERRIDES
  console.log('// Generated by scripts/audit-gas-assignments.ts --apply')
  console.log('// Add to COUNTY_EIA_CITY_OVERRIDES in src/lib/mappings/eia-gas.ts')
  console.log()

  // Group by state, then by target duoarea
  const byState = new Map<string, ChainLeak[]>()
  for (const leak of leaks) {
    const arr = byState.get(leak.county.state) ?? []
    arr.push(leak)
    byState.set(leak.county.state, arr)
  }

  for (const [state, stateLeaks] of [...byState.entries()].sort()) {
    const first = stateLeaks[0]

    console.log(`  // ${state} → ${first.shouldBe.label} (not ${first.currentGas.label} via CPI chain)`)

    for (const leak of stateLeaks.sort((a, b) => a.county.fips.localeCompare(b.county.fips))) {
      console.log(
        `  '${leak.county.fips}': { duoarea: '${leak.shouldBe.duoarea}', label: '${leak.shouldBe.label}' },  // ${leak.county.name} (${leak.distanceMiles}mi from ${leak.currentGas.label.replace(' avg', '')})`
      )
    }
  }

  console.log()
  console.log(`// Total overrides to add: ${leaks.length}`)
}

if (leaks.length > 0 && !applyMode) {
  console.log()
  console.log(`Run with --apply to generate TypeScript overrides.`)
}
