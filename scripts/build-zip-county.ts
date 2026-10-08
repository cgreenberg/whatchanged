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
 *   2. 2020 PL 94-171 redistricting geoheaders (block POP100 / HU100 / COUSUB; place names and place-by-county
 *      population parts, SUMLEV 160 / 155, for USPS-only zips)
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

/** "Sedona city" → "Sedona", "Juneau city and borough" → "Juneau", "Indianapolis city (balance)" → "Indianapolis". */
function placeBaseName(name: string): string {
  let s = name.replace(/\s*\((balance|part)\)$/, '').replace(/\s+CDP$/, '')
  while (/\s[a-z][a-z]*$/.test(s)) s = s.replace(/\s[a-z][a-z]*$/, '')
  return s
}

/** Comparable place / USPS city name: case, accents, punctuation and St./Ft./Mt. abbreviations ignored. */
function normPlace(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/-/g, ' ')
    .replace(/\b(st|ste)\b/g, (m) => (m === 'st' ? 'saint' : 'sainte'))
    .replace(/\bft\b/g, 'fort')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\s+/g, ' ')
    .trim()
}

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
  /** Place (state FIPS + place code) → population by county (SUMLEV 155, State-Place-County parts). */
  const placeCountyPop = new Map<string, Map<string, number>>()
  /** "ST|normalized place name" → place keys (SUMLEV 160 names, legal/statistical descriptor stripped). */
  const placeByName = new Map<string, string[]>()
  for (const file of plFiles) {
    for await (const line of lines(file, 'latin1')) {
      const c = line.split('|')
      if (c[2] === '155' && c[4] === '00') {
        const key = `${c[12]}${c[29]}`
        const m = placeCountyPop.get(key) ?? new Map<string, number>()
        m.set(`${c[12]}${c[14]}`, (m.get(`${c[12]}${c[14]}`) ?? 0) + Number(c[90]))
        placeCountyPop.set(key, m)
        continue
      }
      if (c[2] === '160' && c[4] === '00') {
        const k = `${c[1]}|${normPlace(placeBaseName(c[87]))}`
        const list = placeByName.get(k) ?? []
        list.push(`${c[12]}${c[29]}`)
        placeByName.set(k, list)
        continue
      }
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

  interface GeoNamesRow { zip: string; city: string; state: string; countyName: string; countyFips: string; lat: number; lng: number }
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
      geonames[f[1]] ??= { zip: f[1], city: f[2], state, countyName: f[5], countyFips, lat: Number(f[9]), lng: Number(f[10]) }
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
  // City/county mismatch for mail-only zips. PO box and unique zips (and ZCTAs with no housing units,
  // e.g. 99519 "Anchorage" = Prudhoe Bay oilfield land in North Slope Borough) are often filed under the
  // county a company or agency operates in, not the post office's. 99519 has 5 housing units (worker
  // camps), so "no housing" means fewer than MAIL_ONLY_MAX_HU. When the zip's city has Census ZCTA
  // zips with housing in this state, none of them in the assigned county, AND GeoNames' own coordinate
  // for the zip lies nearer the city's county than the assigned one, use the city's county. (The
  // coordinate test keeps genuine border cases — Wayne PA, Fairfax city — where they are.)
  // The zip's own evidence overrides the rule: a ZCTA that GeoNames also files under its assigned county, or a zip
  // whose town has >= CITY_SHARE_MIN of its housed ZCTAs' housing units in the assigned county, stays (21240 BWI,
  // 25888 Mount Hope WV).
  const MAIL_ONLY_MAX_HU = 50
  /** A town whose housed ZCTAs hold at least this share of their housing units in a county genuinely extends into it. */
  const CITY_SHARE_MIN = 0.1
  const housed = new Set<string>()
  for (const [zcta, counties] of zctaCounty) {
    if ([...counties.values()].reduce((a, w) => a + w[0], 0) >= MAIL_ONLY_MAX_HU) housed.add(zcta)
  }
  const housedCityCounty: Record<string, Map<string, Weights>> = {}
  /** The city's housed ZCTAs' housing units by county (every county they touch, not only each one's main county). */
  const housedCityHu: Record<string, Map<string, Weights>> = {}
  const countyPts: Record<string, [number, number, number]> = {}
  for (const [zip, e] of Object.entries(result)) {
    if (!housed.has(zip)) continue
    if (e.cityName) {
      const k = `${e.stateAbbr}|${e.cityName.toLowerCase()}`
      addWeights((housedCityCounty[k] ??= new Map()), e.countyFips, 1, 0, 0)
      for (const [c, w] of zctaCounty.get(zip) ?? []) addWeights((housedCityHu[k] ??= new Map()), c, w[0], w[1], w[2])
    }
    const g = geonames[zip]
    if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
      const c = (countyPts[e.countyFips] ??= [0, 0, 0])
      c[0] += g.lat; c[1] += g.lng; c[2]++
    }
  }
  const km = (lat: number, lng: number, county: string): number | null => {
    const c = countyPts[county]
    if (!c) return null
    const [la, lo] = [c[0] / c[2], c[1] / c[2]]
    const x = ((lng - lo) * Math.PI / 180) * Math.cos(((lat + la) / 2) * Math.PI / 180)
    return 6371 * Math.hypot(x, ((lat - la) * Math.PI) / 180)
  }
  const cityFixes: string[] = []
  /** The city's county when the evidence says the assigned county is the operator's, not the post office's. */
  function cityCountyFix(zip: string, stateAbbr: string, countyFips: string, isZcta: boolean): string | null {
    const g = geonames[zip]
    if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lng)) return null
    const city = cityFor(zip, stateAbbr) || g.city
    const key = `${stateAbbr}|${city.toLowerCase()}`
    const via = housedCityCounty[key]
    if (!via || via.has(countyFips)) return null
    // The zip's own evidence wins (round 12): a ZCTA that GeoNames' USPS record also files under the assigned county
    // (21240 BWI airport, "Baltimore" mail, Anne Arundel County) stays; so does a zip whose town's housed ZCTAs have
    // a real share (>= CITY_SHARE_MIN of housing units) in the assigned county (25888 Mount Hope WV: the town is in
    // Fayette, its 25880 ZCTA mostly in Raleigh).
    if (isZcta && g.countyFips === countyFips) return null
    const hu = housedCityHu[key]
    const total = hu ? [...hu.values()].reduce((a, w) => a + w[0], 0) : 0
    if (total > 0 && (hu!.get(countyFips)?.[0] ?? 0) / total >= CITY_SHARE_MIN) return null
    const to = best(via)
    const dTo = km(g.lat, g.lng, to)
    const dFrom = km(g.lat, g.lng, countyFips)
    if (dTo === null || dFrom === null || !(dTo < dFrom)) return null
    cityFixes.push(`${zip} ${city}, ${stateAbbr}: ${countyNames[countyFips]} (${countyFips}) → ${countyNames[to]} (${to}) [${Math.round(dFrom)} km → ${Math.round(dTo)} km]`)
    return to
  }
  // ZCTAs with (almost) no housing units: mail/business/worksite zips
  for (const [zcta, e] of Object.entries(result)) {
    if (housed.has(zcta) || zcta.startsWith('09')) continue
    const to = cityCountyFix(zcta, e.stateAbbr, e.countyFips, true)
    if (to) result[zcta] = { ...e, countyFips: to, countyName: countyNames[to] ?? e.countyName }
  }
  // USPS-only zips (no ZCTA, so no blocks of their own): the county holding the MAJORITY of the population of the
  // Census place the zip is named for (2020 PL 94-171 place-by-county parts, SUMLEV 155). 86339 Sedona AZ: the city is
  // 74% Yavapai, so its PO boxes are Yavapai (GeoNames files them under Coconino). The place must have a part in the
  // county GeoNames files the zip under (so a same-named place elsewhere in the state — Glasgow borough, Beaver County
  // PA, for 16644 Glasgow in Cambria County — never matches). No such place, or no county above half the place's
  // population (New York city: Kings holds 31%) → the GeoNames county and the city rule below.
  // Round 14: only for places under PLACE_POP_MAX people. A big city's stations are spread across its suburbs, and
  // GeoNames' county for them comes from the USPS record (30333 CDC and 39901 IRS Chamblee are "Atlanta" mail filed
  // under DeKalb; Portland's 97281/97291/97298 under Washington), so for big places the GeoNames county stands. "Big"
  // = the Census place OR the postal city (every ZCTA whose USPS city has the same name) has >= PLACE_POP_MAX people:
  // Littleton CO is a 45,652-person city but "Littleton" mail covers ~200k people in Arapahoe, Jefferson and Douglas,
  // so 80162 (Jefferson) and 80163 (Douglas) keep their USPS county. Exception: a GeoNames county holding only a
  // boundary sliver of the place (< SLIVER_POP residents) isn't the place's county (87174 Rio Rancho NM: 6 of 104,046
  // in Bernalillo → Sandoval); Portland's Clackamas part (843) and Littleton's Douglas part (640) are real.
  const PLACE_POP_MAX = 50_000
  const SLIVER_POP = 100
  const postalCityPop = new Map<string, number>()
  for (const [zcta, e] of Object.entries(result)) {
    if (!e.cityName) continue
    const k = `${e.stateAbbr}|${normPlace(e.cityName)}`
    let pop = 0
    for (const w of zctaCounty.get(zcta)?.values() ?? []) pop += w[1]
    postalCityPop.set(k, (postalCityPop.get(k) ?? 0) + pop)
  }
  const placeMoves: string[] = []
  const bigPlaceKept: string[] = []
  let viaPlaceCount = 0
  function placeMajorityCounty(city: string, stateAbbr: string, geonamesCounty: string, zip: string): string | null {
    if (!city) return null
    const keys = (placeByName.get(`${stateAbbr}|${normPlace(city)}`) ?? []).filter((k) => placeCountyPop.get(k)?.has(geonamesCounty))
    if (keys.length !== 1) return null
    const parts = placeCountyPop.get(keys[0])
    if (!parts) return null
    const total = [...parts.values()].reduce((a, b) => a + b, 0)
    const top = [...parts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    if (!top || total <= 0 || top[1] * 2 <= total || !countyNames[top[0]]) return null
    const postal = postalCityPop.get(`${stateAbbr}|${normPlace(city)}`) ?? 0
    const inGeonames = parts.get(geonamesCounty) ?? 0
    if ((total >= PLACE_POP_MAX || postal >= PLACE_POP_MAX) && inGeonames >= SLIVER_POP) {
      if (top[0] !== geonamesCounty) {
        bigPlaceKept.push(`${zip} ${city}, ${stateAbbr}: kept ${countyNames[geonamesCounty] ?? geonamesCounty} (${geonamesCounty}, ${inGeonames.toLocaleString()} of ${total.toLocaleString()} place pop; postal city ${postal.toLocaleString()}); majority ${countyNames[top[0]]} (${top[0]})`)
      }
      return null
    }
    viaPlaceCount++
    return top[0]
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
    // The named place's majority county (round 13) — else the GeoNames county, corrected by the city rule
    const viaPlace = placeMajorityCounty(cityFor(g.zip, g.state) || g.city, g.state, countyFips, g.zip)
    if (viaPlace) {
      if (viaPlace !== countyFips) {
        placeMoves.push(`${g.zip} ${cityFor(g.zip, g.state) || g.city}, ${g.state}: ${countyNames[countyFips] ?? countyFips} (${countyFips}) → ${countyNames[viaPlace]} (${viaPlace})`)
      }
      countyFips = viaPlace
    } else if (countyNames[countyFips] && !ctRegion) countyFips = cityCountyFix(g.zip, g.state, countyFips, false) ?? countyFips
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
  console.log(`Mail-only zips moved to their city's county: ${cityFixes.length}\n  ${cityFixes.join('\n  ')}`)
  console.log(`USPS-only zips assigned by their place's majority county: ${viaPlaceCount}; differing from GeoNames: ${placeMoves.length}\n  ${placeMoves.join('\n  ')}`)
  console.log(`USPS-only zips of big places (place or postal city >= ${PLACE_POP_MAX.toLocaleString()} people) kept in their GeoNames county: ${bigPlaceKept.length}\n  ${bigPlaceKept.join('\n  ')}`)
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
    ['86339', '04025'], // Sedona PO boxes → Yavapai (74% of Sedona city's population)
    ['30333', '13089'], // CDC, "Atlanta" mail filed under DeKalb (big place: GeoNames county stands)
    ['80163', '08035'], // "Littleton" mail (big postal city) filed under Douglas stays
    ['87174', '35043'], // Rio Rancho PO boxes: none of Rio Rancho's people live in Bernalillo → Sandoval
    ['25888', '54019'], // Mount Hope WV PO boxes → Fayette
    ['21240', '24003'], // BWI airport ZCTA → Anne Arundel
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
