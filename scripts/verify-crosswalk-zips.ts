/**
 * Audits CPI tier distribution for all zip codes.
 *
 * Tier 1 (metro):    county FIPS found in cbsa-cpi-crosswalk.json
 * Tier 2 (regional): state in STATE_TO_REGION
 * Tier 3 (national): territories / unmapped
 */

import zipCountyData from '../src/lib/data/zip-county.json'
import cbsaCrosswalk from '../src/lib/data/cbsa-cpi-crosswalk.json'

const BLS_CPI_AREAS: Record<string, { code: string; name: string }> = {
  S11A: { code: 'S11A', name: 'Boston-Cambridge-Newton' },
  S12A: { code: 'S12A', name: 'New York-Newark-Jersey City' },
  S12B: { code: 'S12B', name: 'Philadelphia-Camden-Wilmington' },
  S23A: { code: 'S23A', name: 'Chicago-Naperville-Elgin' },
  S23B: { code: 'S23B', name: 'Detroit-Warren-Dearborn' },
  S24A: { code: 'S24A', name: 'Minneapolis-St. Paul-Bloomington' },
  S24B: { code: 'S24B', name: 'St. Louis' },
  S35A: { code: 'S35A', name: 'Washington-Arlington-Alexandria' },
  S35B: { code: 'S35B', name: 'Miami-Fort Lauderdale-West Palm Beach' },
  S35C: { code: 'S35C', name: 'Atlanta-Sandy Springs-Roswell' },
  S35D: { code: 'S35D', name: 'Tampa-St. Petersburg-Clearwater' },
  S35E: { code: 'S35E', name: 'Baltimore-Columbia-Towson' },
  S37A: { code: 'S37A', name: 'Dallas-Fort Worth-Arlington' },
  S37B: { code: 'S37B', name: 'Houston-The Woodlands-Sugar Land' },
  S48A: { code: 'S48A', name: 'Phoenix-Mesa-Scottsdale' },
  S48B: { code: 'S48B', name: 'Denver-Aurora-Lakewood' },
  S49A: { code: 'S49A', name: 'Los Angeles-Long Beach-Anaheim' },
  S49B: { code: 'S49B', name: 'San Francisco-Oakland-Hayward' },
  S49C: { code: 'S49C', name: 'Riverside-San Bernardino-Ontario' },
  S49D: { code: 'S49D', name: 'Seattle-Tacoma-Bellevue' },
  S49E: { code: 'S49E', name: 'San Diego-Carlsbad' },
  S49F: { code: 'S49F', name: 'Urban Hawaii' },
  S49G: { code: 'S49G', name: 'Urban Alaska' },
  '0100': { code: '0100', name: 'Northeast Urban' },
  '0200': { code: '0200', name: 'Midwest Urban' },
  '0300': { code: '0300', name: 'South Urban' },
  '0400': { code: '0400', name: 'West Urban' },
}

const STATE_TO_REGION: Record<string, string> = {
  CT: '0100', ME: '0100', MA: '0100', NH: '0100', NJ: '0100',
  NY: '0100', PA: '0100', RI: '0100', VT: '0100',
  IL: '0200', IN: '0200', IA: '0200', KS: '0200', MI: '0200',
  MN: '0200', MO: '0200', NE: '0200', ND: '0200', OH: '0200',
  SD: '0200', WI: '0200',
  AL: '0300', AR: '0300', DE: '0300', DC: '0300', FL: '0300',
  GA: '0300', KY: '0300', LA: '0300', MD: '0300', MS: '0300',
  NC: '0300', OK: '0300', SC: '0300', TN: '0300', TX: '0300',
  VA: '0300', WV: '0300',
  AK: '0400', AZ: '0400', CA: '0400', CO: '0400', HI: '0400',
  ID: '0400', MT: '0400', NV: '0400', NM: '0400', OR: '0400',
  UT: '0400', WA: '0400', WY: '0400',
}

type ZipEntry = {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName?: string
}

type Tier = 1 | 2 | 3

interface ZipResolution {
  zip: string
  countyFips: string
  countyName: string
  stateAbbr: string
  tier: Tier
  areaCode: string
  areaName: string
}

