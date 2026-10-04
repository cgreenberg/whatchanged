#!/usr/bin/env npx tsx
/**
 * build-zip-county.ts
 *
 * Builds src/lib/data/zip-county.json (zip → county) and
 * src/lib/data/ct-planning-regions.json (CT zip/county → 2022 planning region).
 *
 * Each zip is assigned to the county holding the MOST HOUSING UNITS of that
 * zip (2020 Census), the closest public analogue of HUD's USPS ZIP→County
 * RES_RATIO (share of residential addresses). HUD's own crosswalk now requires
 * a HUD USER login/API token, so it is not used here.
 *
 * Sources (all public, no key needed):
 *   1. Census 2020 ZCTA ↔ tabulation block relationship file
 *      https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt
 *   2. 2020 PL 94-171 redistricting geoheaders (block POP100 / HU100 / COUSUB)
 *      https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/{State}/{st}2020.pl.zip
 *   3. Census 2020 ZCTA ↔ county relationship file (county names, land-area tiebreak)
 *   4. Census ACS 2022 CT county-subdivision relationship file (town → 2022 planning region)
 *   5. GeoNames US postal codes (CC-BY 4.0) — adds non-ZCTA USPS zips (PO boxes, unique
 *      zips such as 20500) with their county, and is a fallback city name
 *      https://download.geonames.org/export/zip/{US,PR,VI,GU,MP,AS}.zip
 *   6. OpenDataSoft georef zip points — preferred USPS city name per zip
 *
 * Downloaded raw files are cached in $GEO_CACHE_DIR (default: <os tmpdir>/whatchanged-geo-cache).
 * Nothing downloaded is committed.
 *
 * Run: NODE_OPTIONS=--max-old-space-size=6144 npx tsx scripts/build-zip-county.ts
 * Needs `unzip` on PATH.
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { STATE_FIPS_MAP } from '../src/lib/mappings/state-fips'

/** Island areas: no PL 94-171 file, so their zips are assigned by land area. */
const ISLAND_AREAS = new Set(['60', '66', '69', '78'])

const CACHE = process.env.GEO_CACHE_DIR ?? join(tmpdir(), 'whatchanged-geo-cache')
const OUT_DIR = join(__dirname, '..', 'src', 'lib', 'data')

const REL_BASE = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520'
const BLOCK_REL_URL = `${REL_BASE}/tab20_zcta520_tabblock20_natl.txt`
const COUNTY_REL_URL = `${REL_BASE}/tab20_zcta520_county20_natl.txt`
const CT_COUSUB_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/rel2022/acs22_cousub22_blkgrp20_st09.txt'
const PL_BASE =
  'https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171'
const GEONAMES_BASE = 'https://download.geonames.org/export/zip'
/** GeoNames publishes the US and each territory as separate country files. */
const GEONAMES_COUNTRIES = ['US', 'PR', 'VI', 'GU', 'MP', 'AS']
const ODS_URL =
  'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-united-states-of-america-zc-point/exports/csv?select=zip_code,usps_city,stusps_code&delimiter=%3B'

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

