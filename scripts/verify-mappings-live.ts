/**
 * verify-mappings-live.ts
 *
 * Verifies all geographic mapping codes against the live EIA and BLS APIs.
 * Confirms that every duoarea code, CPI series, and LAUS series used in the
 * mapping tables actually returns data from the upstream APIs.
 *
 * Run with: npx tsx scripts/verify-mappings-live.ts
 *
 * Environment variables:
 *   EIA_API_KEY  — EIA API key (falls back to DEMO_KEY)
 *   BLS_API_KEY  — BLS registration key (optional, increases rate limit)
 */

import * as fs from 'fs'
import * as path from 'path'

import {
  CPI_TO_EIA_CITY,
  COUNTY_EIA_CITY_OVERRIDES,
  STATE_LEVEL_CODES,
  STATE_TO_PAD,
  PAD_NAMES,
  PAD_DUOAREA,
} from '../src/lib/mappings/eia-gas'

import {
  BLS_CPI_AREAS,
} from '../src/lib/mappings/county-metro-cpi'


// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const EIA_API_KEY = process.env.EIA_API_KEY ?? 'DEMO_KEY'
const BLS_API_KEY = process.env.BLS_API_KEY
const DELAY_MS = 200
const REQUEST_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timeout)
  }
}

const HR = '═'.repeat(64)
const SEP = '──'

let totalPass = 0
let totalFail = 0

interface VerifyResult {
  code: string
  label: string
  pass: boolean
  detail: string
}

function printResult(r: VerifyResult, indent = '  ') {
  const status = r.pass ? 'PASS' : 'FAIL'
  if (r.pass) totalPass++
  else totalFail++
  console.log(`${indent}${r.code.padEnd(8)} ${r.label.padEnd(32)} ${status}  ${r.detail}`)
}

function printSeriesResult(seriesId: string, label: string, pass: boolean, detail: string, indent = '    ') {
  const status = pass ? 'PASS' : 'FAIL'
  if (pass) totalPass++
  else totalFail++
  console.log(`${indent}${label.padEnd(10)} ${seriesId.padEnd(20)} ${status}  ${detail}`)
}

// ---------------------------------------------------------------------------
// Load zip-county crosswalk for picking representative counties
// ---------------------------------------------------------------------------

interface ZipEntry {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
}

const ZIP_COUNTY_PATH = path.resolve(__dirname, '../src/lib/data/zip-county.json')
const zipCountyData: Record<string, ZipEntry> = JSON.parse(
  fs.readFileSync(ZIP_COUNTY_PATH, 'utf-8')
)

// Build county info map (fips → first entry)
const countyInfo = new Map<string, ZipEntry>()
for (const entry of Object.values(zipCountyData)) {
  if (!countyInfo.has(entry.countyFips)) {
    countyInfo.set(entry.countyFips, entry)
  }
}

// Pick up to 5 representative counties per state from the crosswalk
function pickCountiesPerState(perState: number): Map<string, string[]> {
  const byState = new Map<string, string[]>()
  for (const [fips, entry] of countyInfo) {
    const st = entry.stateAbbr.toUpperCase()
    if (!byState.has(st)) byState.set(st, [])
    const arr = byState.get(st)!
    if (arr.length < perState) arr.push(fips)
  }
  return byState
}

// ---------------------------------------------------------------------------
// 1. Verify EIA gas duoarea codes
// ---------------------------------------------------------------------------

