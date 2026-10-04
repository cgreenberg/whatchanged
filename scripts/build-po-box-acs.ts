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
 * Donors must have an ACS median income in census-acs.json. A ZCTA's county is
 * its zip-county.json county (most housing units).
 *
 * Inputs (no API key needed): ACS table-based summary files
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-{b25001,b01003}.dat
 * cached in $GEO_CACHE_DIR (default: <os tmpdir>/whatchanged-geo-cache).
 *
 * Output: src/lib/data/po-box-acs.json  { byZip: { [poZip]: donorZip } }
 *
 * Run: npx tsx scripts/build-po-box-acs.ts   (after build:zip-county / build:census-acs)
 */
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

interface ZipEntry {
  countyFips: string
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

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const hu = readZctaTable(await download(`${SF_BASE}/acsdt5y2023-b25001.dat`, join(CACHE, 'acsdt5y2023-b25001.dat')))
  const pop = readZctaTable(await download(`${SF_BASE}/acsdt5y2023-b01003.dat`, join(CACHE, 'acsdt5y2023-b01003.dat')))
  if (hu.size < 30000 || pop.size < 30000) throw new Error(`Too few ZCTAs (hu ${hu.size}, pop ${pop.size})`)

  const zips = JSON.parse(readFileSync(join(DATA_DIR, 'zip-county.json'), 'utf8')) as Record<string, ZipEntry>
  const acs = JSON.parse(readFileSync(join(DATA_DIR, 'census-acs.json'), 'utf8')) as Record<
    string,
    { medianIncome?: number } | undefined
  >

  // Donor candidates per county
  const byCounty = new Map<string, string[]>()
  for (const [zip, e] of Object.entries(zips)) {
    if (e.zcta === false || !(acs[zip]?.medianIncome && acs[zip]!.medianIncome! > 0)) continue
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

  writeFileSync(
    join(DATA_DIR, 'po-box-acs.json'),
    JSON.stringify({
      _source:
        'Built by scripts/build-po-box-acs.ts: USPS-only zip → ZCTA in the same county and city with the most housing units (ACS 2023 B25001), else the most populous ZCTA in the county (B01003).',
      byZip,
    }) + '\n'
  )
  console.log(`po-box-acs.json: ${sameCity} same-city donors, ${county} county donors, ${none} without a donor`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
