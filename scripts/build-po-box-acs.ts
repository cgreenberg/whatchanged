#!/usr/bin/env npx tsx
/**
 * build-po-box-acs.ts
 *
 * USPS-only zips (PO boxes, unique zips such as 20500 — `zcta: false` in
 * zip-county.json) have no Census ZCTA, so no ACS income/rent. This script
 * picks, for each of them, a residential "donor" ZCTA whose ACS values are
 * shown instead (always labeled as an estimate in the UI):
 *
 *   1. the ZCTA in the same county with the same city name that has the most
 *      housing units (ACS 2023 5-year B25001), else
 *   2. the most populous ZCTA in the same county (ACS 2023 5-year B01003).
 *
 * Donors must have both a published ACS median income and a published median rent in census-acs.json
 * (a suppressed rent is null there), so a PO-box zip never borrows a donor whose rent can't back a $ figure. A ZCTA's county is
 * its zip-county.json county (most housing units).
 *
 * Inputs (no API key needed): ACS table-based summary files
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-{b25001,b01003,b25064}.dat
 * the Census 2023 ZCTA gazetteer
 *   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip
 * and GeoNames US zip points (https://download.geonames.org/export/zip/US.zip, for USPS-only zips),
 * cached in $GEO_CACHE_DIR (default: <os tmpdir>/whatchanged-geo-cache). Needs `unzip` on PATH.
 *
 * Every other zip whose own ACS median rent is suppressed (or missing) also gets a rent basis, so the
 * Shelter card's "≈ $/yr in rent" is never blank and never a national constant (owner decision, round 11):
 *
 *   nearest  — the nearest residential ZCTA in the SAME county with a published median rent (same city name
 *              preferred; distance between Census 2023 gazetteer ZCTA points, else GeoNames zip points), with miles;
 *              at most NEAREST_MAX_MILES away (vast Alaska boroughs: a village hundreds of miles off is less
 *              representative than the borough's own median, which is used instead);
 *   counties — the county's ACS 2023 5-year median gross rent (B25064, county rows; published values only);
 *   states   — the state's ACS 2023 5-year median gross rent (B25064, state rows).
 *
 * src/lib/data/census-acs.ts picks, in order: own zip → PO-box donor → nearest → county → state.
 *
 * Output: src/lib/data/po-box-acs.json
 *   { byZip: { [poZip]: donorZip }, nearest: { [zip]: [donorZip, miles] },
 *     counties: { [countyFips]: { rent, name } }, states: { [ST]: { rent, name } } }
 *

 * Run: npx tsx scripts/build-po-box-acs.ts   (after build:zip-county / build:census-acs)
 */
import { execFileSync } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

export {}

const CACHE = process.env.GEO_CACHE_DIR ?? join(tmpdir(), 'whatchanged-geo-cache')
const DATA_DIR = join(__dirname, '..', 'src', 'lib', 'data')
const SF_BASE =
  'https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData'

const GAZ_URL = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip'
const GEONAMES_US = 'https://download.geonames.org/export/zip/US.zip'

interface ZipEntry {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
  zcta?: false
}