async function verifyEiaCodes(): Promise<void> {
  console.log(`\n${SEP} EIA Gas Duoarea Codes ${SEP}`)

  // Collect all unique duoarea codes with labels
  const codes = new Map<string, string>()

  // City-level from CPI mapping
  for (const [cpi, data] of Object.entries(CPI_TO_EIA_CITY)) {
    codes.set(data.duoarea, data.label)
  }

  // City-level from county overrides (may add new codes like YCLE)
  for (const [, data] of Object.entries(COUNTY_EIA_CITY_OVERRIDES)) {
    if (!codes.has(data.duoarea)) {
      codes.set(data.duoarea, data.label)
    }
  }

  // State-level codes
  for (const [state, data] of Object.entries(STATE_LEVEL_CODES)) {
    if (!codes.has(data.duoarea)) {
      codes.set(data.duoarea, `${data.label}`)
    }
  }

  // PAD district codes
  for (const [pad, duoarea] of Object.entries(PAD_DUOAREA)) {
    const padName = PAD_NAMES[pad] ?? `PAD ${pad}`
    if (!codes.has(duoarea)) {
      codes.set(duoarea, `PAD ${pad} ${padName}`)
    }
  }

  // Also add national
  codes.set('NUS', 'US National avg')

  for (const [duoarea, label] of codes) {
    await sleep(DELAY_MS)
    try {
      const url = `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${EIA_API_KEY}&facets[product][]=EPM0&facets[duoarea][]=${duoarea}&frequency=weekly&length=1`
      const res = await fetchWithTimeout(url)
      if (!res.ok) {
        printResult({ code: duoarea, label, pass: false, detail: `(HTTP ${res.status})` })
        continue
      }
      const json = await res.json() as any
      const data = json?.response?.data
      if (data && data.length > 0) {
        const price = data[0].value
        const period = data[0].period
        printResult({
          code: duoarea,
          label,
          pass: true,
          detail: `(price: $${Number(price).toFixed(2)}, period: ${period})`,
        })
      } else {
        printResult({ code: duoarea, label, pass: false, detail: '(no data returned)' })
      }
    } catch (err: any) {
      const reason = err.name === 'AbortError' ? 'timeout' : err.message
      printResult({ code: duoarea, label, pass: false, detail: `(${reason})` })
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Verify BLS CPI series
// ---------------------------------------------------------------------------

async function verifyBlsCpiSeries(): Promise<void> {
  console.log(`\n${SEP} BLS CPI Series ${SEP}`)

  // Collect all unique CPI area codes
  const areaCodes = new Set<string>()
  for (const code of Object.keys(BLS_CPI_AREAS)) {
    areaCodes.add(code)
  }
  // National
  areaCodes.add('0000')

  // Build series IDs for each area: groceries, shelter, energy
  interface CpiCheck {
    areaCode: string
    areaName: string
    category: string
    seriesId: string
  }

  const checks: CpiCheck[] = []
  for (const code of areaCodes) {
    const name = code === '0000' ? 'National' : BLS_CPI_AREAS[code]?.name ?? code
    checks.push({ areaCode: code, areaName: name, category: 'Groceries', seriesId: `CUUR${code}SAF11` })
    checks.push({ areaCode: code, areaName: name, category: 'Shelter', seriesId: `CUUR${code}SAH1` })
    checks.push({ areaCode: code, areaName: name, category: 'Energy', seriesId: `CUUR${code}SA0E` })
  }

  // Batch into groups of 25 (BLS limit)
  const batches: CpiCheck[][] = []
  for (let i = 0; i < checks.length; i += 25) {
    batches.push(checks.slice(i, i + 25))
  }

  // Track results by seriesId
  const seriesResults = new Map<string, { pass: boolean; detail: string }>()

  for (const batch of batches) {
    await sleep(DELAY_MS)
    try {
      const body: any = {
        seriesid: batch.map(c => c.seriesId),
        startyear: '2024',
        endyear: '2025',
      }
      if (BLS_API_KEY) {
        body.registrationkey = BLS_API_KEY
      }

      const res = await fetchWithTimeout('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        for (const c of batch) {
          seriesResults.set(c.seriesId, { pass: false, detail: `(HTTP ${res.status})` })
        }
        continue
      }

      const json = await res.json() as any
      const series = json?.Results?.series ?? []

      // Index returned series by ID
      const returned = new Map<string, any>()
      for (const s of series) {
        returned.set(s.seriesID, s)
      }

      for (const c of batch) {
        const s = returned.get(c.seriesId)
        if (s && s.data && s.data.length > 0) {
          const latest = s.data[0]
          seriesResults.set(c.seriesId, {
            pass: true,
            detail: `(latest: ${latest.period} ${latest.year}, value: ${latest.value})`,
          })
        } else {
          seriesResults.set(c.seriesId, { pass: false, detail: '(series not found or no data)' })
        }
      }
    } catch (err: any) {
      const reason = err.name === 'AbortError' ? 'timeout' : err.message
      for (const c of batch) {
        seriesResults.set(c.seriesId, { pass: false, detail: `(${reason})` })
      }
    }
  }

  // Print grouped by area
  let currentArea = ''
  for (const c of checks) {
    if (c.areaCode !== currentArea) {
      currentArea = c.areaCode
      console.log(`  ${c.areaCode} (${c.areaName})`)
    }
    const result = seriesResults.get(c.seriesId)!
    printSeriesResult(c.seriesId, c.category, result.pass, result.detail)
  }
}

// ---------------------------------------------------------------------------
// 3. Verify BLS LAUS unemployment series
// ---------------------------------------------------------------------------

async function verifyBlsLaus(): Promise<void> {
  console.log(`\n${SEP} BLS LAUS Unemployment ${SEP}`)

  const countiesPerState = pickCountiesPerState(5)

  // Flatten to a list of FIPS codes
  const allFips: string[] = []
  for (const fipsList of countiesPerState.values()) {
    allFips.push(...fipsList)
  }

  // Build series IDs
  interface LausCheck {
    fips: string
    countyName: string
    state: string
    seriesId: string
  }

  const checks: LausCheck[] = allFips.map(fips => {
    const entry = countyInfo.get(fips)
    return {
      fips,
      countyName: entry?.countyName ?? fips,
      state: entry?.stateAbbr ?? '??',
      seriesId: `LAUCN${fips}0000000003`,
    }
  })

  // Batch into groups of 25
  const batches: LausCheck[][] = []
  for (let i = 0; i < checks.length; i += 25) {
    batches.push(checks.slice(i, i + 25))
  }

  const seriesResults = new Map<string, { pass: boolean; detail: string }>()

  for (const batch of batches) {
    await sleep(DELAY_MS)
    try {
      const body: any = {
        seriesid: batch.map(c => c.seriesId),
        startyear: '2024',
        endyear: '2025',
      }
      if (BLS_API_KEY) {
        body.registrationkey = BLS_API_KEY
      }

      const res = await fetchWithTimeout('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        for (const c of batch) {
          seriesResults.set(c.seriesId, { pass: false, detail: `(HTTP ${res.status})` })
        }
        continue
      }

      const json = await res.json() as any
      const series = json?.Results?.series ?? []

      const returned = new Map<string, any>()
      for (const s of series) {
        returned.set(s.seriesID, s)
      }

      for (const c of batch) {
        const s = returned.get(c.seriesId)
        if (s && s.data && s.data.length > 0) {
          seriesResults.set(c.seriesId, { pass: true, detail: `(series ${c.seriesId})` })
        } else {
          seriesResults.set(c.seriesId, { pass: false, detail: '(series does not exist or no data)' })
        }
      }
    } catch (err: any) {
      const reason = err.name === 'AbortError' ? 'timeout' : err.message
      for (const c of batch) {
        seriesResults.set(c.seriesId, { pass: false, detail: `(${reason})` })
      }
    }
  }

  for (const c of checks) {
    const result = seriesResults.get(c.seriesId)!
    const status = result.pass ? 'PASS' : 'FAIL'
    if (result.pass) totalPass++
    else totalFail++
    console.log(`  ${c.fips}  ${(c.countyName + ', ' + c.state).padEnd(36)} ${status}  ${result.detail}`)
  }
}

// ---------------------------------------------------------------------------
// 4. Verify PAD district state assignments
// ---------------------------------------------------------------------------

async function verifyPadAssignments(): Promise<void> {
  console.log(`\n${SEP} PAD District State Assignments ${SEP}`)

  // Official EIA PADD state assignments
  // Source: https://www.eia.gov/petroleum/weekly/includes/padds.php
  // Hardcoded here as the canonical reference since parsing HTML is fragile.
  const OFFICIAL_PAD: Record<string, string> = {
    // PAD 1A — New England
    ME: '1A', NH: '1A', VT: '1A', MA: '1A', RI: '1A', CT: '1A',
    // PAD 1B — Central Atlantic
    NY: '1B', NJ: '1B', PA: '1B', DE: '1B', MD: '1B', DC: '1B',
    // PAD 1C — Lower Atlantic
    VA: '1C', WV: '1C', NC: '1C', SC: '1C', GA: '1C', FL: '1C',
    // PAD 2 — Midwest
    OH: '2', MI: '2', IN: '2', IL: '2', WI: '2', MN: '2', IA: '2',
    MO: '2', ND: '2', SD: '2', NE: '2', KS: '2', KY: '2', TN: '2', OK: '2',
    // PAD 3 — Gulf Coast
    TX: '3', LA: '3', MS: '3', AL: '3', AR: '3', NM: '3',
    // PAD 4 — Rocky Mountain
    MT: '4', ID: '4', WY: '4', CO: '4', UT: '4',
    // PAD 5 — West Coast
    WA: '5', OR: '5', CA: '5', NV: '5', AZ: '5', AK: '5', HI: '5',
  }

  // Also try to fetch the official page for a live check
  let liveCheckNote = ''
  try {
    await sleep(DELAY_MS)
    const res = await fetchWithTimeout('https://www.eia.gov/petroleum/weekly/includes/padds.php')
    if (res.ok) {
      const html = await res.text()
      // Look for state abbreviations in the HTML to do a rough sanity check
      // The page contains state names in the PADD definitions
      const statesFound = Object.keys(OFFICIAL_PAD).filter(st => {
        // Check if the state abbreviation or full name appears
        return html.includes(st) || html.toLowerCase().includes(st.toLowerCase())
      })
      liveCheckNote = `(EIA PADD page fetched OK, ${statesFound.length} state refs found in HTML)`
    } else {
      liveCheckNote = `(EIA PADD page returned HTTP ${res.status} — using hardcoded reference)`
    }
  } catch (err: any) {
    liveCheckNote = `(Could not fetch EIA PADD page: ${err.message} — using hardcoded reference)`
  }

  console.log(`  ${liveCheckNote}`)
  console.log()

  for (const [state, ourPad] of Object.entries(STATE_TO_PAD)) {
    const officialPad = OFFICIAL_PAD[state]
    const ourPadStr = String(ourPad)
    const officialPadStr = officialPad ? String(officialPad) : undefined

    const padName = PAD_NAMES[ourPad] ?? `PAD ${ourPad}`

    if (!officialPadStr) {
      totalFail++
      console.log(`  ${state} → PAD ${ourPadStr} (${padName})`.padEnd(42) + `FAIL  (state not in official PADD list)`)
    } else if (ourPadStr === officialPadStr) {
      totalPass++
      console.log(`  ${state} → PAD ${ourPadStr} (${padName})`.padEnd(42) + `PASS  (matches EIA official)`)
    } else {
      totalFail++
      console.log(`  ${state} → PAD ${ourPadStr} (${padName})`.padEnd(42) + `FAIL  (our: PAD ${ourPadStr}, official: PAD ${officialPadStr})`)
    }
  }

  // Check for states in official list but missing from our mapping
  for (const state of Object.keys(OFFICIAL_PAD)) {
    if (!(state in STATE_TO_PAD)) {
      totalFail++
      console.log(`  ${state} → (missing)`.padEnd(42) + `FAIL  (in EIA official PAD ${OFFICIAL_PAD[state]} but missing from STATE_TO_PAD)`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(HR)
  console.log('  LIVE API VERIFICATION REPORT')
  console.log(HR)
  console.log()
  console.log('  NOTE: This script makes live API calls to EIA and BLS.')
  console.log('  - EIA rate limit: 1000 req/hr with key, lower with DEMO_KEY')
  console.log('  - BLS rate limit: 500 req/day with key, 25 req/day without')
  console.log(`  - Using EIA key: ${EIA_API_KEY === 'DEMO_KEY' ? 'DEMO_KEY (limited)' : '***' + EIA_API_KEY.slice(-4)}`)
  console.log(`  - Using BLS key: ${BLS_API_KEY ? '***' + BLS_API_KEY.slice(-4) : '(none — unregistered, 25 req/day limit)'}`)
  console.log(`  - Request timeout: ${REQUEST_TIMEOUT_MS / 1000}s`)
  console.log(`  - Delay between calls: ${DELAY_MS}ms`)
  console.log()

  await verifyEiaCodes()
  await verifyBlsCpiSeries()
  await verifyBlsLaus()
  await verifyPadAssignments()

  console.log()
  console.log(HR)
  console.log(`  SUMMARY: ${totalPass} PASS, ${totalFail} FAIL`)
  console.log(HR)

  if (totalFail > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(2)
})
