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
 * Donors must have both a published ACS median income and a RELIABLE published median rent (see below), so a
 * PO-box zip never borrows a donor whose rent can't back a $ figure. A ZCTA's county is its zip-county.json county
 * (most housing units).
 *
 * Reliable donor rent (round 12): the ZCTA's B25064 median has a margin of error (90%) of at most 30% of the
 * estimate (MAX_DONOR_MOE_SHARE), and is not top- or bottom-coded (MOE annotation -333333333: "3,500+" / "100-",
 * which says only that the median is at least $3,500 / under $100). A zip with no reliable donor uses the county
 * median, then the state median. (A zip's OWN coded median is still shown for that zip, labeled "$3,500+".)
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
 *   nearest  — the nearest residential ZCTA in the SAME county with a reliable median rent, at most
 *              NEAREST_MAX_MILES away (vast Alaska boroughs: a village hundreds of miles off is less representative
 *              than the borough's own median, which is used instead); within that cap a ZCTA with the same city name
 *              is preferred (flagged when that passes over a nearer zip, so the label says "nearest in the same town"). Distance between Census 2023
 *              gazetteer ZCTA points, else GeoNames zip points;
 *   counties — the county's ACS 2023 5-year median gross rent (B25064, county rows; published values only). Census
 *              reports Connecticut by its 9 planning regions (FIPS 09110-09190), not the legacy counties zip-county.json
 *              uses, so CT zips use their planning region's median (ct-planning-regions.json byZip, else byCounty),
 *              stored under the region FIPS and named "... Planning Region, CT";
 *   states   — the state's ACS 2023 5-year median gross rent (B25064, state rows).
 *
 * Representative donors (round 13): a PO-box or nearest donor whose rent is outside [county median / 1.5, county
 * median × 1.5] (DONOR_BAND) is dropped and the zip uses its county median (listed in `unrepresentative`, labeled).
 *
 * src/lib/data/census-acs.ts picks, in order: own zip → PO-box donor → nearest → county → state.
 *
 * Output: src/lib/data/po-box-acs.json
 *   { byZip: { [poZip]: donorZip }, nearest: { [zip]: [donorZip, miles] | [donorZip, miles, 1 (same town)] },
 *     donorMoe: { [donorZip]: B25064 margin of error, $ (90%) }, unrepresentative: { [zip]: [rejectedDonor, rent] },
 *     counties: { [countyFips]: { rent, name } },
 *     states: { [ST]: { rent, name } } }
 *

 * Run: npx tsx scripts/build-po-box-acs.ts   (after build:zip-county / build:census-acs)
 */
import { execFileSync } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { CT_PLANNING_REGION_NAMES } from '../src/lib/mappings/laus-area'

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

/** ZCTA → raw B25064 margin-of-error cell (GEO_ID|E001|M001), annotations included (e.g. -333333333). */
function readZctaMoe(file: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^860Z200US(\d{5})\|-?\d+\|(-?\d+)/.exec(line)
    if (m) out.set(m[1], Number(m[2]))
  }
  return out
}

/** Largest margin of error (90%, as a share of the estimate) a borrowed donor rent may carry. */
const MAX_DONOR_MOE_SHARE = 0.3
/** Census MOE annotations: median in an open-ended (top/bottom) interval; estimate controlled (no sampling error). */
const MOE_OPEN_INTERVAL = -333333333
const MOE_CONTROLLED = -555555555

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
/** A donor rent more than this factor above or below the county median is not representative: county median instead. */
const DONOR_BAND = 1.5

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const hu = readZctaTable(await download(`${SF_BASE}/acsdt5y2023-b25001.dat`, join(CACHE, 'acsdt5y2023-b25001.dat')))
  const pop = readZctaTable(await download(`${SF_BASE}/acsdt5y2023-b01003.dat`, join(CACHE, 'acsdt5y2023-b01003.dat')))
  if (hu.size < 30000 || pop.size < 30000) throw new Error(`Too few ZCTAs (hu ${hu.size}, pop ${pop.size})`)

  const zips = JSON.parse(readFileSync(join(DATA_DIR, 'zip-county.json'), 'utf8')) as Record<string, ZipEntry>
  const acs = JSON.parse(readFileSync(join(DATA_DIR, 'census-acs.json'), 'utf8')) as Record<
    string,
    { medianIncome?: number | null; medianRent?: number | null; rentCoded?: 'top' | 'bottom' } | undefined
  >
  const ct = JSON.parse(readFileSync(join(DATA_DIR, 'ct-planning-regions.json'), 'utf8')) as {
    byZip: Record<string, string>
    byCounty: Record<string, string>
  }

  const rentTable = await download(`${SF_BASE}/acsdt5y2023-b25064.dat`, join(CACHE, 'acsdt5y2023-b25064.dat'))
  const rentMoe = readZctaMoe(rentTable)
  if (rentMoe.size < 30000) throw new Error(`Too few ZCTA rent MOEs (${rentMoe.size})`)
  /** A donor rent: published, not top/bottom-coded, MOE ≤ MAX_DONOR_MOE_SHARE of the estimate. */
  const unreliable = { coded: 0, moe: 0 }
  const reliableRent = (zip: string): boolean => {
    const r = acs[zip]?.medianRent
    if (!(typeof r === 'number' && r > 0)) return false
    const moe = rentMoe.get(zip)
    if (acs[zip]?.rentCoded || moe === MOE_OPEN_INTERVAL) return false
    if (moe === MOE_CONTROLLED) return true
    return typeof moe === 'number' && moe > 0 && moe <= MAX_DONOR_MOE_SHARE * r
  }
  for (const [zip, e] of Object.entries(zips)) {
    const r = acs[zip]?.medianRent
    if (e.zcta === false || !(typeof r === 'number' && r > 0) || reliableRent(zip)) continue
    if (acs[zip]?.rentCoded || rentMoe.get(zip) === MOE_OPEN_INTERVAL) unreliable.coded++
    else unreliable.moe++
  }

  // Donor candidates per county
  const byCounty = new Map<string, string[]>()
  for (const [zip, e] of Object.entries(zips)) {
    const a = acs[zip]
    if (e.zcta === false || !(a?.medianIncome && a.medianIncome > 0) || !reliableRent(zip)) continue
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
  const countyRent = readGeoTable(rentTable, '0500000US')
  const stateRent = readGeoTable(rentTable, '0400000US')
  const points = readPoints(
    await download(GAZ_URL, join(CACHE, '2023_Gaz_zcta_national.zip')),
    await download(GEONAMES_US, join(CACHE, 'geonames-US.zip'))
  )
  if (countyRent.size < 3000 || stateRent.size < 50 || points.size < 33000) {
    throw new Error(`Too few rows (county rent ${countyRent.size}, state rent ${stateRent.size}, points ${points.size})`)
  }

  // Residential donors with a reliable median rent (income not required here: only the rent is borrowed)
  const rentDonors = new Map<string, string[]>()
  for (const [zip, e] of Object.entries(zips)) {
    if (e.zcta === false || !reliableRent(zip)) continue
    const list = rentDonors.get(e.countyFips) ?? []
    list.push(zip)
    rentDonors.set(e.countyFips, list)
  }

  const nearest: Record<string, [string, number] | [string, number, 1]> = {}
  const counties: Record<string, { rent: number; name: string }> = {}
  const states: Record<string, { rent: number; name: string }> = {}
  let nNearest = 0
  let nSameTown = 0
  let nNoPoint = 0
  for (const [zip, e] of Object.entries(zips).sort(([a], [b]) => a.localeCompare(b))) {
    const own = acs[zip]?.medianRent
    if (typeof own === 'number' && own > 0) continue
    if (byZip[zip] && !acs[zip]) continue // PO-box donor (src/lib/data/census-acs.ts uses it first)
    const here = points.get(zip)
    const cands = (rentDonors.get(e.countyFips) ?? []).filter((z) => z !== zip && points.has(z))
    if (here && cands.length) {
      // The 100-mile cap first, then the same-town preference within it (a same-town zip 150 mi off never beats
      // the county median)
      const near = cands
        .map((z) => [z, miles(here, points.get(z)!)] as [string, number])
        .filter(([, d]) => d <= NEAREST_MAX_MILES)
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      const sameTown = near.filter(([z]) => e.cityName && norm(zips[z].cityName) === norm(e.cityName))
      const best = sameTown[0] ?? near[0]
      if (best) {
        const mi = Math.round(best[1] * 10) / 10
        // Flagged only when the same-town rule passed over a nearer zip (else "nearest" is literally true)
        const townRule = best[0] !== near[0][0]
        nearest[zip] = townRule ? [best[0], mi, 1] : [best[0], mi]
        nNearest++
        if (townRule) nSameTown++
      }
    } else if (!here && cands.length) {
      nNoPoint++
    }
  }
  // County and state medians for every county/state the crosswalk uses (published values only)
  for (const [zip, e] of Object.entries(zips)) {
    const c = countyRent.get(e.countyFips)
    if (c && !counties[e.countyFips]) counties[e.countyFips] = { rent: c, name: `${e.countyName}, ${e.stateAbbr}` }
    // Connecticut: ACS county rows are the 2022 planning regions
    const region = e.stateAbbr === 'CT' ? ct.byZip[zip] ?? ct.byCounty[e.countyFips] : undefined
    const rr = region ? countyRent.get(region) : undefined
    if (region && rr && !counties[region]) counties[region] = { rent: rr, name: `${CT_PLANNING_REGION_NAMES[region] ?? region}, CT` }
    const s = stateRent.get(e.countyFips.slice(0, 2))
    if (s && !states[e.stateAbbr]) states[e.stateAbbr] = { rent: s, name: e.stateName }
  }

  // Representative donors only (round 13): a borrowed rent outside [county median / DONOR_BAND, county median ×
  // DONOR_BAND] says more about the donor zip than about this one (39356: $130 vs Jasper County MS $809; 59440: $1,339
  // vs Chouteau County MT $485), so the zip uses its county median instead (labeled by census-acs.ts, which names the
  // rejected donor). Applies to PO-box donors and nearest-zip donors alike; CT compares with the planning region.
  const countyMedianOf = (zip: string, e: ZipEntry): number | undefined =>
    countyRent.get(e.stateAbbr === 'CT' ? ct.byZip[zip] ?? ct.byCounty[e.countyFips] ?? e.countyFips : e.countyFips)
  const unrepresentative: Record<string, [string, number]> = {}
  const band = { poBox: 0, nearest: 0 }
  const outsideBand = (zip: string, donor: string): number | null => {
    const c = countyMedianOf(zip, zips[zip])
    const r = acs[donor]?.medianRent
    if (!c || typeof r !== 'number') return null
    return r > c * DONOR_BAND || r < c / DONOR_BAND ? r : null
  }
  for (const [zip, donor] of Object.entries(byZip)) {
    const r = outsideBand(zip, donor)
    if (r === null) continue
    delete byZip[zip]
    unrepresentative[zip] = [donor, r]
    band.poBox++
  }
  for (const [zip, n] of Object.entries(nearest)) {
    const r = outsideBand(zip, n[0])
    if (r === null) continue
    delete nearest[zip]
    unrepresentative[zip] = [n[0], r]
    band.nearest++
    nNearest--
    if (n[2] === 1) nSameTown--
  }

  // Margin of error of every donor used (shown in the trace; tests check the ≤30% rule against it)
  const donorMoe: Record<string, number> = {}
  for (const d of [...Object.values(byZip), ...Object.values(nearest).map((n) => n[0])]) {
    const m = rentMoe.get(d)
    if (typeof m === 'number' && m > 0) donorMoe[d] = m
  }

  writeFileSync(
    join(DATA_DIR, 'po-box-acs.json'),
    JSON.stringify({
      _source:
        'Built by scripts/build-po-box-acs.ts. byZip: USPS-only zip → ZCTA in the same county and city with the most housing units (ACS 2023 B25001), else the most populous ZCTA in the county (B01003). ' +
        'Donors need a reliable B25064 median rent: margin of error <= 30% of the estimate and not top/bottom-coded (3,500+ / 100-). ' +
        'nearest: zip without its own published ACS median rent → [nearest residential ZCTA in the same county with a reliable one within 100 mi, miles, 1 if a same-town zip was preferred over a nearer one] (Census 2023 gazetteer points). ' +
        'donorMoe: donor zip → B25064 margin of error ($, 90%). ' +
        'unrepresentative: zip → [rejected donor zip, its median rent] — the donor rent was outside [county median / 1.5, county median × 1.5], so the zip uses its county median. ' +
        'counties / states: ACS 2023 5-year median gross rent (B25064), published values only; Connecticut zips use their 2022 planning region (keys 09110-09190).',
      byZip,
      nearest,
      donorMoe,
      unrepresentative: Object.fromEntries(Object.entries(unrepresentative).sort(([a], [b]) => a.localeCompare(b))),
      counties,
      states,
    }) + '\n'
  )
  console.log(`po-box-acs.json: ${sameCity} same-city donors, ${county} county donors, ${none} without a donor`)
  console.log(`  unreliable as donors: ${unreliable.coded} top/bottom-coded, ${unreliable.moe} MOE > ${MAX_DONOR_MOE_SHARE * 100}% or not computable`)
  console.log(`  unrepresentative donors → county median: ${band.poBox + band.nearest} (${band.poBox} PO-box, ${band.nearest} nearest-zip)`)
  console.log(`  rent basis: ${nNearest} nearest-zip donors (${nSameTown} same-town, ${nNoPoint} zips without a point), ${Object.keys(counties).length} county medians, ${Object.keys(states).length} state medians`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
