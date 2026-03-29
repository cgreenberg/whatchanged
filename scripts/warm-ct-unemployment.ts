#!/usr/bin/env npx tsx
/**
 * warm-ct-unemployment.ts
 *
 * 1. Deletes ALL CT old county FIPS unemployment cache keys (data + :failed).
 *    Old county FIPS: 09001, 09003, 09005, 09007, 09009, 09011, 09013, 09015
 *
 * 2. Fetches fresh unemployment data from BLS for all 9 CT planning regions
 *    in a SINGLE batched API call (minimises BLS quota usage).
 *
 * 3. Writes each result to Redis keyed by the OLD county FIPS that the app
 *    uses for cache lookup, with a 7-day TTL.
 *
 * Mapping (old county FIPS → new planning region FIPS):
 *   09001 → 09120  Fairfield          → Greater Bridgeport
 *   09003 → 09110  Hartford           → Capitol
 *   09005 → 09160  Litchfield         → Northwest Hills
 *   09007 → 09130  Middlesex          → Lower CT River Valley
 *   09009 → 09170  New Haven          → South Central CT
 *   09011 → 09180  New London         → Southeastern CT
 *   09013 → 09150  Tolland            → Northeastern CT
 *   09015 → 09150  Windham            → Northeastern CT (same planning region)
 *
 * Run with: npx tsx scripts/warm-ct-unemployment.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Env loader — reads .env.local manually
// ---------------------------------------------------------------------------

function loadEnv() {
  try {
    const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex)
      let value = trimmed.slice(eqIndex + 1)
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  } catch {
    // .env.local not found — env vars should already be set externally
  }
}

loadEnv()

// ---------------------------------------------------------------------------
// Imports (after env is loaded so API keys are available)
// ---------------------------------------------------------------------------

import { Redis } from '@upstash/redis'

// ---------------------------------------------------------------------------
// Types (mirrors src/types/index.ts)
// ---------------------------------------------------------------------------

interface UnemploymentPoint {
  date: string // YYYY-MM
  rate: number
}

interface UnemploymentData {
  current: number
  baseline: number
  change: number
  series: UnemploymentPoint[]
  countyFips: string
  seriesId?: string
  nationalSeries?: UnemploymentPoint[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLS_API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
const NATIONAL_SERIES = 'LNS14000000'
const BASELINE_YEAR = '2025'
const BASELINE_PERIOD = 'M01'
const CACHE_TTL = 604800 // 7 days in seconds

// Old CT county FIPS → new planning region FIPS
const CT_COUNTY_TO_PLANNING_REGION: Record<string, string> = {
  '09001': '09120', // Fairfield → Greater Bridgeport
  '09003': '09110', // Hartford → Capitol
  '09005': '09160', // Litchfield → Northwest Hills
  '09007': '09130', // Middlesex → Lower CT River Valley
  '09009': '09170', // New Haven → South Central CT
  '09011': '09180', // New London → Southeastern CT
  '09013': '09150', // Tolland → Northeastern CT
  '09015': '09150', // Windham → Northeastern CT (same planning region as Tolland)
}

function buildSeriesId(planningRegionFips: string): string {
  return `LAUCN${planningRegionFips}0000000003`
}

// ---------------------------------------------------------------------------
// Redis client
// ---------------------------------------------------------------------------

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN must be set in .env.local')
  }
  return new Redis({ url, token })
}

// ---------------------------------------------------------------------------
// Step 1: Delete all stale CT cache keys (data + negative cache)
// ---------------------------------------------------------------------------

async function deleteStaleKeys(redis: Redis): Promise<void> {
  const oldFipsCodes = Object.keys(CT_COUNTY_TO_PLANNING_REGION)
  const keysToDelete: string[] = []

  for (const fips of oldFipsCodes) {
    keysToDelete.push(`bls:unemployment:${fips}`)
    keysToDelete.push(`bls:unemployment:${fips}:failed`)
  }

  console.log(`Deleting ${keysToDelete.length} stale cache keys...`)
  for (const key of keysToDelete) {
    await redis.del(key)
    console.log(`  DEL ${key}`)
  }
  console.log('Done deleting stale keys.\n')
}

// ---------------------------------------------------------------------------
// Step 2: Fetch all planning region data in a SINGLE BLS API call
// ---------------------------------------------------------------------------

async function fetchAllCtUnemployment(): Promise<Record<string, any[]>> {
  // Deduplicate planning region FIPS (09013 and 09015 both map to 09150)
  const uniquePlanningFips = [...new Set(Object.values(CT_COUNTY_TO_PLANNING_REGION))]
  const seriesIds = uniquePlanningFips.map(buildSeriesId)
  seriesIds.push(NATIONAL_SERIES) // include national in the same call

  console.log(`Sending single BLS POST with ${seriesIds.length} series:`)
  seriesIds.forEach((s) => console.log(`  ${s}`))
  console.log()

  const body: Record<string, unknown> = {
    seriesid: seriesIds,
    startyear: '2016',
    endyear: '2026',
  }
  if (process.env.BLS_API_KEY) {
    body.registrationkey = process.env.BLS_API_KEY
  }

  const response = await fetch(BLS_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`BLS API HTTP error: ${response.status} ${response.statusText}`)
  }

  const json = await response.json()
  if (json.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS API failed: ${json.message?.join(', ') ?? 'unknown error'}`)
  }

  // Index by seriesID
  const seriesResultMap: Record<string, any[]> = {}
  for (const s of json.Results?.series ?? []) {
    seriesResultMap[s.seriesID] = s.data ?? []
  }

  const returnedSeries = Object.keys(seriesResultMap)
  console.log(`BLS returned ${returnedSeries.length} series: ${returnedSeries.join(', ')}\n`)
  return seriesResultMap
}

// ---------------------------------------------------------------------------
// Step 3: Parse one county's data from the batched result map
// ---------------------------------------------------------------------------

function parseCounty(
  oldCountyFips: string,
  planningRegionFips: string,
  seriesResultMap: Record<string, any[]>
): UnemploymentData {
  const seriesId = buildSeriesId(planningRegionFips)
  const rawData = seriesResultMap[seriesId]

  if (!rawData?.length) {
    throw new Error(`No data in BLS response for series ${seriesId}`)
  }

  const validData = rawData.filter(
    (d: any) => d.value !== '-' && d.value !== null && !isNaN(parseFloat(d.value))
  )
  if (!validData.length) {
    throw new Error(`No valid data points for series ${seriesId}`)
  }

  // Sort chronologically (BLS returns newest-first)
  const sorted = [...validData].sort((a: any, b: any) => {
    return `${a.year}-${a.period}`.localeCompare(`${b.year}-${b.period}`)
  })

  const baselineEntry = validData.find(
    (d: any) => d.year === BASELINE_YEAR && d.period === BASELINE_PERIOD
  )
  const baseline = baselineEntry ? parseFloat(baselineEntry.value) : 0
  const current = parseFloat(sorted[sorted.length - 1].value)

  const series: UnemploymentPoint[] = sorted.map((d: any) => ({
    date: `${d.year}-${d.period.replace('M', '')}`,
    rate: parseFloat(d.value),
  }))

  // National series
  let nationalSeries: UnemploymentPoint[] | undefined
  const nationalRaw = seriesResultMap[NATIONAL_SERIES]
  if (nationalRaw?.length) {
    const validNational = nationalRaw.filter(
      (d: any) => d.value !== '-' && d.value !== null && !isNaN(parseFloat(d.value))
    )
    const sortedNational = [...validNational].sort((a: any, b: any) =>
      `${a.year}-${a.period}`.localeCompare(`${b.year}-${b.period}`)
    )
    nationalSeries = sortedNational.map((d: any) => ({
      date: `${d.year}-${d.period.replace('M', '')}`,
      rate: parseFloat(d.value),
    }))
  }

  return {
    current,
    baseline,
    change: parseFloat((current - baseline).toFixed(1)),
    series,
    countyFips: oldCountyFips, // keyed by old FIPS so app cache lookup works
    seriesId,
    ...(nationalSeries ? { nationalSeries } : {}),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== CT Unemployment Cache Warmer ===\n')

  const redis = getRedis()

  // Step 1: Delete stale cache entries for all 8 old CT county FIPS
  await deleteStaleKeys(redis)

  // Step 2: Fetch all planning regions in a single BLS call
  const seriesResultMap = await fetchAllCtUnemployment()

  // Step 3: Parse + cache each old county FIPS
  const results: { fips: string; planningFips: string; success: boolean; error?: string }[] = []

  for (const [oldFips, planningFips] of Object.entries(CT_COUNTY_TO_PLANNING_REGION)) {
    const cacheKey = `bls:unemployment:${oldFips}`
    try {
      const data = parseCounty(oldFips, planningFips, seriesResultMap)
      await redis.set(cacheKey, data, { ex: CACHE_TTL })
      const sign = data.change >= 0 ? '+' : ''
      console.log(
        `  CACHED ${cacheKey} → planning ${planningFips} | ` +
          `current=${data.current}% baseline=${data.baseline}% change=${sign}${data.change}pp | ` +
          `${data.series.length} points | series=${data.seriesId}`
      )
      results.push({ fips: oldFips, planningFips, success: true })
    } catch (err: any) {
      console.error(`  FAILED ${cacheKey} → planning ${planningFips}: ${err.message}`)
      results.push({ fips: oldFips, planningFips, success: false, error: err.message })
    }
  }

  // Summary
  const succeeded = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success)
  console.log(`\n=== Summary: ${succeeded}/${results.length} counties cached successfully ===`)
  if (failed.length > 0) {
    console.log('\nFailed:')
    failed.forEach((r) => console.log(`  ${r.fips} → ${r.planningFips}: ${r.error}`))
    process.exit(1)
  }
  console.log('All CT unemployment data cached successfully.\n')
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
