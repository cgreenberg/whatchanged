#!/usr/bin/env npx tsx
/**
 * warm-unemployment-06053.ts
 *
 * Warms Redis cache for Monterey County, CA unemployment data (FIPS 06053).
 * Clears any negative cache entry, fetches fresh PROCESSED data from BLS via
 * fetchUnemployment(), and writes the UnemploymentData object to Redis with
 * the standard 7-day TTL.
 *
 * Run with: npx tsx scripts/warm-unemployment-06053.ts
 *
 * Previous version was BROKEN: it stored the raw BLS API response ({status,
 * Results, series...}) instead of the processed UnemploymentData object.
 * This version calls fetchUnemployment() which returns the correct shape.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Env loader — reads .env.local manually (same pattern as preload-cache.ts)
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
// Imports (after env is loaded so BLS_API_KEY is available)
// ---------------------------------------------------------------------------

import { fetchUnemployment } from '../src/lib/api/bls'
import { setCached, deleteCached } from '../src/lib/cache/kv'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COUNTY_FIPS = '06053'
const CACHE_KEY = `bls:unemployment:${COUNTY_FIPS}`
const FAILED_KEY = `${CACHE_KEY}:failed`
const TTL_SECONDS = 604800 // 7 days

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nWarming unemployment cache for Monterey County, CA (FIPS ${COUNTY_FIPS})`)
  console.log('='.repeat(60))

  // Step 1: Delete corrupted key and negative cache entry
  console.log(`\n[1/4] Deleting corrupted key "${CACHE_KEY}" and negative cache "${FAILED_KEY}"...`)
  await deleteCached(CACHE_KEY)
  await deleteCached(FAILED_KEY)
  console.log('      Done.')

  // Step 2: Fetch processed data via fetchUnemployment() — returns UnemploymentData, not raw BLS JSON
  console.log(`\n[2/4] Fetching processed unemployment data from BLS for FIPS ${COUNTY_FIPS}...`)
  let unemploymentData
  try {
    unemploymentData = await fetchUnemployment(COUNTY_FIPS)
  } catch (err) {
    console.error('FATAL: fetchUnemployment() failed:', err)
    process.exit(1)
  }

  // Step 3: Validate the result
  console.log(`\n[3/4] Validating result...`)
  const { current, baseline, change, series, countyFips, seriesId, nationalSeries } = unemploymentData

  if (typeof current !== 'number' || isNaN(current)) {
    console.error('ERROR: current is not a valid number:', current)
    process.exit(1)
  }
  if (typeof baseline !== 'number') {
    console.error('ERROR: baseline is not a valid number:', baseline)
    process.exit(1)
  }
  if (!Array.isArray(series) || series.length === 0) {
    console.error('ERROR: series is empty or not an array')
    process.exit(1)
  }

  console.log(`      current       : ${current}`)
  console.log(`      baseline      : ${baseline}`)
  console.log(`      change        : ${change}`)
  console.log(`      series.length : ${series.length}`)
  console.log(`      countyFips    : ${countyFips}`)
  console.log(`      seriesId      : ${seriesId}`)
  console.log(`      nationalSeries: ${nationalSeries ? nationalSeries.length + ' points' : 'none'}`)

  // Step 4: Write the processed UnemploymentData object to Redis
  console.log(`\n[4/4] Writing processed data to Redis key "${CACHE_KEY}" (TTL: ${TTL_SECONDS}s / 7 days)...`)
  await setCached(CACHE_KEY, unemploymentData, TTL_SECONDS)
  console.log('      Write complete.')

  console.log('\n' + '='.repeat(60))
  console.log('Cache warm complete.')
  console.log(`  County FIPS : ${COUNTY_FIPS}`)
  console.log(`  Cache key   : ${CACHE_KEY}`)
  console.log(`  current     : ${current}%`)
  console.log(`  baseline    : ${baseline}%`)
  console.log(`  change      : ${change}pp`)
  console.log(`  data points : ${series.length}`)
  console.log('')
}

main().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