async function download(url: string, dest: string): Promise<string> {
  if (existsSync(dest)) return dest
  console.log(`  downloading ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': 'whatchanged-build/1.0' } })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
  return dest
}

/** ZCTA → estimate from a table-based summary file (GEO_ID|E001|M001). */
function readZctaTable(file: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^860Z200US(\d{5})\|(-?\d+)/.exec(line)
    if (m) out.set(m[1], Number(m[2]))
  }
  return out
}

/** County / state rows of a table-based summary file: published estimates only (negative = suppressed). */
function readGeoTable(file: string, prefix: '0500000US' | '0400000US'): Map<string, number> {
  const out = new Map<string, number>()
  const re = new RegExp(`^${prefix}(\\d+)\\|(-?\\d+)`)
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = re.exec(line)
    if (m && Number(m[2]) > 0) out.set(m[1], Number(m[2]))
  }
  return out
}

/** Zip → [lat, lng]: Census gazetteer ZCTA points, GeoNames for zips the gazetteer lacks (USPS-only zips). */
function readPoints(gazZip: string, geonamesZip: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  const gaz = execFileSync('unzip', ['-p', gazZip], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  for (const line of gaz.split('\n').slice(1)) {
    const f = line.split('\t').map((x) => x.trim())
    if (/^\d{5}$/.test(f[0]) && Number.isFinite(Number(f[5])) && Number.isFinite(Number(f[6]))) out.set(f[0], [Number(f[5]), Number(f[6])])
  }
  const gn = execFileSync('unzip', ['-p', geonamesZip, 'US.txt'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  for (const line of gn.split('\n')) {
    const f = line.split('\t')
    if (f.length > 10 && /^\d{5}$/.test(f[1]) && !out.has(f[1]) && f[9] && f[10]) out.set(f[1], [Number(f[9]), Number(f[10])])
  }
  return out
}

/** Great-circle distance in miles. */
function miles([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const r = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Farther than this, the county median is a better stand-in than one distant zip. */
const NEAREST_MAX_MILES = 100

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const hu = readZctaTable(await download(`${SF_BASE}/acsdt5y2023-b25001.dat`, join(CACHE, 'acsdt5y2023-b25001.dat')))
  const pop = readZctaTable(await download(`${SF_BASE}/acsdt5y2023-b01003.dat`, join(CACHE, 'acsdt5y2023-b01003.dat')))
  if (hu.size < 30000 || pop.size < 30000) throw new Error(`Too few ZCTAs (hu ${hu.size}, pop ${pop.size})`)

  const zips = JSON.parse(readFileSync(join(DATA_DIR, 'zip-county.json'), 'utf8')) as Record<string, ZipEntry>
  const acs = JSON.parse(readFileSync(join(DATA_DIR, 'census-acs.json'), 'utf8')) as Record<
    string,
    { medianIncome?: number | null; medianRent?: number | null } | undefined
  >

  // Donor candidates per county
  const byCounty = new Map<string, string[]>()
  for (const [zip, e] of Object.entries(zips)) {
    const a = acs[zip]
    if (e.zcta === false || !(a?.medianIncome && a.medianIncome > 0) || !(a.medianRent && a.medianRent > 0)) continue
    const list = byCounty.get(e.countyFips) ?? []
    list.push(zip)
    byCounty.set(e.countyFips, list)
  }

  const pick = (cands: string[], primary: Map<string, number>, secondary: Map<string, number>) =>
    [...cands].sort(
      (a, b) =>
        (primary.get(b) ?? 0) - (primary.get(a) ?? 0) ||
        (secondary.get(b) ?? 0) - (secondary.get(a) ?? 0) ||
        a.localeCompare(b)
    )[0]

  const byZip: Record<string, string> = {}
  let sameCity = 0
  let county = 0
  let none = 0
  for (const [zip, e] of Object.entries(zips).sort(([a], [b]) => a.localeCompare(b))) {
    if (e.zcta !== false || acs[zip]) continue
    const cands = byCounty.get(e.countyFips) ?? []
    const city = cands.filter((z) => e.cityName && norm(zips[z].cityName) === norm(e.cityName))
    if (city.length) {
      byZip[zip] = pick(city, hu, pop)
      sameCity++
    } else if (cands.length) {
      byZip[zip] = pick(cands, pop, hu)
      county++
    } else {
      none++
    }
  }

  // ---- Rent basis for every other zip without its own published median rent ----
  const rentTable = await download(`${SF_BASE}/acsdt5y2023-b25064.dat`, join(CACHE, 'acsdt5y2023-b25064.dat'))
  const countyRent = readGeoTable(rentTable, '0500000US')
  const stateRent = readGeoTable(rentTable, '0400000US')
  const points = readPoints(
    await download(GAZ_URL, join(CACHE, '2023_Gaz_zcta_national.zip')),
    await download(GEONAMES_US, join(CACHE, 'geonames-US.zip'))
  )
  if (countyRent.size < 3000 || stateRent.size < 50 || points.size < 33000) {
    throw new Error(`Too few rows (county rent ${countyRent.size}, state rent ${stateRent.size}, points ${points.size})`)
  }

  // Residential donors with a published median rent (income not required here: only the rent is borrowed)
  const rentDonors = new Map<string, string[]>()
  for (const [zip, e] of Object.entries(zips)) {
    const r = acs[zip]?.medianRent
    if (e.zcta === false || !(typeof r === 'number' && r > 0)) continue
    const list = rentDonors.get(e.countyFips) ?? []
    list.push(zip)
    rentDonors.set(e.countyFips, list)
  }

  const nearest: Record<string, [string, number]> = {}
  const counties: Record<string, { rent: number; name: string }> = {}
  const states: Record<string, { rent: number; name: string }> = {}
  let nNearest = 0
  let nNoPoint = 0
  for (const [zip, e] of Object.entries(zips).sort(([a], [b]) => a.localeCompare(b))) {
    const own = acs[zip]?.medianRent
    if (typeof own === 'number' && own > 0) continue
    if (byZip[zip] && !acs[zip]) continue // PO-box donor (src/lib/data/census-acs.ts uses it first)
    const here = points.get(zip)
    const cands = (rentDonors.get(e.countyFips) ?? []).filter((z) => z !== zip && points.has(z))
    if (here && cands.length) {
      const sameCity = cands.filter((z) => e.cityName && norm(zips[z].cityName) === norm(e.cityName))
      const pool = sameCity.length ? sameCity : cands
      const best = pool
        .map((z) => [z, miles(here, points.get(z)!)] as [string, number])
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]
      if (best[1] <= NEAREST_MAX_MILES) {
        nearest[zip] = [best[0], Math.round(best[1] * 10) / 10]
        nNearest++
      }
    } else if (!here && cands.length) {
      nNoPoint++
    }
  }
  // County and state medians for every county/state the crosswalk uses (published values only)
  for (const e of Object.values(zips)) {
    const c = countyRent.get(e.countyFips)
    if (c && !counties[e.countyFips]) counties[e.countyFips] = { rent: c, name: `${e.countyName}, ${e.stateAbbr}` }
    const s = stateRent.get(e.countyFips.slice(0, 2))
    if (s && !states[e.stateAbbr]) states[e.stateAbbr] = { rent: s, name: e.stateName }
  }

  writeFileSync(
    join(DATA_DIR, 'po-box-acs.json'),
    JSON.stringify({
      _source:
        'Built by scripts/build-po-box-acs.ts. byZip: USPS-only zip → ZCTA in the same county and city with the most housing units (ACS 2023 B25001), else the most populous ZCTA in the county (B01003). ' +
        'nearest: zip without its own published ACS median rent → [nearest residential ZCTA in the same county with one (same city preferred), miles] (Census 2023 gazetteer points). ' +
        'counties / states: ACS 2023 5-year median gross rent (B25064), published values only.',
      byZip,
      nearest,
      counties,
      states,
    }) + '\n'
  )
  console.log(`po-box-acs.json: ${sameCity} same-city donors, ${county} county donors, ${none} without a donor`)
  console.log(`  rent basis: ${nNearest} nearest-zip donors (${nNoPoint} zips without a point), ${Object.keys(counties).length} county medians, ${Object.keys(states).length} state medians`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
