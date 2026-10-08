#!/usr/bin/env npx tsx
/**
 * build-census-acs.ts
 *
 * Builds src/lib/data/census-acs.json — Census ACS 2023 5-year estimates by ZCTA (zip code
 * tabulation area) — from the Census Bureau's table-based summary files (keyless bulk download):
 *
 *   B19013_E001 — Median household income  (acsdt5y2023-b19013.dat)
 *   B25064_E001 — Median gross rent         (acsdt5y2023-b25064.dat)
 *
 * Suppressed estimates (Census annotation values such as -666666666, "too few sample
 * observations") are stored as null. NEVER substitute a national or other synthetic value here:
 * the app uses medianRent as a zip's own local rent (the base of the Shelter card's $ figure), so a
 * placeholder would be shown as if it were local data. A zip is written when at least one of the
 * two figures is published.
 *
 * Top-coded values pass through as published (rent "3,500+" is reported as 3501, income
 * "250,000+" as 250001). A rent median that falls in the open-ended top or bottom interval of the
 * distribution (Census MOE annotation -333333333: "3,500+" / "100-") is marked rentCoded 'top' / 'bottom'
 * so the site can say so ("$3,500+", top-coded) and never lends it to another zip as a donor.
 *
 * Run with: npx tsx scripts/build-census-acs.ts [--raw <dir for the .dat files>]
 * (files missing from --raw are downloaded into it; default dir: $TMPDIR/census-acs-raw)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const YEAR = 2023
const SF_BASE = `https://www2.census.gov/programs-surveys/acs/summary_file/${YEAR}/table-based-SF/data/5YRData`
const FILES = {
  income: { file: `acsdt5y${YEAR}-b19013.dat`, col: 'B19013_E001' },
  rent: { file: `acsdt5y${YEAR}-b25064.dat`, col: 'B25064_E001', moe: 'B25064_M001' },
} as const
/** Summary-file GEO_ID prefix for ZCTAs (summary level 860). */
const ZCTA_PREFIX = '860Z200US'

const OUTPUT_PATH = resolve(process.cwd(), 'src/lib/data/census-acs.json')

interface AcsEntry {
  medianIncome: number | null
  medianRent: number | null
  /** The median falls in the open-ended top ("3,500+") or bottom ("100-") interval of B25064. */
  rentCoded?: 'top' | 'bottom'
  year: number
}

/** Census MOE annotation: the median falls in the lowest or highest interval of an open-ended distribution. */
const OPEN_INTERVAL = '-333333333'

/** Published estimate, or null for a Census annotation (negative sentinel) / blank / non-number. */
function parseEstimate(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null
  const v = Number(raw)
  if (!Number.isFinite(v) || v <= 0) return null
  return Math.round(v)
}

async function ensureFile(dir: string, file: string): Promise<string> {
  const path = join(dir, file)
  if (existsSync(path)) return path
  const url = `${SF_BASE}/${file}`
  console.log(`Downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Census summary file download failed: ${res.status} ${res.statusText} (${url})`)
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  return path
}

/** ZCTA → raw estimate string for one column of a pipe-delimited summary file. */
function readZctaColumn(path: string, col: string): Map<string, string> {
  const lines = readFileSync(path, 'utf8').split('\n')
  const header = lines[0].split('|')
  const idx = header.indexOf(col)
  const geo = header.indexOf('GEO_ID')
  if (idx < 0 || geo < 0) throw new Error(`${path}: missing ${col} or GEO_ID column`)
  const out = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const p = line.split('|')
    if (p[geo]?.startsWith(ZCTA_PREFIX)) out.set(p[geo].slice(ZCTA_PREFIX.length), p[idx])
  }
  if (out.size < 30000) throw new Error(`${path}: only ${out.size} ZCTA rows`)
  return out
}

async function main() {
  const ai = process.argv.indexOf('--raw')
  const dir = ai > 0 ? process.argv[ai + 1] : join(tmpdir(), 'census-acs-raw')
  mkdirSync(dir, { recursive: true })
  const income = readZctaColumn(await ensureFile(dir, FILES.income.file), FILES.income.col)
  const rentPath = await ensureFile(dir, FILES.rent.file)
  const rent = readZctaColumn(rentPath, FILES.rent.col)
  const rentMoe = readZctaColumn(rentPath, FILES.rent.moe)
  let top = 0
  let bottom = 0

  const result: Record<string, AcsEntry> = {}
  let both = 0
  let rentOnly = 0
  let incomeOnly = 0
  let neither = 0
  for (const zip of [...new Set([...income.keys(), ...rent.keys()])].sort()) {
    const medianIncome = parseEstimate(income.get(zip))
    const medianRent = parseEstimate(rent.get(zip))
    if (medianIncome === null && medianRent === null) {
      neither++
      continue
    }
    if (medianIncome !== null && medianRent !== null) both++
    else if (medianRent !== null) rentOnly++
    else incomeOnly++
    const coded = medianRent !== null && rentMoe.get(zip)?.trim() === OPEN_INTERVAL
      ? (medianRent >= 3500 ? 'top' : 'bottom')
      : undefined
    if (coded === 'top') top++
    if (coded === 'bottom') bottom++
    result[zip] = { medianIncome, medianRent, ...(coded ? { rentCoded: coded } : {}), year: YEAR }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + '\n')
  console.log(`Rent medians in an open-ended interval: ${top} top-coded (3,500+), ${bottom} bottom-coded (100-)`)
  console.log(
    `ZCTAs: ${income.size} | written ${Object.keys(result).length} (income+rent ${both}, rent only ${rentOnly}, ` +
      `income only, rent suppressed → null ${incomeOnly}) | skipped, both suppressed ${neither}`
  )
  console.log(`Written to ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
