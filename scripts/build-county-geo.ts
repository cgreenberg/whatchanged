#!/usr/bin/env npx tsx
/**
 * build-county-geo.ts
 *
 * Writes src/lib/data/county-geo.json — the per-county geography the live site
 * uses, produced by calling the real TS lookup functions so non-TS consumers
 * (scripts/build-local-data.py) never re-implement or regex-parse them:
 *
 *   { [countyFips]: {
 *       state: 'WA',            // USPS abbreviation
 *       cpiArea: 'S49D',        // BLS CPI area code (getMetroCpiAreaForCounty)
 *       cpiTier: 1,             // 1 metro | 2 division | 3 region | 4 national
 *       cpiName: 'Seattle-Tacoma-Bellevue',
 *       gasSource: 'eia',       // 'eia' weekly | 'bls' monthly CPI average price (getGasLookup)
 *       gasDuoarea: 'Y48SE',    // EIA duoarea, or BLS CPI area code when gasSource is 'bls'
 *       gasTier: 1,             // 1 city/metro | 2 state/HI-AK stand-in | 3 PADD / national
 *       lausFips: '53033',      // FIPS used in LAUCN{fips}0000000003
 *       approx?: true           // CT legacy county → dominant 2022 planning region
 *   } }
 *
 * Covers every county FIPS referenced by src/lib/data/zip-county.json.
 * Zip-level CT planning regions (more precise than the county's dominant
 * region) are in src/lib/data/ct-planning-regions.json → byZip.
 *
 * Run AFTER build-zip-county.ts and build-cbsa-cpi-crosswalk.ts:
 *   npx tsx scripts/build-county-geo.ts
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import zipCountyData from '../src/lib/data/zip-county.json'
import { getMetroCpiAreaForCounty } from '../src/lib/mappings/county-metro-cpi'
import { getLausAreaForCounty } from '../src/lib/mappings/laus-area'
import { getGasLookup } from '../src/lib/api/eia'

export interface CountyGeo {
  state: string
  cpiArea: string
  cpiTier: 1 | 2 | 3 | 4
  cpiName: string
  gasSource: 'eia' | 'bls'
  gasDuoarea: string
  gasTier: 1 | 2 | 3
  lausFips: string
  approx?: true
}

export function buildCountyGeo(
  zips: Record<string, { countyFips: string; stateAbbr: string }>
): Record<string, CountyGeo> {
  const out: Record<string, CountyGeo> = {}
  for (const { countyFips, stateAbbr } of Object.values(zips)) {
    if (out[countyFips]) continue
    const cpi = getMetroCpiAreaForCounty(countyFips, stateAbbr)
    const gas = getGasLookup(stateAbbr, cpi.areaCode, countyFips)
    const laus = getLausAreaForCounty(countyFips)
    out[countyFips] = {
      state: stateAbbr,
      cpiArea: cpi.areaCode,
      cpiTier: cpi.tier,
      cpiName: cpi.areaName,
      gasSource: gas.source,
      gasDuoarea: gas.areaCode,
      gasTier: gas.tier,
      lausFips: laus.fips,
      ...(laus.approx ? { approx: true as const } : {}),
    }
  }
  const sorted: Record<string, CountyGeo> = {}
  for (const k of Object.keys(out).sort()) sorted[k] = out[k]
  return sorted
}

if (require.main === module) {
  const geo = buildCountyGeo(zipCountyData as Record<string, { countyFips: string; stateAbbr: string }>)
  const outPath = join(__dirname, '..', 'src', 'lib', 'data', 'county-geo.json')
  writeFileSync(outPath, JSON.stringify(geo, null, 1) + '\n')
  console.log(`Wrote ${Object.keys(geo).length} counties to ${outPath}`)
}
