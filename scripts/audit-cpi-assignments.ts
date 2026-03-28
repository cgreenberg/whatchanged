// Audits CPI metro assignments for all US counties using geographic distance.
// For each county, computes distance to all 23 BLS CPI metros and reports
// where the current assignment differs from the geographically closest metro.
//
// Usage: npx tsx scripts/audit-cpi-assignments.ts
//        npx tsx scripts/audit-cpi-assignments.ts --apply   (writes overrides to stdout)

import centroids from '../src/lib/data/county-centroids.json'
import {
  STATE_TO_CPI_AREA,
  COUNTY_CPI_OVERRIDES,
  BLS_CPI_AREAS,
} from '../src/lib/mappings/county-metro-cpi'

// BLS CPI metro center coordinates
const CPI_METRO_COORDS: Record<string, { lat: number; lng: number }> = {
  S11A: { lat: 42.36, lng: -71.06 },   // Boston
  S12A: { lat: 40.71, lng: -74.01 },   // New York
  S12B: { lat: 39.95, lng: -75.17 },   // Philadelphia
  S23A: { lat: 41.88, lng: -87.63 },   // Chicago
  S23B: { lat: 42.33, lng: -83.05 },   // Detroit
  S24A: { lat: 44.98, lng: -93.27 },   // Minneapolis
  S24B: { lat: 38.63, lng: -90.20 },   // St. Louis
  S35A: { lat: 38.91, lng: -77.04 },   // Washington DC
  S35B: { lat: 25.76, lng: -80.19 },   // Miami
  S35C: { lat: 33.75, lng: -84.39 },   // Atlanta
  S35D: { lat: 27.95, lng: -82.46 },   // Tampa
  S35E: { lat: 39.29, lng: -76.61 },   // Baltimore
  S37A: { lat: 32.78, lng: -96.80 },   // Dallas
  S37B: { lat: 29.76, lng: -95.37 },   // Houston
  S48A: { lat: 33.45, lng: -112.07 },  // Phoenix
  S48B: { lat: 39.74, lng: -104.99 },  // Denver
  S49A: { lat: 34.05, lng: -118.24 },  // Los Angeles
  S49B: { lat: 37.77, lng: -122.42 },  // San Francisco
  S49C: { lat: 33.95, lng: -117.40 },  // Riverside
  S49D: { lat: 47.61, lng: -122.33 },  // Seattle
  S49E: { lat: 32.72, lng: -117.16 },  // San Diego
  S49F: { lat: 21.31, lng: -157.86 },  // Honolulu
  S49G: { lat: 61.22, lng: -149.90 },  // Anchorage
}

// Haversine distance in miles
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface AuditResult {
  countyFips: string
  countyName: string
  state: string
  currentCpi: string
  currentCpiName: string
  currentDist: number
  nearestCpi: string
  nearestCpiName: string
  nearestDist: number
  savings: number // miles closer
}

function getCurrentCpi(countyFips: string, state: string): string {
  if (COUNTY_CPI_OVERRIDES[countyFips]) return COUNTY_CPI_OVERRIDES[countyFips]
  return (STATE_TO_CPI_AREA as Record<string, string>)[state] ?? '0000'
}

function findNearestCpi(lat: number, lng: number): { code: string; dist: number } {
  let best = { code: '', dist: Infinity }
  for (const [code, coords] of Object.entries(CPI_METRO_COORDS)) {
    const dist = haversine(lat, lng, coords.lat, coords.lng)
    if (dist < best.dist) best = { code, dist }
  }
  return best
}

function main() {
  const applyMode = process.argv.includes('--apply')
  const results: AuditResult[] = []
  let totalCounties = 0
  let mismatches = 0

  for (const [fips, info] of Object.entries(centroids) as [string, { lat: number; lng: number; name: string; state: string }][]) {
    totalCounties++
    const currentCpi = getCurrentCpi(fips, info.state)
    if (currentCpi === '0000') continue // skip national fallback (PR, etc.)

    const currentCoords = CPI_METRO_COORDS[currentCpi]
    if (!currentCoords) continue

    const currentDist = haversine(info.lat, info.lng, currentCoords.lat, currentCoords.lng)
    const nearest = findNearestCpi(info.lat, info.lng)

    if (nearest.code !== currentCpi) {
      mismatches++
      results.push({
        countyFips: fips,
        countyName: info.name,
        state: info.state,
        currentCpi,
        currentCpiName: (BLS_CPI_AREAS as Record<string, { code: string; name: string }>)[currentCpi]?.name ?? currentCpi,
        currentDist: Math.round(currentDist),
        nearestCpi: nearest.code,
        nearestCpiName: (BLS_CPI_AREAS as Record<string, { code: string; name: string }>)[nearest.code]?.name ?? nearest.code,
        nearestDist: Math.round(nearest.dist),
        savings: Math.round(currentDist - nearest.dist),
      })
    }
  }

  // Sort by savings (biggest improvement first)
  results.sort((a, b) => b.savings - a.savings)

  console.log(`\nCPI Geographic Audit`)
  console.log(`====================`)
  console.log(`Total counties: ${totalCounties}`)
  console.log(`Correctly assigned (nearest metro): ${totalCounties - mismatches}`)
  console.log(`Could be improved: ${mismatches}`)
  console.log()

  if (!applyMode) {
    // Report mode: print table
    console.log('Counties where a closer CPI metro exists:\n')
    console.log('State | County | FIPS | Current CPI (dist) | Nearest CPI (dist) | Savings')
    console.log('------|--------|------|--------------------|--------------------|--------')
    for (const r of results) {
      console.log(
        `${r.state.padEnd(5)} | ${r.countyName.slice(0, 25).padEnd(25)} | ${r.countyFips} | ` +
        `${r.currentCpiName.slice(0, 20)} (${r.currentDist}mi) | ` +
        `${r.nearestCpiName.slice(0, 20)} (${r.nearestDist}mi) | ` +
        `${r.savings}mi closer`
      )
    }

    // Summary by state
    console.log('\n\nSummary by state:')
    const byState: Record<string, number> = {}
    for (const r of results) {
      byState[r.state] = (byState[r.state] ?? 0) + 1
    }
    for (const [state, count] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${state}: ${count} counties need override`)
    }
  } else {
    // Apply mode: output TypeScript override map
    console.log('// Generated by scripts/audit-cpi-assignments.ts --apply')
    console.log('// Add these to COUNTY_CPI_OVERRIDES in src/lib/mappings/county-metro-cpi.ts\n')

    // Group by target CPI area for readability
    const byTarget: Record<string, AuditResult[]> = {}
    for (const r of results) {
      if (!byTarget[r.nearestCpi]) byTarget[r.nearestCpi] = []
      byTarget[r.nearestCpi].push(r)
    }

    for (const [cpi, counties] of Object.entries(byTarget).sort()) {
      const metroName = (BLS_CPI_AREAS as Record<string, { code: string; name: string }>)[cpi]?.name ?? cpi
      console.log(`  // → ${metroName} (${cpi})`)
      for (const c of counties.sort((a, b) => a.countyFips.localeCompare(b.countyFips))) {
        console.log(`  '${c.countyFips}': '${cpi}', // ${c.countyName}, ${c.state} (${c.nearestDist}mi vs ${c.currentDist}mi current)`)
      }
      console.log()
    }
  }
}

main()
