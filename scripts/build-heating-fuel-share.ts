#!/usr/bin/env npx tsx
/**
 * build-heating-fuel-share.ts
 *
 * Builds src/lib/data/heating-fuel-share.json: for each state (50 + DC + PR), the share of
 * occupied housing units heated mainly with fuel oil/kerosene and with bottled/tank gas
 * (propane), from Census ACS table B25040 "House Heating Fuel" (latest 1-year release).
 * The home-heating graph shows a fuel's tab only where that share is meaningful.
 *
 *   B25040_001E  Total occupied housing units
 *   B25040_003E  Bottled, tank, or LP gas (propane, butane, etc.)   → propane
 *   B25040_005E  Fuel oil, kerosene, etc.                           → oil
 *
 * Source: the Census API when CENSUS_API_KEY is set (never logged); otherwise the keyless
 * table-based summary file acsdt1y{YEAR}-b25040.dat.
 *
 * Run with: npx tsx scripts/build-heating-fuel-share.ts [--year 2024] [--raw <dir>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { STATE_FIPS_MAP } from '../src/lib/mappings/state-fips'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const YEAR = Number(arg('--year') ?? 2024)
const RAW = arg('--raw') ?? join(tmpdir(), 'census-acs-raw')
const OUTPUT_PATH = resolve(process.cwd(), 'src/lib/data/heating-fuel-share.json')
const SF_FILE = `acsdt1y${YEAR}-b25040.dat`
const SF_URL = `https://www2.census.gov/programs-surveys/acs/summary_file/${YEAR}/table-based-SF/data/1YRData/${SF_FILE}`

type Counts = { total: number; propane: number; oil: number }

async function viaApi(key: string): Promise<Map<string, Counts>> {
  const url = `https://api.census.gov/data/${YEAR}/acs/acs1?get=B25040_001E,B25040_003E,B25040_005E&for=state:*&key=${encodeURIComponent(key)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Census API request failed: ${res.status} ${res.statusText}`)
  const rows = (await res.json()) as string[][]
  const h = rows[0]
  const [t, p, o, s] = ['B25040_001E', 'B25040_003E', 'B25040_005E', 'state'].map((c) => h.indexOf(c))
  if ([t, p, o, s].some((i) => i < 0)) throw new Error(`Unexpected Census API headers: ${JSON.stringify(h)}`)
  return new Map(rows.slice(1).map((r) => [r[s], { total: Number(r[t]), propane: Number(r[p]), oil: Number(r[o]) }]))
}

async function viaSummaryFile(): Promise<Map<string, Counts>> {
  mkdirSync(RAW, { recursive: true })
  const path = join(RAW, SF_FILE)
  if (!existsSync(path)) {
    console.log(`Downloading ${SF_URL}`)
    const res = await fetch(SF_URL)
    if (!res.ok) throw new Error(`Census summary file download failed: ${res.status} ${res.statusText}`)
    writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  }
  const lines = readFileSync(path, 'utf8').split('\n')
  const h = lines[0].split('|')
  const [g, t, p, o] = ['GEO_ID', 'B25040_E001', 'B25040_E003', 'B25040_E005'].map((c) => h.indexOf(c))
  if ([g, t, p, o].some((i) => i < 0)) throw new Error(`${path}: unexpected header`)
  const out = new Map<string, Counts>()
  for (const line of lines.slice(1)) {
    const r = line.split('|')
    const m = /^0400000US(\d{2})$/.exec(r[g] ?? '')
    if (m) out.set(m[1], { total: Number(r[t]), propane: Number(r[p]), oil: Number(r[o]) })
  }
  return out
}

const pct = (n: number, d: number) => Math.round((n / d) * 1000) / 10

async function main() {
  const key = process.env.CENSUS_API_KEY
  const counts = key ? await viaApi(key) : await viaSummaryFile()
  const states: Record<string, { oil: number; propane: number; name: string }> = {}
  for (const [fips, c] of [...counts.entries()].sort()) {
    const st = STATE_FIPS_MAP[fips]
    if (!st) continue
    if (![c.total, c.propane, c.oil].every((v) => Number.isFinite(v) && v >= 0) || !(c.total > 0)) {
      throw new Error(`Bad B25040 counts for ${st.abbr}: ${JSON.stringify(c)}`)
    }
    states[st.abbr] = { oil: pct(c.oil, c.total), propane: pct(c.propane, c.total), name: st.name }
  }
  const n = Object.keys(states).length
  if (n < 51) throw new Error(`Only ${n} states in B25040 ${YEAR}`)
  const sorted = Object.fromEntries(Object.keys(states).sort().map((k) => [k, states[k]]))
  const out = {
    meta: {
      source: 'U.S. Census Bureau, American Community Survey',
      table: 'B25040',
      dataset: 'acs/acs1',
      vintage: YEAR,
      url: `https://data.census.gov/table/ACSDT1Y${YEAR}.B25040`,
    },
    states: sorted,
  }
  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n')
  console.log(`Wrote ${n} states (ACS ${YEAR} 1-year, ${key ? 'Census API' : 'summary file'}) to ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
