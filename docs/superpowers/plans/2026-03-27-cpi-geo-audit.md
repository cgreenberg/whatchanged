# CPI Geographic Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a script that computes the geographically nearest BLS CPI metro for every US county, compares it to the current assignment, and outputs a definitive list of overrides needed — then apply those overrides.

**Architecture:** A two-phase approach: (1) a build script downloads Census Gazetteer county centroids and computes haversine distance from each county to all 23 BLS CPI metros, producing a JSON report of current vs optimal assignments; (2) the report is reviewed and applied as overrides to `county-metro-cpi.ts`. The script checks all 23 metros regardless of state — so Buffalo NY can be assigned to Detroit or Boston if they're closer than NYC.

**Tech Stack:** TypeScript (tsx), Census Gazetteer data, haversine formula

---

### Task 1: Build county centroid data script

**Files:**
- Create: `scripts/build-county-centroids.ts`
- Create: `src/lib/data/county-centroids.json` (output)

- [ ] **Step 1: Create the build script**

Create `scripts/build-county-centroids.ts`:

```typescript
// Downloads Census Gazetteer county centroid data and outputs county-centroids.json
// Usage: npx tsx scripts/build-county-centroids.ts

import { writeFileSync } from 'fs'
import { join } from 'path'

// All state FIPS codes (01-56, including DC=11, skipping gaps)
const STATE_FIPS = [
  '01','02','04','05','06','08','09','10','11','12','13','15','16','17','18','19',
  '20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35',
  '36','37','38','39','40','41','42','44','45','46','47','48','49','50','51','53',
  '54','55','56'
]

const GAZ_BASE = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/'

interface CountyCentroid {
  lat: number
  lng: number
  name: string
  state: string
}

async function fetchStateCentroids(stateFips: string): Promise<Record<string, CountyCentroid>> {
  const url = `${GAZ_BASE}2024_gaz_counties_${stateFips}.txt`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`  Failed to fetch ${stateFips}: ${response.status}`)
    return {}
  }
  const text = await response.text()
  const lines = text.trim().split('\n')
  const result: Record<string, CountyCentroid> = {}

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    // Columns: USPS, GEOID, ANSICODE, NAME, ALAND, AWATER, ALAND_SQMI, AWATER_SQMI, INTPTLAT, INTPTLONG
    const stateAbbr = cols[0]?.trim()
    const geoid = cols[1]?.trim()  // 5-digit county FIPS
    const name = cols[3]?.trim()
    const lat = parseFloat(cols[8]?.trim())
    const lng = parseFloat(cols[9]?.trim())
    if (geoid && !isNaN(lat) && !isNaN(lng)) {
      result[geoid] = { lat, lng, name, state: stateAbbr }
    }
  }
  return result
}

async function main() {
  const allCounties: Record<string, CountyCentroid> = {}

  for (const fips of STATE_FIPS) {
    process.stdout.write(`Fetching state ${fips}...`)
    const counties = await fetchStateCentroids(fips)
    const count = Object.keys(counties).length
    console.log(` ${count} counties`)
    Object.assign(allCounties, counties)
  }

  const outPath = join(__dirname, '..', 'src', 'lib', 'data', 'county-centroids.json')
  writeFileSync(outPath, JSON.stringify(allCounties, null, 2))
  console.log(`\nWrote ${Object.keys(allCounties).length} county centroids to ${outPath}`)
}

main().catch(console.error)
```

- [ ] **Step 2: Run the script**

Run: `npx tsx scripts/build-county-centroids.ts`
Expected: Downloads centroid data for all 51 states/DC, writes `src/lib/data/county-centroids.json` with ~3,200 entries.

- [ ] **Step 3: Verify the output**

Run: `node -e "const d = require('./src/lib/data/county-centroids.json'); console.log(Object.keys(d).length, 'counties'); console.log(d['12095'])"`
Expected: ~3,200 counties. Orange County FL (12095) should show `{ lat: ~28.5, lng: ~-81.4, name: 'Orange County', state: 'FL' }`.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-county-centroids.ts src/lib/data/county-centroids.json
git commit -m "data: add county centroid coordinates from Census Gazetteer"
```

---

### Task 2: Build CPI geo-audit script

**Files:**
- Create: `scripts/audit-cpi-assignments.ts`

This script computes the geographically nearest BLS CPI metro for every county and compares it to the current assignment. It checks ALL 23 metros for each county, not just the state default — so Buffalo NY can be assigned to Detroit if it's closer than NYC.

- [ ] **Step 1: Create the audit script**

Create `scripts/audit-cpi-assignments.ts`:

```typescript
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
        currentCpiName: (BLS_CPI_AREAS as Record<string, string>)[currentCpi] ?? currentCpi,
        currentDist: Math.round(currentDist),
        nearestCpi: nearest.code,
        nearestCpiName: (BLS_CPI_AREAS as Record<string, string>)[nearest.code] ?? nearest.code,
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
      const metroName = (BLS_CPI_AREAS as Record<string, string>)[cpi] ?? cpi
      console.log(`  // → ${metroName} (${cpi})`)
      for (const c of counties.sort((a, b) => a.countyFips.localeCompare(b.countyFips))) {
        console.log(`  '${c.countyFips}': '${cpi}', // ${c.countyName}, ${c.state} (${c.nearestDist}mi vs ${c.currentDist}mi current)`)
      }
      console.log()
    }
  }
}