async function download(url: string, dest: string): Promise<string> {
  if (existsSync(dest)) return dest
  console.log(`  downloading ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': 'whatchanged-build/1.0' } })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  const tmp = `${dest}.part`
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp))
  execFileSync('mv', [tmp, dest])
  return dest
}

async function* lines(file: string, encoding: BufferEncoding = 'utf8'): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(file, { encoding }), crlfDelay: Infinity })
  for await (const line of rl) yield line
}

function plStateDir(stateName: string): string {
  return stateName.replace(/ /g, '_')
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ZipEntry {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
  /** false when the zip is a USPS-only zip (PO box / unique) with no Census ZCTA */
  zcta?: false
}

/** weights per candidate: [housing units, population, land area] */
type Weights = [number, number, number]

function addWeights(map: Map<string, Weights>, key: string, hu: number, pop: number, land: number) {
  const w = map.get(key)
  if (w) {
    w[0] += hu
    w[1] += pop
    w[2] += land
  } else {
    map.set(key, [hu, pop, land])
  }
}

function best(map: Map<string, Weights>): string {
  let bestKey = ''
  let bestW: Weights = [-1, -1, -1]
  for (const [k, w] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (
      w[0] > bestW[0] ||
      (w[0] === bestW[0] && w[1] > bestW[1]) ||
      (w[0] === bestW[0] && w[1] === bestW[1] && w[2] > bestW[2])
    ) {
      bestKey = k
      bestW = w
    }
  }
  return bestKey
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(join(CACHE, 'pl'), { recursive: true })
  console.log(`Cache dir: ${CACHE}`)

  // 1. Downloads
  const blockRel = await download(BLOCK_REL_URL, join(CACHE, 'tab20_zcta520_tabblock20_natl.txt'))
  const countyRel = await download(COUNTY_REL_URL, join(CACHE, 'tab20_zcta520_county20_natl.txt'))
  const ctCousub = await download(CT_COUSUB_URL, join(CACHE, 'acs22_cousub22_blkgrp20_st09.txt'))
  const geonamesZips: Record<string, string> = {}
  for (const c of GEONAMES_COUNTRIES) {
    geonamesZips[c] = await download(`${GEONAMES_BASE}/${c}.zip`, join(CACHE, `geonames-${c}.zip`))
  }
  const odsCsv = await download(ODS_URL, join(CACHE, 'ods-zip-city.csv'))

  const plStates = Object.entries(STATE_FIPS_MAP).filter(([fips]) => !ISLAND_AREAS.has(fips))
  const plFiles: string[] = []
  for (const [, { abbr, name }] of plStates) {
    const st = abbr.toLowerCase()
    const geo = join(CACHE, 'pl', `${st}geo2020.pl`)
    if (!existsSync(geo)) {
      const zip = await download(`${PL_BASE}/${plStateDir(name)}/${st}2020.pl.zip`, join(CACHE, 'pl', `${st}.zip`))
      execFileSync('unzip', ['-o', '-q', zip, `${st}geo2020.pl`, '-d', join(CACHE, 'pl')])
      unlinkSync(zip)
    }
    plFiles.push(geo)
  }

  // 2. County names (2020) from the ZCTA↔county file
  const countyNames: Record<string, string> = {}
  for await (const line of lines(countyRel)) {
    const c = line.split('|')
    if (/^\d{5}$/.test(c[9] ?? '')) countyNames[c[9]] = c[10]
  }

  // 3. CT town (county subdivision) → 2022 planning region
  const ctTownToRegion: Record<string, string> = {}
  for await (const line of lines(ctCousub)) {
    const c = line.split('|')
    const geoid = c[1] ?? ''
    if (!/^09\d{8}$/.test(geoid)) continue
    ctTownToRegion[geoid.slice(5)] = geoid.slice(0, 5)
  }
  console.log(`CT towns mapped to planning regions: ${Object.keys(ctTownToRegion).length}`)

  // 4. Block weights from PL geoheaders (SUMLEV 750 = block)
  //    Packed as hu * 1e6 + pop (both < 1e6 for any single block).
  console.log('Reading PL 94-171 block geoheaders...')
  const blockWeights = new Map<number, number>()
  const ctBlockRegion = new Map<number, string>()
  for (const file of plFiles) {
    for await (const line of lines(file, 'latin1')) {
      const c = line.split('|')
      if (c[2] !== '750') continue
      const geocode = c[9]
      const pop = Number(c[90])
      const hu = Number(c[91])
      const key = Number(geocode)
      blockWeights.set(key, hu * 1e6 + pop)
      if (geocode.startsWith('09')) {
        const region = ctTownToRegion[c[17]]
        if (!region) throw new Error(`CT town ${c[17]} has no planning region`)
        ctBlockRegion.set(key, region)
      }
    }
  }
  console.log(`  blocks: ${blockWeights.size.toLocaleString()}`)

  // 5. Aggregate block weights per ZCTA × county (and ZCTA × CT region)
  console.log('Aggregating blocks into ZCTA × county...')
  const zctaCounty = new Map<string, Map<string, Weights>>()
  const zctaCtRegion = new Map<string, Map<string, Weights>>()
  const ctCountyRegion = new Map<string, Map<string, Weights>>()
  let missingBlocks = 0
  for await (const line of lines(blockRel)) {
    const c = line.split('|')
    const zcta = c[1]
    const block = c[9]
    if (!/^\d{5}$/.test(zcta ?? '') || !/^\d{15}$/.test(block ?? '')) continue
    const county = block.slice(0, 5)
    if (!STATE_FIPS_MAP[county.slice(0, 2)]) continue
    let packed = blockWeights.get(Number(block))
    if (packed === undefined) {
      // Island areas (AS, GU, MP, VI) are not in PL 94-171 — fall back to land area.
      if (!ISLAND_AREAS.has(county.slice(0, 2))) missingBlocks++
      packed = 0
    }
    const hu = Math.floor(packed / 1e6)
    const pop = packed - hu * 1e6
    const land = Number(c[15]) || 0
    let m = zctaCounty.get(zcta)
    if (!m) zctaCounty.set(zcta, (m = new Map()))
    addWeights(m, county, hu, pop, land)
    const region = ctBlockRegion.get(Number(block))
    if (region) {
      let r = zctaCtRegion.get(zcta)
      if (!r) zctaCtRegion.set(zcta, (r = new Map()))
      addWeights(r, region, hu, pop, land)
    }
  }
  if (missingBlocks) console.warn(`  WARNING: ${missingBlocks} blocks had no PL record`)
  // County-level CT dominant region (for callers that only have a legacy county FIPS)
  for (const [key, region] of ctBlockRegion) {
    const packed = blockWeights.get(key)!
    const hu = Math.floor(packed / 1e6)
    const county = String(key).padStart(15, '0').slice(0, 5)
    let m = ctCountyRegion.get(county)
    if (!m) ctCountyRegion.set(county, (m = new Map()))
    addWeights(m, region, hu, packed - hu * 1e6, 0)
  }

  // CT planning region → legacy county holding most of its housing units
  const ctRegionCounty = new Map<string, Map<string, Weights>>()
  for (const [county, m] of ctCountyRegion) {
    for (const [region, w] of m) {
      let r = ctRegionCounty.get(region)
      if (!r) ctRegionCounty.set(region, (r = new Map()))
      addWeights(r, county, w[0], w[1], w[2])
    }
  }

  // 6. City names
  const odsCity: Record<string, { city: string; state: string }> = {}
  for await (const line of lines(odsCsv)) {
    const [zip, city, state] = line.replace(/^﻿/, '').split(';')
    if (/^\d{5}$/.test(zip ?? '') && city) odsCity[zip] = { city: city.trim(), state: state?.trim() }
  }
  const abbrToFips: Record<string, string> = {}
  for (const [fips, { abbr }] of Object.entries(STATE_FIPS_MAP)) abbrToFips[abbr] = fips

  interface GeoNamesRow { zip: string; city: string; state: string; countyName: string; countyFips: string }
  const geonames: Record<string, GeoNamesRow> = {}
  for (const [country, zipFile] of Object.entries(geonamesZips)) {
    const txt = execFileSync('unzip', ['-p', zipFile, `${country}.txt`], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
    for (const line of txt.split('\n')) {
      const f = line.split('\t')
      if (f.length < 7 || !/^\d{5}$/.test(f[1])) continue
      // Column layout differs by file: US has state abbr + 3-digit county code;
      // PR/MP put the 3-digit municipio code in admin1; VI/GU use admin1=state FIPS, admin2=county.
      let state = country
      let countyFips = ''
      if (country === 'US') {
        state = f[4]
        countyFips = abbrToFips[state] ? `${abbrToFips[state]}${f[6]}` : ''
      } else if (country === 'PR' || country === 'MP') {
        countyFips = /^\d{3}$/.test(f[4]) ? `${abbrToFips[country]}${f[4]}` : ''
      } else if (/^\d{2}$/.test(f[4]) && /^\d{3}$/.test(f[6])) {
        countyFips = `${f[4]}${f[6]}`
      }
      geonames[f[1]] ??= { zip: f[1], city: f[2], state, countyName: f[5], countyFips }
    }
  }

  function cityFor(zip: string, stateAbbr: string): string {
    const o = odsCity[zip]
    if (o && (!o.state || o.state === stateAbbr)) return o.city
    const g = geonames[zip]
    if (g && g.state === stateAbbr) return g.city
    return ''
  }

  // 7. Build ZCTA-based entries
  const result: Record<string, ZipEntry> = {}
  const ctByZip: Record<string, string> = {}
  for (const [zcta, counties] of zctaCounty) {
    const countyFips = best(counties)
    const st = STATE_FIPS_MAP[countyFips.slice(0, 2)]
    result[zcta] = {
      countyFips,
      countyName: countyNames[countyFips] ?? '',
      stateName: st.name,
      stateAbbr: st.abbr,
      cityName: cityFor(zcta, st.abbr),
    }
    const regions = zctaCtRegion.get(zcta)
    if (regions && countyFips.startsWith('09')) ctByZip[zcta] = best(regions)
  }
  const zctaCount = Object.keys(result).length

  // 8. Add USPS-only zips (PO box / unique / no ZCTA) from GeoNames.
  //    Counties not in the 2020 county list (CT planning regions, retired AK
  //    Valdez-Cordova 02261) are resolved via a same-city ZCTA zip in the state.
  const cityCounty: Record<string, Map<string, Weights>> = {}
  for (const [zip, e] of Object.entries(result)) {
    if (!e.cityName) continue
    const k = `${e.stateAbbr}|${e.cityName.toLowerCase()}`
    addWeights((cityCounty[k] ??= new Map()), e.countyFips, 1, 0, 0)
    if (ctByZip[zip]) addWeights((cityCounty[`CTREGION|${e.cityName.toLowerCase()}`] ??= new Map()), ctByZip[zip], 1, 0, 0)
  }
  let added = 0
  const unresolved: string[] = []
  for (const g of Object.values(geonames)) {
    if (result[g.zip]) continue
    const stFips = abbrToFips[g.state]
    if (!stFips) continue // military APO/FPO, Marshall Islands, etc.
    let countyFips = g.countyFips
    let ctRegion: string | undefined
    if (g.state === 'CT' && /^091[1-9]0$/.test(countyFips)) ctRegion = countyFips
    if (!countyNames[countyFips]) {
      const viaCity = cityCounty[`${g.state}|${g.city.toLowerCase()}`]
      if (viaCity) {
        countyFips = best(viaCity)
      } else if (ctRegion && ctRegionCounty.has(ctRegion)) {
        countyFips = best(ctRegionCounty.get(ctRegion)!)
      } else {
        unresolved.push(`${g.zip} ${g.city}, ${g.state} (${g.countyName} ${countyFips})`)
        continue
      }
    }
    const st = STATE_FIPS_MAP[stFips]
    result[g.zip] = {
      countyFips,
      countyName: countyNames[countyFips],
      stateName: st.name,
      stateAbbr: st.abbr,
      cityName: cityFor(g.zip, st.abbr),
      zcta: false,
    }
    if (st.abbr === 'CT') {
      const region = ctRegion ?? (cityCounty[`CTREGION|${g.city.toLowerCase()}`] && best(cityCounty[`CTREGION|${g.city.toLowerCase()}`]))
      ctByZip[g.zip] = region || best(ctCountyRegion.get(countyFips)!)
    }
    added++
  }
  console.log(`ZCTA zips: ${zctaCount.toLocaleString()}, USPS-only zips added: ${added.toLocaleString()}`)
  if (unresolved.length) console.log(`Unresolved USPS-only zips (skipped): ${unresolved.length}\n  ${unresolved.join('\n  ')}`)

  // 9. Write
  const sorted: Record<string, ZipEntry> = {}
  for (const zip of Object.keys(result).sort()) sorted[zip] = result[zip]
  writeFileSync(join(OUT_DIR, 'zip-county.json'), JSON.stringify(sorted, null, 2) + '\n')

  const byCounty: Record<string, string> = {}
  for (const [county, m] of [...ctCountyRegion.entries()].sort()) byCounty[county] = best(m)
  const byZip: Record<string, string> = {}
  for (const zip of Object.keys(ctByZip).sort()) byZip[zip] = ctByZip[zip]
  writeFileSync(
    join(OUT_DIR, 'ct-planning-regions.json'),
    JSON.stringify(
      {
        _source:
          'Built by scripts/build-zip-county.ts: 2020 blocks → CT town (PL 94-171 COUSUB) → 2022 planning region (Census acs22 cousub file); zip and legacy county assigned to the region with the most housing units.',
        byCounty,
        byZip,
      },
      null,
      2
    ) + '\n'
  )

  // 10. Spot checks
  const checks: [string, string][] = [
    ['94952', '06097'], // Petaluma → Sonoma
    ['98671', '53011'], // Washougal → Clark
    ['30097', '13135'], // Duluth GA → Gwinnett
    ['98683', '53011'],
    ['10001', '36061'],
    ['20500', '11001'], // White House (USPS unique zip)
  ]
  let ok = true
  for (const [zip, fips] of checks) {
    const got = sorted[zip]?.countyFips
    console.log(`  ${got === fips ? 'ok ' : 'BAD'} ${zip} → ${got} (expected ${fips})`)
    if (got !== fips) ok = false
  }
  const ctChecks: [string, string][] = [
    ['06902', '09190'], ['06830', '09190'], ['06810', '09190'],
    ['06708', '09140'], ['06770', '09140'], ['06066', '09110'], ['06268', '09110'],
  ]
  for (const [zip, region] of ctChecks) {
    const got = byZip[zip]
    console.log(`  ${got === region ? 'ok ' : 'BAD'} CT ${zip} → ${got} (expected ${region})`)
    if (got !== region) ok = false
  }
  console.log(`Wrote ${Object.keys(sorted).length.toLocaleString()} zips, ${Object.keys(byZip).length} CT zip regions`)
  if (!ok) process.exit(1)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
