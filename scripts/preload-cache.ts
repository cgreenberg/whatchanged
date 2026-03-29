#!/usr/bin/env npx tsx
/**
 * preload-cache.ts
 *
 * Preloads static and semi-static data into Upstash Redis.
 * Run with: npx tsx scripts/preload-cache.ts
 *
 * Sections:
 *   1. Gas Prices (EIA) — city, state, PAD district, national
 *   2. BLS National Data — national unemployment + CPI series
 *   2b. BLS Regional + National CPI — 4 regional + national CPI under bls:cpi:{areaCode}:all keys
 *   3. Top 50 Counties — county-level unemployment (BLS LAUS)
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { Redis } from '@upstash/redis'

// ---------------------------------------------------------------------------
// Env loader — reads .env.local manually so we don't need dotenv installed
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
      // Strip surrounding quotes
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

// Support both naming conventions (KV_REST_API_URL from Vercel dashboard and
// UPSTASH_REDIS_REST_URL used by the app's kv.ts adapter)
const redisUrl =
  process.env.KV_REST_API_URL ??
  process.env.UPSTASH_REDIS_REST_URL

const redisToken =
  process.env.KV_REST_API_TOKEN ??
  process.env.UPSTASH_REDIS_REST_TOKEN

if (!redisUrl || !redisToken) {
  console.error(
    'ERROR: Missing Redis credentials. Set KV_REST_API_URL and KV_REST_API_TOKEN in .env.local'
  )
  process.exit(1)
}

const redis = new Redis({ url: redisUrl, token: redisToken })

// ---------------------------------------------------------------------------
// TTL constants
// ---------------------------------------------------------------------------

const TTL_25_HOURS = 90000      // ~25 hours — main gas price cache
const TTL_7_DAYS   = 604800     // 7 days — BLS unemployment / CPI
const TTL_1_YEAR   = 31536000   // 1 year — Jan 2025 baselines

// ---------------------------------------------------------------------------
// Shared stats
// ---------------------------------------------------------------------------

const stats = {
  stored: 0,
  failed: 0,
  gas:          { stored: 0, failed: 0 },
  blsNational:  { stored: 0, failed: 0 },
  blsCpiRegion: { stored: 0, failed: 0 },
  blsCounty:    { stored: 0, failed: 0 },
}

const startTime = Date.now()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function store<T>(
  key: string,
  value: T,
  ttl: number,
) {
  await redis.set(key, value, { ex: ttl })
  stats.stored++
}

// ---------------------------------------------------------------------------
// Section 1: Gas Prices (EIA)
// ---------------------------------------------------------------------------

const EIA_API_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'
const GAS_BASELINE_DATE = '2025-01-20'

// Each entry: cacheKey suffix → EIA duoarea code + human label
interface GasSeriesSpec {
  cacheKey: string       // full cache key
  duoarea:  string       // EIA duoarea code
  label:    string       // human-readable region label
}

const GAS_SERIES: GasSeriesSpec[] = [
  // Tier 1 cities
  { cacheKey: 'eia:gas:city:Y48SE', duoarea: 'Y48SE', label: 'Seattle area avg'       },
  { cacheKey: 'eia:gas:city:Y05LA', duoarea: 'Y05LA', label: 'Los Angeles area avg'   },
  { cacheKey: 'eia:gas:city:Y05SF', duoarea: 'Y05SF', label: 'San Francisco area avg' },
  { cacheKey: 'eia:gas:city:Y35NY', duoarea: 'Y35NY', label: 'New York City area avg' },
  { cacheKey: 'eia:gas:city:YBOS',  duoarea: 'YBOS',  label: 'Boston area avg'        },
  { cacheKey: 'eia:gas:city:YORD',  duoarea: 'YORD',  label: 'Chicago area avg'       },
  { cacheKey: 'eia:gas:city:YDEN',  duoarea: 'YDEN',  label: 'Denver area avg'        },
  { cacheKey: 'eia:gas:city:Y44HO', duoarea: 'Y44HO', label: 'Houston area avg'       },
  { cacheKey: 'eia:gas:city:YMIA',  duoarea: 'YMIA',  label: 'Miami area avg'         },
  { cacheKey: 'eia:gas:city:YCLE',  duoarea: 'YCLE',  label: 'Cleveland area avg'     },

  // Tier 2 states
  { cacheKey: 'eia:gas:state:WA', duoarea: 'SWA', label: 'Washington state avg' },
  { cacheKey: 'eia:gas:state:CA', duoarea: 'SCA', label: 'California state avg' },
  { cacheKey: 'eia:gas:state:CO', duoarea: 'SCO', label: 'Colorado state avg'   },
  { cacheKey: 'eia:gas:state:FL', duoarea: 'SFL', label: 'Florida state avg'    },
  { cacheKey: 'eia:gas:state:MN', duoarea: 'SMN', label: 'Minnesota state avg'  },
  { cacheKey: 'eia:gas:state:NY', duoarea: 'SNY', label: 'New York state avg'   },
  { cacheKey: 'eia:gas:state:OH', duoarea: 'SOH', label: 'Ohio state avg'       },
  { cacheKey: 'eia:gas:state:TX', duoarea: 'STX', label: 'Texas state avg'      },

  // Tier 3 PAD districts
  { cacheKey: 'eia:gas:pad:1A', duoarea: 'R1X', label: 'New England (PADD 1A) avg'       },
  { cacheKey: 'eia:gas:pad:1B', duoarea: 'R1Y', label: 'Central Atlantic (PADD 1B) avg'  },
  { cacheKey: 'eia:gas:pad:1C', duoarea: 'R1Z', label: 'Lower Atlantic (PADD 1C) avg'    },
  { cacheKey: 'eia:gas:pad:2', duoarea: 'R20', label: 'Midwest avg'          },
  { cacheKey: 'eia:gas:pad:3', duoarea: 'R30', label: 'Gulf Coast avg'       },
  { cacheKey: 'eia:gas:pad:4', duoarea: 'R40', label: 'Rocky Mountain avg'   },
  { cacheKey: 'eia:gas:pad:5', duoarea: 'R50', label: 'West Coast avg'       },

  // National (always last so we can reuse it for other series)
  { cacheKey: 'eia:gas:national', duoarea: 'NUS', label: 'National avg' },
]

interface GasSeriesPoint {
  date:  string
  price: number
}

interface GasPriceData {
  current:            number
  baseline:           number
  change:             number
  region:             string
  geoLevel:           string
  isNationalFallback: boolean
  series:             GasSeriesPoint[]
  nationalSeries?:    GasSeriesPoint[]
}

async function fetchEiaRawData(duoarea: string, apiKey: string): Promise<any[]> {
  const params = new URLSearchParams({
    api_key:              apiKey,
    frequency:            'weekly',
    'data[0]':            'value',
    'facets[product][]':  'EPM0',
    'facets[duoarea][]':  duoarea,
    'sort[0][column]':    'period',
    'sort[0][direction]': 'desc',
    length:               '520',
  })

  const response = await fetch(`${EIA_API_BASE}?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`EIA API ${response.status} for duoarea ${duoarea}`)
  }

  const json = await response.json()
  const data: any[] = json?.response?.data ?? []
  if (!data.length) {
    throw new Error(`No EIA data returned for duoarea ${duoarea}`)
  }
  return data
}

function buildGasSeries(data: any[]): {
  series:     GasSeriesPoint[]
  current:    number
  baseline:   number
  regionName: string
} {
  const sorted = [...data]
    .sort((a, b) => a.period.localeCompare(b.period))
    .filter((d) => d.value !== null && d.value !== '--' && !isNaN(parseFloat(d.value)))
    .map((d) => ({ date: d.period, price: parseFloat(d.value) }))

  if (!sorted.length) throw new Error('No valid price data after filtering')

  const current = sorted[sorted.length - 1].price

  const baselineTime = new Date(GAS_BASELINE_DATE).getTime()
  const onOrBefore   = sorted.filter((d) => new Date(d.date).getTime() <= baselineTime)
  const baselinePoint = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : sorted[0]

  const regionName = data[0]['area-name'] ?? data[0].duoarea ?? 'Unknown'

  return { series: sorted, current, baseline: baselinePoint.price, regionName }
}

async function preloadGasPrices() {
  console.log('\n=== Section 1: Gas Prices (EIA) ===')

  const apiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'
  if (apiKey === 'DEMO_KEY') {
    console.warn('  WARNING: EIA_API_KEY not set — using DEMO_KEY (rate-limited)')
  }

  // Always fetch national first so we can embed it in other series
  let nationalSeries: GasSeriesPoint[] | undefined

  console.log('  Fetching national series first...')
  try {
    const rawNational = await fetchEiaRawData('NUS', apiKey)
    const { series, current, baseline, regionName } = buildGasSeries(rawNational)
    nationalSeries = series

    const nationalData: GasPriceData = {
      current,
      baseline,
      change:             parseFloat((current - baseline).toFixed(3)),
      region:             regionName,
      geoLevel:           'National avg',
      isNationalFallback: true,
      series,
    }

    await store('eia:gas:national', nationalData, TTL_25_HOURS)

    // Baseline key
    const baselinePoint = series.filter((d) => new Date(d.date).getTime() <= new Date(GAS_BASELINE_DATE).getTime())
    const bl = baselinePoint.length > 0 ? baselinePoint[baselinePoint.length - 1] : series[0]
    await redis.set('baseline:jan2025:gas:national', { price: bl.price, date: bl.date }, { ex: TTL_1_YEAR })
    stats.stored++

    stats.gas.stored++
    console.log(`  ✓ national (NUS): $${current.toFixed(3)}/gal`)
  } catch (err) {
    stats.gas.failed++
    stats.failed++
    console.error(`  ✗ national (NUS):`, err instanceof Error ? err.message : err)
  }

  // Process remaining series in batches of 5, with 500ms delay between batches
  const remaining = GAS_SERIES.filter((s) => s.cacheKey !== 'eia:gas:national')
  const BATCH_SIZE = 5

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE)

    await Promise.allSettled(
      batch.map(async (spec) => {
        try {
          const raw = await fetchEiaRawData(spec.duoarea, apiKey)
          const { series, current, baseline, regionName } = buildGasSeries(raw)

          const data: GasPriceData = {
            current,
            baseline,
            change:             parseFloat((current - baseline).toFixed(3)),
            region:             regionName,
            geoLevel:           spec.label,
            isNationalFallback: false,
            series,
            ...(nationalSeries ? { nationalSeries } : {}),
          }

          await store(spec.cacheKey, data, TTL_25_HOURS)

          // Baseline key
          const baselineTime  = new Date(GAS_BASELINE_DATE).getTime()
          const onOrBefore    = series.filter((d) => new Date(d.date).getTime() <= baselineTime)
          const bl            = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : series[0]
          const baselineKeyId = spec.cacheKey.replace('eia:gas:', '')
          await redis.set(`baseline:jan2025:gas:${baselineKeyId}`, { price: bl.price, date: bl.date }, { ex: TTL_1_YEAR })
          stats.stored++

          stats.gas.stored++
          console.log(`  ✓ ${spec.cacheKey}: $${current.toFixed(3)}/gal`)
        } catch (err) {
          stats.gas.failed++
          stats.failed++
          console.error(`  ✗ ${spec.cacheKey}:`, err instanceof Error ? err.message : err)
        }
      })
    )

    // Delay between batches (skip after last batch)
    if (i + BATCH_SIZE < remaining.length) {
      await sleep(500)
    }
  }

  console.log(`  Gas prices: ${stats.gas.stored} stored, ${stats.gas.failed} failed`)
}

// ---------------------------------------------------------------------------
// Section 2: BLS National Data
// ---------------------------------------------------------------------------

const BLS_API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
const BLS_BASELINE_YEAR   = '2025'
const BLS_BASELINE_PERIOD = 'M01'

const NATIONAL_UNEMPLOYMENT_SERIES = 'LNS14000000'
const NATIONAL_GROCERIES_SERIES    = 'CUUR0000SAF11'
const NATIONAL_SHELTER_SERIES      = 'CUUR0000SAH1'
const NATIONAL_ENERGY_SERIES       = 'CUUR0000SA0E'

interface BlsPoint {
  year:   string
  period: string
  value:  string
}

function sortBlsData(data: BlsPoint[]): BlsPoint[] {
  return [...data].sort((a, b) => {
    const aKey = `${a.year}-${a.period}`
    const bKey = `${b.year}-${b.period}`
    return aKey.localeCompare(bKey)
  })
}

function filterValidBls(data: BlsPoint[]): BlsPoint[] {
  return data.filter((d) => d.value !== '-' && d.value !== null && !isNaN(parseFloat(d.value)))
}

async function postBls(seriesIds: string[], startYear: string, endYear: string): Promise<any> {
  const body: Record<string, unknown> = {
    seriesid:  seriesIds,
    startyear: startYear,
    endyear:   endYear,
  }
  if (process.env.BLS_API_KEY) {
    body.registrationkey = process.env.BLS_API_KEY
  }

  const response = await fetch(BLS_API_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`BLS API ${response.status} ${response.statusText}`)
  }

  const json = await response.json()
  if (json.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS API failed: ${json.message?.join(', ') ?? 'unknown error'}`)
  }

  return json
}

async function preloadBlsNational() {
  console.log('\n=== Section 2: BLS National Data ===')

  if (!process.env.BLS_API_KEY) {
    console.warn('  WARNING: BLS_API_KEY not set — rate limit is 25 req/day')
  }

  const currentYear = new Date().getFullYear().toString()

  try {
    const json = await postBls(
      [
        NATIONAL_UNEMPLOYMENT_SERIES,
        NATIONAL_GROCERIES_SERIES,
        NATIONAL_SHELTER_SERIES,
        NATIONAL_ENERGY_SERIES,
      ],
      '2020',
      currentYear
    )

    const seriesMap: Record<string, BlsPoint[]> = {}
    for (const s of json.Results?.series ?? []) {
      seriesMap[s.seriesID] = s.data ?? []
    }

    // --- National Unemployment ---
    const rawUnemp = filterValidBls(seriesMap[NATIONAL_UNEMPLOYMENT_SERIES] ?? [])
    if (rawUnemp.length) {
      const sorted = sortBlsData(rawUnemp)
      const unempSeries = sorted.map((d) => ({
        date: `${d.year}-${d.period.replace('M', '')}`,
        rate: parseFloat(d.value),
      }))

      // NOTE: This key is supplementary — the app reads national unemployment
      // embedded inside per-county objects (bls:unemployment:{fips}), not this key directly.
      await redis.set('bls:national:unemployment', unempSeries, { ex: TTL_7_DAYS })
      stats.stored++

      // Baseline
      const bl = rawUnemp.find((d) => d.year === BLS_BASELINE_YEAR && d.period === BLS_BASELINE_PERIOD)
      if (bl) {
        await redis.set('baseline:jan2025:unemployment:national', { rate: parseFloat(bl.value), date: `${bl.year}-${bl.period}` }, { ex: TTL_1_YEAR })
        stats.stored++
      }

      const latest = sorted[sorted.length - 1]
      console.log(`  ✓ national unemployment: ${latest.value}% (${latest.year}-${latest.period})`)
      stats.blsNational.stored++
    } else {
      console.error('  ✗ national unemployment: no data')
      stats.blsNational.failed++
      stats.failed++
    }

    // --- Helper: build CPI period map ---
    // NOTE: The CPI cache keys below (bls:national:cpi:*) are supplementary data
    // and are not directly consumed by the app's runtime cache lookups.
    // The app reads CPI under `bls:cpi:{areaCode}:all` keys. These preloaded
    // national keys may be useful for future features.
    function buildPeriodMap(data: BlsPoint[]): Map<string, number> {
      const map = new Map<string, number>()
      for (const d of data) {
        const val = parseFloat(d.value)
        if (isNaN(val) || d.value === '-') continue
        map.set(`${d.year}-${d.period}`, val)
      }
      return map
    }

    // --- National Groceries CPI ---
    const rawGroceries = seriesMap[NATIONAL_GROCERIES_SERIES] ?? []
    if (rawGroceries.length) {
      const gMap = buildPeriodMap(rawGroceries)
      const periods = [...gMap.keys()].sort()

      const groceriesCurrent  = gMap.get(periods[periods.length - 1]) ?? 0
      const blKey             = `${BLS_BASELINE_YEAR}-${BLS_BASELINE_PERIOD}`
      const groceriesBaseline = gMap.get(blKey) ?? 0
      const groceriesChange   = groceriesBaseline > 0
        ? parseFloat(((groceriesCurrent - groceriesBaseline) / groceriesBaseline * 100).toFixed(1))
        : 0

      await redis.set('bls:national:cpi:groceries', { groceriesCurrent, groceriesBaseline, groceriesChange }, { ex: TTL_7_DAYS })
      stats.stored++

      if (groceriesBaseline > 0) {
        await redis.set('baseline:jan2025:cpi:groceries:national', { value: groceriesBaseline, date: blKey }, { ex: TTL_1_YEAR })
        stats.stored++
      }

      console.log(`  ✓ national groceries CPI: ${groceriesCurrent} (baseline ${groceriesBaseline}, ${groceriesChange > 0 ? '+' : ''}${groceriesChange}%)`)
      stats.blsNational.stored++
    } else {
      console.error('  ✗ national groceries CPI: no data')
      stats.blsNational.failed++
      stats.failed++
    }

    // --- National Shelter CPI ---
    const rawShelter = seriesMap[NATIONAL_SHELTER_SERIES] ?? []
    if (rawShelter.length) {
      const sMap = buildPeriodMap(rawShelter)
      const periods = [...sMap.keys()].sort()

      const shelterCurrent  = sMap.get(periods[periods.length - 1]) ?? 0
      const blKey           = `${BLS_BASELINE_YEAR}-${BLS_BASELINE_PERIOD}`
      const shelterBaseline = sMap.get(blKey) ?? 0
      const shelterChange   = shelterBaseline > 0
        ? parseFloat(((shelterCurrent - shelterBaseline) / shelterBaseline * 100).toFixed(1))
        : 0

      await redis.set('bls:national:cpi:shelter', { shelterCurrent, shelterBaseline, shelterChange }, { ex: TTL_7_DAYS })
      stats.stored++

      if (shelterBaseline > 0) {
        await redis.set('baseline:jan2025:cpi:shelter:national', { value: shelterBaseline, date: blKey }, { ex: TTL_1_YEAR })
        stats.stored++
      }

      console.log(`  ✓ national shelter CPI: ${shelterCurrent} (baseline ${shelterBaseline}, ${shelterChange > 0 ? '+' : ''}${shelterChange}%)`)
      stats.blsNational.stored++
    } else {
      console.error('  ✗ national shelter CPI: no data')
      stats.blsNational.failed++
      stats.failed++
    }

    // --- National Energy CPI ---
    const rawEnergy = seriesMap[NATIONAL_ENERGY_SERIES] ?? []
    if (rawEnergy.length) {
      const eMap = buildPeriodMap(rawEnergy)
      const periods = [...eMap.keys()].sort()

      const energyCurrent  = eMap.get(periods[periods.length - 1]) ?? 0
      const blKey          = `${BLS_BASELINE_YEAR}-${BLS_BASELINE_PERIOD}`
      const energyBaseline = eMap.get(blKey) ?? 0
      const energyChange   = energyBaseline > 0
        ? parseFloat(((energyCurrent - energyBaseline) / energyBaseline * 100).toFixed(1))
        : 0

      await redis.set('bls:national:cpi:energy', { energyCurrent, energyBaseline, energyChange }, { ex: TTL_7_DAYS })
      stats.stored++

      if (energyBaseline > 0) {
        await redis.set('baseline:jan2025:cpi:energy:national', { value: energyBaseline, date: blKey }, { ex: TTL_1_YEAR })
        stats.stored++
      }

      console.log(`  ✓ national energy CPI: ${energyCurrent} (baseline ${energyBaseline}, ${energyChange > 0 ? '+' : ''}${energyChange}%)`)
      stats.blsNational.stored++
    } else {
      console.error('  ✗ national energy CPI: no data')
      stats.blsNational.failed++
      stats.failed++
    }

  } catch (err) {
    console.error('  ✗ BLS national fetch failed entirely:', err instanceof Error ? err.message : err)
    stats.blsNational.failed += 4
    stats.failed += 4
  }

  console.log(`  BLS national: ${stats.blsNational.stored} stored, ${stats.blsNational.failed} failed`)
}

// ---------------------------------------------------------------------------
// Section 2b: BLS Regional + National CPI (keys the app actually reads)
// ---------------------------------------------------------------------------

interface CpiPoint {
  date:      string
  groceries: number
  shelter:   number | null
  energy:    number | null
}

interface CpiData {
  groceriesCurrent:  number
  groceriesBaseline: number
  groceriesChange:   number
  shelterChange:     number
  series:            CpiPoint[]
  metro:             string
  tier:              1 | 2 | 3 | 4
  seriesIds:         { groceries: string; shelter: string; energy: string }
  nationalSeries?:   CpiPoint[]
}

const CPI_AREAS: Array<{ areaCode: string; areaName: string; tier: 1 | 2 | 3 | 4 }> = [
  { areaCode: '0000', areaName: 'National',              tier: 4 },
  // Census Divisions (Tier 2)
  { areaCode: '0110', areaName: 'New England',           tier: 2 },
  { areaCode: '0120', areaName: 'Middle Atlantic',       tier: 2 },
  { areaCode: '0230', areaName: 'East North Central',    tier: 2 },
  { areaCode: '0240', areaName: 'West North Central',    tier: 2 },
  { areaCode: '0350', areaName: 'South Atlantic',        tier: 2 },
  { areaCode: '0360', areaName: 'East South Central',    tier: 2 },
  { areaCode: '0370', areaName: 'West South Central',    tier: 2 },
  { areaCode: '0480', areaName: 'Mountain',              tier: 2 },
  { areaCode: '0490', areaName: 'Pacific',               tier: 2 },
  // Census Regions (Tier 3 fallback)
  { areaCode: '0100', areaName: 'Northeast Urban',       tier: 3 },
  { areaCode: '0200', areaName: 'Midwest Urban',         tier: 3 },
  { areaCode: '0300', areaName: 'South Urban',           tier: 3 },
  { areaCode: '0400', areaName: 'West Urban',            tier: 3 },
]

async function preloadBlsCpiRegional() {
  console.log('\n=== Section 2b: BLS Division + Regional + National CPI ===')

  if (!process.env.BLS_API_KEY) {
    console.warn('  WARNING: BLS_API_KEY not set — rate limit is 25 req/day')
  }

  const currentYear = new Date().getFullYear().toString()

  // Build series IDs for all 5 areas (national + 4 regional) × 3 metrics = 15 total.
  // National series (0000) appear in both the area rows and as the nationalSeries
  // for regional areas — they're deduplicated by BLS via Set before sending.
  const allSeriesIds: string[] = []
  for (const area of CPI_AREAS) {
    allSeriesIds.push(
      `CUUR${area.areaCode}SAF11`,  // groceries
      `CUUR${area.areaCode}SAH1`,   // shelter
      `CUUR${area.areaCode}SA0E`,   // energy
    )
  }
  // Deduplicate (national series appears in both lists)
  const uniqueSeriesIds = [...new Set(allSeriesIds)]

  let json: any
  try {
    json = await postBls(uniqueSeriesIds, '2016', currentYear)
  } catch (err) {
    console.error('  ✗ BLS CPI fetch failed entirely:', err instanceof Error ? err.message : err)
    stats.blsCpiRegion.failed += CPI_AREAS.length
    stats.failed              += CPI_AREAS.length
    console.log(`  BLS CPI: ${stats.blsCpiRegion.stored} stored, ${stats.blsCpiRegion.failed} failed`)
    return
  }

  const seriesMap: Record<string, BlsPoint[]> = {}
  for (const s of json.Results?.series ?? []) {
    seriesMap[s.seriesID] = s.data ?? []
  }

  function buildPeriodMap(data: BlsPoint[]): Map<string, number> {
    const map = new Map<string, number>()
    for (const d of data) {
      const val = parseFloat(d.value)
      if (isNaN(val) || d.value === '-') continue
      map.set(`${d.year}-${d.period}`, val)
    }
    return map
  }

  function buildCpiPoints(
    groceriesMap: Map<string, number>,
    shelterMap:   Map<string, number>,
    energyMap:    Map<string, number>,
  ): CpiPoint[] {
    const periods = [...groceriesMap.keys()].sort()
    return periods
      .map((key) => {
        const [year, period] = key.split('-')
        const month = period.replace('M', '').padStart(2, '0')
        const g = groceriesMap.get(key)
        if (g === undefined || g === null || isNaN(g)) return null
        return {
          date:     `${year}-${month}`,
          groceries: g,
          shelter:   shelterMap.get(key) ?? null,
          energy:    energyMap.get(key)  ?? null,
        }
      })
      .filter((p): p is CpiPoint => p !== null)
  }

  // Pre-build national series data (used as nationalSeries in regional entries)
  const natGroceriesMap = buildPeriodMap(seriesMap['CUUR0000SAF11'] ?? [])
  const natShelterMap   = buildPeriodMap(seriesMap['CUUR0000SAH1']  ?? [])
  const natEnergyMap    = buildPeriodMap(seriesMap['CUUR0000SA0E']   ?? [])
  const nationalSeries  = buildCpiPoints(natGroceriesMap, natShelterMap, natEnergyMap)

  const baselineKey = `${BLS_BASELINE_YEAR}-${BLS_BASELINE_PERIOD}`

  for (const area of CPI_AREAS) {
    const groceriesSeriesId = `CUUR${area.areaCode}SAF11`
    const shelterSeriesId   = `CUUR${area.areaCode}SAH1`
    const energySeriesId    = `CUUR${area.areaCode}SA0E`

    try {
      const groceriesMap = buildPeriodMap(seriesMap[groceriesSeriesId] ?? [])
      const shelterMap   = buildPeriodMap(seriesMap[shelterSeriesId]   ?? [])
      const energyMap    = buildPeriodMap(seriesMap[energySeriesId]    ?? [])

      if (!groceriesMap.size) {
        throw new Error(`No groceries data returned for area ${area.areaCode}`)
      }

      const allPeriods      = [...groceriesMap.keys()].sort()
      const latestKey       = allPeriods[allPeriods.length - 1]

      const groceriesCurrent  = groceriesMap.get(latestKey) ?? 0
      const groceriesBaseline = groceriesMap.get(baselineKey) ?? 0
      const groceriesChange   = groceriesBaseline > 0
        ? parseFloat(((groceriesCurrent - groceriesBaseline) / groceriesBaseline * 100).toFixed(1))
        : 0

      const shelterBaseline = shelterMap.get(baselineKey) ?? 0
      const shelterCurrent  = shelterMap.get(latestKey)  ?? 0
      const shelterChange   = shelterBaseline > 0
        ? parseFloat(((shelterCurrent - shelterBaseline) / shelterBaseline * 100).toFixed(1))
        : 0

      const series = buildCpiPoints(groceriesMap, shelterMap, energyMap)

      // National series is included only when this area is not itself national
      const isNational = area.areaCode === '0000'

      const cpiData: CpiData = {
        groceriesCurrent,
        groceriesBaseline,
        groceriesChange,
        shelterChange,
        series,
        metro:     area.areaName,
        tier:      area.tier,
        seriesIds: {
          groceries: groceriesSeriesId,
          shelter:   shelterSeriesId,
          energy:    energySeriesId,
        },
        ...(!isNational && nationalSeries.length ? { nationalSeries } : {}),
      }

      const cacheKey = `bls:cpi:${area.areaCode}:all`
      await store(cacheKey, cpiData, TTL_7_DAYS)

      stats.blsCpiRegion.stored++
      console.log(
        `  ✓ ${cacheKey} (${area.areaName}): groceries ${groceriesChange > 0 ? '+' : ''}${groceriesChange}%, shelter ${shelterChange > 0 ? '+' : ''}${shelterChange}%`
      )
    } catch (err) {
      stats.blsCpiRegion.failed++
      stats.failed++
      console.error(`  ✗ bls:cpi:${area.areaCode}:all (${area.areaName}):`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`  BLS CPI: ${stats.blsCpiRegion.stored} stored, ${stats.blsCpiRegion.failed} failed`)
}

// ---------------------------------------------------------------------------
// Section 3: Top 50 Counties
// ---------------------------------------------------------------------------

const TOP_COUNTIES = [
  { fips: '06037', name: 'Los Angeles CA'            },
  { fips: '17031', name: 'Cook (Chicago) IL'         },
  { fips: '48201', name: 'Harris (Houston) TX'       },
  { fips: '04013', name: 'Maricopa (Phoenix) AZ'     },
  { fips: '06073', name: 'San Diego CA'              },
  { fips: '06059', name: 'Orange CA'                 },
  { fips: '48113', name: 'Dallas TX'                 },
  { fips: '06065', name: 'Riverside CA'              },
  { fips: '06071', name: 'San Bernardino CA'         },
  { fips: '53033', name: 'King (Seattle) WA'         },
  { fips: '41051', name: 'Multnomah (Portland) OR'   },
  { fips: '53011', name: 'Clark (Vancouver) WA'      },
  { fips: '36047', name: 'Kings (Brooklyn) NY'       },
  { fips: '36081', name: 'Queens NY'                 },
  { fips: '36061', name: 'New York (Manhattan) NY'   },
  { fips: '36005', name: 'Bronx NY'                  },
  { fips: '36085', name: 'Staten Island NY'          },
  { fips: '25017', name: 'Middlesex (Boston) MA'     },
  { fips: '11001', name: 'District of Columbia'      },
  { fips: '26163', name: 'Wayne (Detroit) MI'        },
  { fips: '48029', name: 'Bexar (San Antonio) TX'    },
  { fips: '06001', name: 'Alameda CA'                },
  { fips: '32003', name: 'Clark (Las Vegas) NV'      },
  { fips: '27053', name: 'Hennepin (Minneapolis) MN' },
  { fips: '12086', name: 'Miami-Dade FL'             },
  { fips: '12011', name: 'Broward FL'                },
  { fips: '48439', name: 'Tarrant (Fort Worth) TX'   },
  { fips: '06075', name: 'San Francisco CA'          },
  { fips: '42101', name: 'Philadelphia PA'           },
  { fips: '12031', name: 'Duval (Jacksonville) FL'   },
  { fips: '08031', name: 'Denver CO'                 },
  { fips: '53053', name: 'Pierce (Tacoma) WA'        },
  { fips: '39049', name: 'Franklin (Columbus) OH'    },
  { fips: '39035', name: 'Cuyahoga (Cleveland) OH'   },
  { fips: '37119', name: 'Mecklenburg (Charlotte) NC'},
  { fips: '13121', name: 'Fulton (Atlanta) GA'       },
  { fips: '29189', name: 'St. Louis MO'              },
  { fips: '42003', name: 'Allegheny (Pittsburgh) PA' },
  { fips: '24510', name: 'Baltimore City MD'         },
  { fips: '06085', name: 'Santa Clara CA'            },
  { fips: '48453', name: 'Travis (Austin) TX'        },
  { fips: '41005', name: 'Clackamas OR'              },
  { fips: '12095', name: 'Orange (Orlando) FL'       },
  { fips: '55079', name: 'Milwaukee WI'              },
  { fips: '47037', name: 'Davidson (Nashville) TN'   },
  { fips: '22071', name: 'Orleans (New Orleans) LA'  },
  { fips: '15003', name: 'Honolulu HI'               },
  { fips: '49035', name: 'Salt Lake UT'              },
  { fips: '24031', name: 'Montgomery MD'             },
  { fips: '51059', name: 'Fairfax VA'                },
]

function buildBlsSeriesId(countyFips: string): string {
  return `LAUCN${countyFips.padStart(5, '0')}0000000003`
}

async function preloadBlsCounties() {
  console.log('\n=== Section 3: Top 50 Counties (BLS Unemployment) ===')

  if (!process.env.BLS_API_KEY) {
    console.warn('  WARNING: BLS_API_KEY not set — rate limit is 25 req/day (may not complete all counties)')
  }

  const currentYear = new Date().getFullYear().toString()
  const BATCH_SIZE  = 25

  // Track national series from the first batch for embedding in county objects
  let cachedNationalSeries: Array<{ date: string; rate: number }> | undefined

  for (let i = 0; i < TOP_COUNTIES.length; i += BATCH_SIZE) {
    const batch    = TOP_COUNTIES.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const total    = Math.ceil(TOP_COUNTIES.length / BATCH_SIZE)
    console.log(`\n  Batch ${batchNum}/${total}: counties ${i + 1}–${Math.min(i + BATCH_SIZE, TOP_COUNTIES.length)}`)

    const countySeriesIds = batch.map((c) => buildBlsSeriesId(c.fips))
    const allSeriesIds    = [...countySeriesIds, NATIONAL_UNEMPLOYMENT_SERIES]

    let json: any
    try {
      json = await postBls(allSeriesIds, '2020', currentYear)
    } catch (err) {
      console.error(`  ✗ Batch ${batchNum} fetch failed:`, err instanceof Error ? err.message : err)
      stats.blsCounty.failed += batch.length
      stats.failed            += batch.length
      if (i + BATCH_SIZE < TOP_COUNTIES.length) await sleep(1000)
      continue
    }

    const seriesMap: Record<string, BlsPoint[]> = {}
    for (const s of json.Results?.series ?? []) {
      seriesMap[s.seriesID] = s.data ?? []
    }

    // Extract national series once
    if (!cachedNationalSeries) {
      const rawNational = filterValidBls(seriesMap[NATIONAL_UNEMPLOYMENT_SERIES] ?? [])
      if (rawNational.length) {
        const sortedNational = sortBlsData(rawNational)
        cachedNationalSeries = sortedNational.map((d) => ({
          date: `${d.year}-${d.period.replace('M', '')}`,
          rate: parseFloat(d.value),
        }))
      }
    }

    // Process each county in this batch
    for (const county of batch) {
      const seriesId = buildBlsSeriesId(county.fips)
      const rawData  = filterValidBls(seriesMap[seriesId] ?? [])

      if (!rawData.length) {
        console.error(`  ✗ ${county.name} (${county.fips}): no data`)
        stats.blsCounty.failed++
        stats.failed++
        continue
      }

      try {
        const sorted  = sortBlsData(rawData)
        const latest  = sorted[sorted.length - 1]
        const current = parseFloat(latest.value)

        const baselineEntry = rawData.find(
          (d) => d.year === BLS_BASELINE_YEAR && d.period === BLS_BASELINE_PERIOD
        )
        const baseline = baselineEntry ? parseFloat(baselineEntry.value) : 0

        const series = sorted.map((d) => ({
          date: `${d.year}-${d.period.replace('M', '')}`,
          rate: parseFloat(d.value),
        }))

        const unemploymentData: {
          current:         number
          baseline:        number
          change:          number
          series:          Array<{ date: string; rate: number }>
          countyFips:      string
          seriesId:        string
          nationalSeries?: Array<{ date: string; rate: number }>
        } = {
          current,
          baseline,
          change:     parseFloat((current - baseline).toFixed(1)),
          series,
          countyFips: county.fips,
          seriesId,
          ...(cachedNationalSeries ? { nationalSeries: cachedNationalSeries } : {}),
        }

        const cacheKey = `bls:unemployment:${county.fips}`
        await store(cacheKey, unemploymentData, TTL_7_DAYS)

        // Baseline key
        if (baselineEntry) {
          await redis.set(
            `baseline:jan2025:unemployment:${county.fips}`,
            { rate: baseline, date: `${baselineEntry.year}-${baselineEntry.period}` },
            { ex: TTL_1_YEAR }
          )
          stats.stored++
        }

        stats.blsCounty.stored++
        const changeStr = unemploymentData.change >= 0
          ? `+${unemploymentData.change}`
          : `${unemploymentData.change}`
        console.log(`  ✓ ${county.name} (${county.fips}): ${current}% (${changeStr} since Jan 2025)`)
      } catch (err) {
        console.error(`  ✗ ${county.name} (${county.fips}):`, err instanceof Error ? err.message : err)
        stats.blsCounty.failed++
        stats.failed++
      }
    }

    // 1-second delay between batches to respect BLS rate limits
    if (i + BATCH_SIZE < TOP_COUNTIES.length) {
      console.log('  (waiting 1s between batches...)')
      await sleep(1000)
    }
  }

  console.log(`  BLS counties: ${stats.blsCounty.stored} stored, ${stats.blsCounty.failed} failed`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=================================================')
  console.log('  preload-cache.ts — Upstash Redis preloader')
  console.log(`  Started: ${new Date().toISOString()}`)
  console.log('=================================================')

  await preloadGasPrices()
  await preloadBlsNational()
  await preloadBlsCpiRegional()
  await preloadBlsCounties()

  const elapsed   = ((Date.now() - startTime) / 1000).toFixed(1)
  const totalKeys = stats.stored

  console.log('\n=================================================')
  console.log('  Summary')
  console.log('=================================================')
  console.log(`  Total keys stored : ${totalKeys}`)
  console.log(`  Total failures    : ${stats.failed}`)
  console.log(`  Gas prices        : ${stats.gas.stored} stored, ${stats.gas.failed} failed`)
  console.log(`  BLS national      : ${stats.blsNational.stored} stored, ${stats.blsNational.failed} failed`)
  console.log(`  BLS regional CPI  : ${stats.blsCpiRegion.stored} stored, ${stats.blsCpiRegion.failed} failed`)
  console.log(`  BLS counties      : ${stats.blsCounty.stored} stored, ${stats.blsCounty.failed} failed`)
  console.log(`  Elapsed           : ${elapsed}s`)
  console.log('=================================================')

  if (stats.failed > 0) {
    console.error(`\nCompleted with ${stats.failed} failure(s). See errors above.`)
    process.exit(1)
  } else {
    console.log('\nAll sections completed successfully.')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
