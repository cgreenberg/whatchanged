// Audits CPI assignments for all US counties using the CBSA-based mapping system.
// For each county in the centroids file, reports whether it gets Tier 1 (metro CBSA),
// Tier 2 (regional), or Tier 3 (national/territory) CPI assignment.
//
// Usage: npx tsx scripts/audit-cpi-assignments.ts

import centroids from '../src/lib/data/county-centroids.json'
import cbsaCrosswalk from '../src/lib/data/cbsa-cpi-crosswalk.json'
import {
  STATE_TO_REGION,
  BLS_CPI_AREAS,
} from '../src/lib/mappings/county-metro-cpi'

interface CountyInfo {
  lat: number
  lng: number
  name: string
  state: string
}

type Tier = 1 | 2 | 3

interface CountyAudit {
  countyFips: string
  countyName: string
  state: string
  tier: Tier
  cpiCode: string
  cpiName: string
}

function getAssignment(countyFips: string, state: string): { tier: Tier; cpiCode: string; cpiName: string } {
  // Tier 1: CBSA crosswalk (metro CPI)
  const cbsaArea = (cbsaCrosswalk as Record<string, string>)[countyFips]
  if (cbsaArea && BLS_CPI_AREAS[cbsaArea]) {
    return {
      tier: 1,
      cpiCode: cbsaArea,
      cpiName: BLS_CPI_AREAS[cbsaArea].name,
    }
  }

  // Tier 2: Regional CPI via state
  const regionCode = STATE_TO_REGION[state.toUpperCase()]
  if (regionCode && BLS_CPI_AREAS[regionCode]) {
    return {
      tier: 2,
      cpiCode: regionCode,
      cpiName: BLS_CPI_AREAS[regionCode].name,
    }
  }

  // Tier 3: National fallback (territories, unmapped)
  return { tier: 3, cpiCode: '0000', cpiName: 'National' }
}

function main() {
  const auditResults: CountyAudit[] = []
  const tierCounts: Record<Tier, number> = { 1: 0, 2: 0, 3: 0 }
  const noAssignment: CountyAudit[] = []

  for (const [fips, info] of Object.entries(centroids) as [string, CountyInfo][]) {
    const { tier, cpiCode, cpiName } = getAssignment(fips, info.state)
    const entry: CountyAudit = {
      countyFips: fips,
      countyName: info.name,
      state: info.state,
      tier,
      cpiCode,
      cpiName,
    }
    auditResults.push(entry)
    tierCounts[tier]++
    if (cpiCode === '0000') noAssignment.push(entry)
  }

  const totalCounties = auditResults.length

  console.log('\nCPI Assignment Audit (CBSA-based)')
  console.log('==================================')
  console.log(`Total counties audited: ${totalCounties.toLocaleString()}`)
  console.log()
  console.log(`Tier 1 — Metro CBSA:      ${tierCounts[1].toLocaleString().padStart(5)} counties  (${((tierCounts[1] / totalCounties) * 100).toFixed(1)}%)`)
  console.log(`Tier 2 — Regional CPI:    ${tierCounts[2].toLocaleString().padStart(5)} counties  (${((tierCounts[2] / totalCounties) * 100).toFixed(1)}%)`)
  console.log(`Tier 3 — National/None:   ${tierCounts[3].toLocaleString().padStart(5)} counties  (${((tierCounts[3] / totalCounties) * 100).toFixed(1)}%)`)
  console.log()

  // Summary of metro assignments
  console.log('Tier 1 metro distribution:')
  const metroCounts: Record<string, number> = {}
  for (const r of auditResults) {
    if (r.tier === 1) {
      metroCounts[r.cpiCode] = (metroCounts[r.cpiCode] ?? 0) + 1
    }
  }
  for (const [code, count] of Object.entries(metroCounts).sort((a, b) => b[1] - a[1])) {
    const name = BLS_CPI_AREAS[code]?.name ?? code
    console.log(`  ${code}  ${name.padEnd(40)}  ${count.toLocaleString().padStart(4)} counties`)
  }
  console.log()

  // Summary of regional assignments
  console.log('Tier 2 regional distribution:')
  const regionCounts: Record<string, number> = {}
  for (const r of auditResults) {
    if (r.tier === 2) {
      regionCounts[r.cpiCode] = (regionCounts[r.cpiCode] ?? 0) + 1
    }
  }
  for (const [code, count] of Object.entries(regionCounts).sort()) {
    const name = BLS_CPI_AREAS[code]?.name ?? code
    console.log(`  ${code}  ${name.padEnd(40)}  ${count.toLocaleString().padStart(4)} counties`)
  }
  console.log()

  // Counties with no CPI assignment
  if (noAssignment.length === 0) {
    console.log('PASS: All counties have a CPI assignment (no national fallback).')
  } else {
    console.log(`WARNING: ${noAssignment.length} counties have no CPI assignment (national fallback):`)
    for (const r of noAssignment.sort((a, b) => a.countyFips.localeCompare(b.countyFips))) {
      console.log(`  ${r.countyFips}  ${r.countyName}, ${r.state}`)
    }
  }

  // Tier 2 breakdown by state (for verifying region assignments look correct)
  console.log('\nTier 2 counties by state:')
  const tier2ByState: Record<string, number> = {}
  for (const r of auditResults) {
    if (r.tier === 2) {
      tier2ByState[r.state] = (tier2ByState[r.state] ?? 0) + 1
    }
  }
  for (const [state, count] of Object.entries(tier2ByState).sort()) {
    const regionCode = STATE_TO_REGION[state] ?? '???'
    const regionName = BLS_CPI_AREAS[regionCode]?.name ?? regionCode
    console.log(`  ${state}  →  ${regionCode} (${regionName})  —  ${count} counties at Tier 2`)
  }
}

main()
