#!/usr/bin/env npx tsx
/**
 * build-county-income.ts
 *
 * County median household income (ACS 2023 5-year, table B19013) — the income
 * fallback for zips with no zip-level ACS value and no residential donor zip
 * (src/lib/data/census-acs.ts), used before the national median.
 *
 * Input (no API key needed): ACS table-based summary file
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-b19013.dat
 * cached in $GEO_CACHE_DIR (default: <os tmpdir>/whatchanged-geo-cache).
 * Rows are GEO_ID|B19013_E001|B19013_M001; counties are 0500000US{fips}
 * (Connecticut as 2022 planning regions 09110–09190, Puerto Rico municipios
 * included). Census jam values (negative, e.g. -666666666) are dropped.
 *
 * Output: src/lib/data/county-income.json
 *   { _source, year, national: number, byCounty: { [fips]: medianIncome } }
 *
 * Run: npx tsx scripts/build-county-income.ts
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

export {}

const YEAR = 2023
const CACHE = process.env.GEO_CACHE_DIR ?? join(tmpdir(), 'whatchanged-geo-cache')
const OUT = join(__dirname, '..', 'src', 'lib', 'data', 'county-income.json')
const URL_B19013 = `https://www2.census.gov/programs-surveys/acs/summary_file/${YEAR}/table-based-SF/data/5YRData/acsdt5y${YEAR}-b19013.dat`

async function download(url: string, dest: string): Promise<string> {
  if (existsSync(dest)) return dest
  console.log(`  downloading ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': 'whatchanged-build/1.0' } })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
  return dest
}

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const file = await download(URL_B19013, join(CACHE, `acsdt5y${YEAR}-b19013.dat`))
  const byCounty: Record<string, number> = {}
  let national: number | null = null
  let dropped = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const nat = /^0100000US\|(\d+)\|/.exec(line)
    if (nat) national = Number(nat[1])
    const m = /^0500000US(\d{5})\|(-?\d+)\|/.exec(line)
    if (!m) continue
    const v = Number(m[2])
    if (Number.isFinite(v) && v > 0) byCounty[m[1]] = v
    else dropped++
  }
  const n = Object.keys(byCounty).length
  if (n < 3000 || !national) throw new Error(`Unexpected B19013 contents (${n} counties, national ${national})`)
  writeFileSync(
    OUT,
    JSON.stringify({
      _source: `Census ACS ${YEAR} 5-year B19013 median household income by county (table-based summary file), built by scripts/build-county-income.ts`,
      year: YEAR,
      national,
      byCounty,
    }) + '\n'
  )
  console.log(`county-income.json: ${n} counties (${dropped} without an estimate), national ${national}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
