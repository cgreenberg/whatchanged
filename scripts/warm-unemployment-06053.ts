#!/usr/bin/env npx tsx
/**
 * warm-unemployment-06053.ts
 *
 * Warms Redis cache for Monterey County, CA unemployment data (FIPS 06053).
 * Clears any negative cache entry, fetches fresh data from BLS, and writes
 * it to Redis with the standard 7-day TTL.
 *
 * Run with: npx tsx scripts/warm-unemployment-06053.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { Redis } from '@upstash/redis'

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
// Redis client
// ---------------------------------------------------------------------------

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN in environment')
  }
  return new Redis({ url, token })
}

// ---------------------------------------------------------------------------
// BLS fetch (mirrors logic in src/lib/api/bls.ts)
// ---------------------------------------------------------------------------

const BLS_API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
const COUNTY_FIPS = '06053'
const SERIES_ID = `LAUCN${COUNTY_FIPS}0000000003`
const NATIONAL_SERIES = 'LNS14000000'
const CACHE_KEY = `bls:unemployment:${COUNTY_FIPS}`
const FAILED_KEY = `${CACHE_KEY}:failed`
const TTL_SECONDS = 604800 // 7 days

async function fetchFromBLS(): Promise<unknown> {
  const currentYear = new Date().getFullYear().toString()

  const body: Record<string, unknown> = {
    seriesid: [SERIES_ID, NATIONAL_SERIES],
    startyear: '2016',
    endyear: currentYear,
  }

  if (process.env.BLS_API_KEY) {
    body.registrationkey = process.env.BLS_API_KEY
    console.log('Using BLS_API_KEY for higher rate limits')
  } else {
    console.warn('No BLS_API_KEY set — using anonymous rate limit (25 req/day)')
  }

  console.log(`Fetching BLS series: ${SERIES_ID} (+ national ${NATIONAL_SERIES})`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  let json: any
  try {
    const response = await fetch(BLS_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`BLS API HTTP error: ${response.status} ${response.statusText}`)
    }

    json = await response.json()
  } finally {
    clearTimeout(timeout)
  }

  if (json.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS API returned status: ${json.status} — ${JSON.stringify(json.message)}`)
  }

  return json
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nWarming unemployment cache for Monterey County, CA (FIPS ${COUNTY_FIPS})`)
  console.log('='.repeat(60))

  const redis = getRedis()

  // Step 1: Delete negative cache entry if it exists
  console.log(`\n[1/4] Checking for negative cache entry: ${FAILED_KEY}`)
  const failedEntry = await redis.get(FAILED_KEY)
  if (failedEntry !== null) {
    await redis.del(FAILED_KEY)
    console.log('      Deleted negative cache entry.')
  } else {
    console.log('      No negative cache entry found.')
  }

  // Step 2: Fetch fresh data from BLS
  console.log(`\n[2/4] Fetching fresh BLS unemployment data...`)
  let blsData: any
  try {
    blsData = await fetchFromBLS()
  } catch (err) {
    console.error('FATAL: BLS fetch failed:', err)
    process.exit(1)
  }

  // Step 3: Log summary of what we got
  console.log(`\n[3/4] Validating response...`)
  const series = blsData?.Results?.series ?? []
  console.log(`      Series returned: ${series.length}`)

  let countyPoints = 0
  let latestRate: number | null = null

  for (const s of series) {
    const dataPoints = s.data ?? []
    if (s.seriesID === SERIES_ID) {
      countyPoints = dataPoints.length
      if (dataPoints.length > 0) {
        // BLS data is newest-first
        const latest = dataPoints[0]
        latestRate = parseFloat(latest.value)
        console.log(
          `      County series (${SERIES_ID}): ${countyPoints} points, latest = ${latest.value}% (${latest.year} ${latest.period})`
        )
      } else {
        console.warn(`      County series returned 0 data points — BLS may not have data for this county`)
      }
    } else if (s.seriesID === NATIONAL_SERIES) {
      console.log(`      National series (${NATIONAL_SERIES}): ${dataPoints.length} points`)
    }
  }

  if (countyPoints === 0) {
    console.error('ERROR: No county data points returned. Aborting cache write.')
    process.exit(1)
  }

  // Step 4: Write to Redis
  console.log(`\n[4/4] Writing to Redis with key "${CACHE_KEY}" (TTL: ${TTL_SECONDS}s / 7 days)...`)
  await redis.set(CACHE_KEY, blsData, { ex: TTL_SECONDS })
  console.log('      Write complete.')

  console.log('\n' + '='.repeat(60))
  console.log('Cache warm complete.')
  console.log(`  County FIPS : ${COUNTY_FIPS}`)
  console.log(`  Cache key   : ${CACHE_KEY}`)
  console.log(`  Data points : ${countyPoints}`)
  if (latestRate !== null) {
    console.log(`  Latest rate : ${latestRate}%`)
  }
  console.log('')
}

main().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