main()
```

- [ ] **Step 2: Run the audit in report mode**

Run: `npx tsx scripts/audit-cpi-assignments.ts`
Expected: A table showing every county where a closer BLS CPI metro exists, sorted by distance savings. Save the output to a file for review:
`npx tsx scripts/audit-cpi-assignments.ts > audit-cpi-report.txt`

- [ ] **Step 3: Run in apply mode to generate overrides**

Run: `npx tsx scripts/audit-cpi-assignments.ts --apply > audit-cpi-overrides.txt`
Expected: TypeScript-formatted override entries grouped by target CPI metro, ready to paste into `county-metro-cpi.ts`.

- [ ] **Step 4: Commit the script (not the overrides yet)**

```bash
git add scripts/audit-cpi-assignments.ts
git commit -m "feat: add CPI geographic audit script using county centroids"
```

---

### Task 3: Apply overrides to county-metro-cpi.ts

**Files:**
- Modify: `src/lib/mappings/county-metro-cpi.ts` — add new overrides to `COUNTY_CPI_OVERRIDES`
- Modify: `tests/unit/city-mapping-audit.test.ts` — update test expectations for changed cities

This task depends on the output of Task 2. The implementer should:

- [ ] **Step 1: Run the audit script to get the override list**

Run: `npx tsx scripts/audit-cpi-assignments.ts --apply`

Review the output. Every override listed is a county where a different BLS CPI metro is geographically closer than the current assignment. Apply ALL of them — the script already computed the optimal assignment for every county.

- [ ] **Step 2: Add the overrides to COUNTY_CPI_OVERRIDES**

In `src/lib/mappings/county-metro-cpi.ts`, add all the generated overrides to the `COUNTY_CPI_OVERRIDES` object. Group them by target CPI metro with comments, following the existing style. Remove any existing overrides that are now redundant (the script output is authoritative).

Keep existing overrides that match the script output — don't remove and re-add them.

- [ ] **Step 3: Update city mapping test expectations**

Run: `npm test -- --testPathPattern=city-mapping-audit`

For any failures, update the expected CPI area code in `tests/unit/city-mapping-audit.test.ts` to match the new override. The test file has rows like:
```typescript
['Orlando', 'FL', '12095', 'S35D', 'SFL', 1],
```
The 4th column is the CPI area code — update it to match the new override for that county.

- [ ] **Step 4: Run the full audit script to verify zero mismatches remain**

Run: `npx tsx scripts/audit-cpi-assignments.ts`
Expected: `Could be improved: 0` (all counties now assigned to their nearest CPI metro)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mappings/county-metro-cpi.ts tests/unit/city-mapping-audit.test.ts
git commit -m "fix: assign all counties to geographically nearest CPI metro"
```

---

### Task 4: Flush CPI cache and verify

**Files:** None modified — operational task

- [ ] **Step 1: Flush all CPI cache keys**

Run: `npx tsx scripts/flush-all-cache.ts`

This ensures all zips fetch fresh data using the new CPI metro assignments.

- [ ] **Step 2: Spot-check a few previously-wrong assignments**

Test these zips against the local dev server to verify they now show the correct CPI metro:
- Buffalo NY (14201) — should NOT be NYC metro
- Sacramento CA (95814) — should be SF metro, not LA
- Jacksonville FL (32099) — should be Tampa metro, not Miami
- Cincinnati OH (45202) — should be closest available metro, not Detroit
- East St. Louis IL (62201) — should be St. Louis, not Chicago

Run: `curl -s http://localhost:3000/api/data/{zip} | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('cpi',{}).get('data',{}).get('metro','unknown'))"`

- [ ] **Step 3: Commit (if any cache flush script changes were needed)**

No commit needed if flush script already works.

---

### Task 5: Run code review agents

- [ ] **Step 1: Get the full diff**

```bash
git diff main...HEAD
```

- [ ] **Step 2: Run Logic, Security, and Data Accuracy reviewers in parallel**

All 3 must PASS per `.claude/rules/code-review.md`.

- [ ] **Step 3: Fix any issues and re-run failed reviewers**