function resolveZip(zip: string, entry: ZipEntry): ZipResolution {
  const { countyFips, countyName, stateAbbr } = entry
  const crosswalk = cbsaCrosswalk as Record<string, string>

  const metroCode = crosswalk[countyFips]
  if (metroCode && BLS_CPI_AREAS[metroCode]) {
    return {
      zip,
      countyFips,
      countyName,
      stateAbbr,
      tier: 1,
      areaCode: metroCode,
      areaName: BLS_CPI_AREAS[metroCode].name,
    }
  }

  const regionCode = STATE_TO_REGION[stateAbbr.toUpperCase()]
  if (regionCode && BLS_CPI_AREAS[regionCode]) {
    return {
      zip,
      countyFips,
      countyName,
      stateAbbr,
      tier: 2,
      areaCode: regionCode,
      areaName: BLS_CPI_AREAS[regionCode].name,
    }
  }

  return {
    zip,
    countyFips,
    countyName,
    stateAbbr,
    tier: 3,
    areaCode: '0000',
    areaName: 'National',
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const allZips = zipCountyData as Record<string, ZipEntry>

let tier1 = 0
let tier2 = 0
let tier3 = 0
const metroCounts: Record<string, number> = {}
const regionCounts: Record<string, number> = {}

for (const [zip, entry] of Object.entries(allZips)) {
  const res = resolveZip(zip, entry)
  if (res.tier === 1) {
    tier1++
    metroCounts[res.areaCode] = (metroCounts[res.areaCode] ?? 0) + 1
  } else if (res.tier === 2) {
    tier2++
    regionCounts[res.areaCode] = (regionCounts[res.areaCode] ?? 0) + 1
  } else {
    tier3++
  }
}

const total = tier1 + tier2 + tier3
const pct = (n: number) => ((n / total) * 100).toFixed(1)

console.log('\n=== CPI Tier Distribution ===\n')
console.log(`Tier 1 (metro CPI):    ${tier1.toLocaleString()} zips (${pct(tier1)}%)`)
console.log(`Tier 2 (regional CPI): ${tier2.toLocaleString()} zips (${pct(tier2)}%)`)
console.log(`Tier 3 (national CPI): ${tier3.toLocaleString()} zips (${pct(tier3)}%)`)
console.log(`Total:                 ${total.toLocaleString()} zips`)

// ── Regional distribution ───────────────────────────────────────────────────

console.log('\n=== Regional Distribution (Tier 2) ===\n')
const regionOrder = ['0100', '0200', '0300', '0400']
for (const code of regionOrder) {
  const count = regionCounts[code] ?? 0
  const name = BLS_CPI_AREAS[code]?.name ?? code
  console.log(`${code} (${name}): ${count.toLocaleString()} zips`)
}

// ── Metro distribution ──────────────────────────────────────────────────────

console.log('\n=== Metro Distribution (Tier 1) ===\n')
const sortedMetros = Object.entries(metroCounts).sort(([, a], [, b]) => b - a)
for (const [code, count] of sortedMetros) {
  const name = BLS_CPI_AREAS[code]?.name ?? code
  console.log(`${code} (${name}): ${count.toLocaleString()} zips`)
}

// ── Specific test zip checks ─────────────────────────────────────────────────

interface TestCase {
  zip: string
  expectedCountyFips: string
  expectedCountyDesc: string
  expectedTier: Tier
  expectedAreaCode: string
}

const testCases: TestCase[] = [
  { zip: '98683', expectedCountyFips: '53011', expectedCountyDesc: 'Clark County WA', expectedTier: 2, expectedAreaCode: '0400' },
  { zip: '10001', expectedCountyFips: '36061', expectedCountyDesc: 'New York County NY', expectedTier: 1, expectedAreaCode: 'S12A' },
  { zip: '60601', expectedCountyFips: '17031', expectedCountyDesc: 'Cook County IL', expectedTier: 1, expectedAreaCode: 'S23A' },
  { zip: '78701', expectedCountyFips: '48453', expectedCountyDesc: 'Travis County TX', expectedTier: 2, expectedAreaCode: '0300' },
  { zip: '90210', expectedCountyFips: '06037', expectedCountyDesc: 'Los Angeles County CA', expectedTier: 1, expectedAreaCode: 'S49A' },
  { zip: '04101', expectedCountyFips: '23005', expectedCountyDesc: 'Cumberland County ME', expectedTier: 2, expectedAreaCode: '0100' },
]

console.log('\n=== Test Zip Spot Checks ===\n')
let failures = 0

for (const tc of testCases) {
  const entry = allZips[tc.zip]
  if (!entry) {
    console.log(`FAIL  ${tc.zip} — not found in zip-county.json`)
    failures++
    continue
  }

  const res = resolveZip(tc.zip, entry)
  const fipsMatch = res.countyFips === tc.expectedCountyFips
  const tierMatch = res.tier === tc.expectedTier
  const areaMatch = res.areaCode === tc.expectedAreaCode
  const pass = fipsMatch && tierMatch && areaMatch

  const status = pass ? 'PASS' : 'FAIL'
  const tierLabel = res.tier === 1 ? 'metro' : res.tier === 2 ? 'regional' : 'national'
  const tierStr = `Tier ${res.tier} (${tierLabel})`

  console.log(
    `${status}  ${tc.zip} → ${res.countyName} ${res.stateAbbr} (${res.countyFips}) → ${res.areaCode} ${res.areaName} → ${tierStr}`
  )

  if (!pass) {
    failures++
    if (!fipsMatch) console.log(`       FIPS mismatch: got ${res.countyFips}, expected ${tc.expectedCountyFips}`)
    if (!tierMatch) console.log(`       Tier mismatch: got ${res.tier}, expected ${tc.expectedTier}`)
    if (!areaMatch) console.log(`       Area mismatch: got ${res.areaCode}, expected ${tc.expectedAreaCode}`)
  }
}

console.log('')
if (failures > 0) {
  console.error(`${failures} test zip(s) FAILED`)
  process.exit(1)
} else {
  console.log('All test zips passed.')
}
