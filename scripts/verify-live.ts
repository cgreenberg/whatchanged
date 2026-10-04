/**
 * verify-live.ts — lean live check of the deployed site against government source APIs.
 *
 * For a fixed set of zips, fetches `${BASE_URL}/api/data/{zip}?audit=true`, then pulls the
 * same series straight from BLS (one batched POST) and EIA, and asserts that:
 *   - the baseline (Jan 2025 / last weekly reading on or before Jan 20 2025) matches
 *   - the latest value shown matches the source value for the same period
 *   - the % change / delta math is internally consistent
 *   - the data is fresh (BLS <= 75 days, EIA <= 14 days)
 * Checks whose fields are missing from the API response are reported as SKIP.
 *
 * Usage:
 *   BLS_API_KEY=... EIA_API_KEY=... npx tsx scripts/verify-live.ts [--codes] [zip ...]
 *   BASE_URL=http://localhost:3000 npm run verify:live
 *
 *   --codes   also confirm every EIA duoarea and BLS CPI area code in the mapping tables
 *             returns data, and that STATE_TO_PAD matches the official EIA PADD list.
 *             (~100 requests, uses BLS quota; not part of the weekly run.)
 *
 * Exit code: 1 if any check FAILs, 2 on fatal error. SKIP / WARN do not fail the run.
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const DEFAULT_ZIPS = ['98683', '10001', '60601', '78701', '90210', '04101', '06103', '83702', '96813', '99501']
const BASE_URL = (process.env.BASE_URL ?? 'https://www.whatchanged.us').replace(/\/$/, '')
const BLS_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
const EIA_URL = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'
const MAX_AGE_DAYS = { bls: 75, eia: 14 }
const BASELINE_YEAR = '2025'
const GAS_BASELINE_DATE = '2025-01-20'
const TIMEOUT_MS = 20_000

// Optional local convenience: load .env.local from cwd without overriding real env vars.
const envPath = resolve(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const BLS_KEY = process.env.BLS_API_KEY
const EIA_KEY = process.env.EIA_API_KEY

type Status = 'PASS' | 'FAIL' | 'SKIP' | 'WARN'
interface Row { zip: string; check: string; status: Status; detail: string }
const rows: Row[] = []
const add = (zip: string, check: string, status: Status, detail = '') => rows.push({ zip, check, status, detail })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
const get = (obj: Json, path: string): Json =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
const round1 = (n: number) => Math.round(n * 10) / 10

async function fetchJson(url: string, init?: RequestInit): Promise<Json> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

const daysSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000)
// A BLS monthly value (YYYY-MM) is considered "as of" the end of that month.
const endOfMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0))
}

// ---------------------------------------------------------------------------
// BLS: batched fetch -> Map<seriesId, Map<"YYYY-MM", value>>
// ---------------------------------------------------------------------------
async function fetchBls(seriesIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  const chunk = BLS_KEY ? 50 : 25
  const year = String(new Date().getUTCFullYear())
  for (let i = 0; i < seriesIds.length; i += chunk) {
    const body: Json = { seriesid: seriesIds.slice(i, i + chunk), startyear: BASELINE_YEAR, endyear: year }
    if (BLS_KEY) body.registrationkey = BLS_KEY
    const json = await fetchJson(BLS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (json.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS: ${(json.message ?? []).join('; ') || json.status}`)
    for (const s of json.Results?.series ?? []) {
      const m = new Map<string, number>()
      for (const d of s.data ?? []) {
        const v = parseFloat(d.value)
        if (/^M(0[1-9]|1[0-2])$/.test(d.period) && Number.isFinite(v)) m.set(`${d.year}-${d.period.slice(1)}`, v)
      }
      out.set(s.seriesID, m)
    }
  }
  return out
}

const latestKey = (m: Map<string, number>) => [...m.keys()].sort().pop()

// ---------------------------------------------------------------------------
// EIA: weekly retail gasoline for a duoarea, newest first
// ---------------------------------------------------------------------------
async function fetchEia(duoarea: string): Promise<Array<{ period: string; value: number }>> {
  const q = new URLSearchParams({
    api_key: EIA_KEY ?? 'DEMO_KEY',
    frequency: 'weekly',
    start: '2025-01-01',
    length: '500',
  })
  q.append('facets[product][]', 'EPMR') // Regular gasoline — must match the site's product
  q.append('facets[duoarea][]', duoarea)
  q.append('sort[0][column]', 'period')
  q.append('sort[0][direction]', 'desc')
  q.append('data[0]', 'value')
  const json = await fetchJson(`${EIA_URL}?${q}`)
  return (json?.response?.data ?? [])
    .map((d: Json) => ({ period: String(d.period), value: parseFloat(d.value) }))
    .filter((d: { value: number }) => Number.isFinite(d.value))
}

// ---------------------------------------------------------------------------
// Per-zip checks
// ---------------------------------------------------------------------------
interface SiteSeriesPoint { date: string; [k: string]: unknown }
const pointAt = (series: SiteSeriesPoint[] | undefined, date: string) =>
  Array.isArray(series) ? series.find((p) => String(p.date).slice(0, date.length) === date) : undefined
const lastPoint = (series: SiteSeriesPoint[] | undefined) =>
  Array.isArray(series) && series.length ? series[series.length - 1] : undefined

function checkBlsSeries(
  zip: string, label: string, seriesId: string | undefined, bls: Map<string, Map<string, number>>,
  site: { current?: number; baseline?: number; series?: SiteSeriesPoint[]; valueKey: string },
  tol: number,
) {
  if (!seriesId) return add(zip, `${label} series`, 'SKIP', 'no series ID in response')
  const src = bls.get(seriesId)
  if (!src || !src.size) return add(zip, `${label} source`, 'FAIL', `${seriesId} returned no data from BLS`)

  // Baseline: Jan 2025 monthly value
  const srcBase = src.get(`${BASELINE_YEAR}-01`)
  if (!isNum(site.baseline)) add(zip, `${label} baseline`, 'SKIP', 'not exposed')
  else if (srcBase === undefined) add(zip, `${label} baseline`, 'FAIL', `BLS has no Jan 2025 value for ${seriesId}`)
  else if (!near(site.baseline, srcBase, tol)) add(zip, `${label} baseline`, 'FAIL', `site ${site.baseline} vs BLS ${srcBase}`)
  else add(zip, `${label} baseline`, 'PASS', `${srcBase}`)

  // Latest: compare against BLS value for the same period the site shows
  const sitePt = lastPoint(site.series)
  const siteDate = sitePt ? String(sitePt.date).slice(0, 7) : undefined
  const srcLatestKey = latestKey(src)!
  if (!sitePt || !siteDate) {
    add(zip, `${label} latest`, 'SKIP', 'no series points in response')
  } else {
    const srcVal = src.get(siteDate)
    const siteVal = sitePt[site.valueKey]
    if (srcVal === undefined || !isNum(siteVal)) add(zip, `${label} latest`, 'FAIL', `no comparable value for ${siteDate} (site ${siteVal}, BLS ${srcVal})`)
    else if (!near(siteVal, srcVal, tol))
      // A cached older month may have been revised by BLS since; only a hard FAIL when the site is on BLS's latest month.
      add(zip, `${label} latest`, siteDate === srcLatestKey ? 'FAIL' : 'WARN', `${siteDate}: site ${siteVal} vs BLS ${srcVal}${siteDate === srcLatestKey ? '' : ' (revised since cached?)'}`)
    else add(zip, `${label} latest`, 'PASS', `${siteDate} = ${srcVal}`)
    if (isNum(site.current) && !near(site.current, siteVal as number, tol)) {
      add(zip, `${label} current`, 'FAIL', `current ${site.current} != last series point ${siteVal}`)
    }
    if (siteDate !== srcLatestKey) add(zip, `${label} freshness vs BLS`, 'WARN', `site latest ${siteDate}, BLS latest ${srcLatestKey} (cache lag)`)
  }

  // Age of the data the site is showing
  if (siteDate) {
    const age = daysSince(endOfMonth(siteDate))
    add(zip, `${label} age`, age <= MAX_AGE_DAYS.bls ? 'PASS' : 'FAIL', `${age}d (max ${MAX_AGE_DAYS.bls})`)
  }
}

async function checkZip(zip: string, bls: Map<string, Map<string, number>>, snap: Json) {
  const audit = snap._audit ?? {}

  // CPI (groceries / shelter)
  const c = get(snap, 'cpi.data')
  if (!c) add(zip, 'cpi', 'SKIP', get(snap, 'cpi.error') ?? 'no data in response')
  else {
    const ids = c.seriesIds ?? {
      groceries: get(audit, 'blsSeriesIds.cpiGroceries'),
      shelter: get(audit, 'blsSeriesIds.cpiShelter'),
    }
    checkBlsSeries(zip, 'grocery', ids?.groceries, bls,
      { current: c.groceriesCurrent, baseline: c.groceriesBaseline, series: c.series, valueKey: 'groceries' }, 0.0005)
    if (isNum(c.groceriesCurrent) && isNum(c.groceriesBaseline) && c.groceriesBaseline > 0 && isNum(c.groceriesChange)) {
      const exp = round1(((c.groceriesCurrent - c.groceriesBaseline) / c.groceriesBaseline) * 100)
      add(zip, 'grocery math', near(c.groceriesChange, exp, 0.11) ? 'PASS' : 'FAIL', `change ${c.groceriesChange}% vs ${exp}%`)
    }
    // Shelter: baseline/latest come from series points; check % change from source values
    const sh = ids?.shelter ? bls.get(ids.shelter) : undefined
    if (!sh || !isNum(c.shelterChange)) add(zip, 'shelter', 'SKIP', 'no shelter series/change exposed')
    else {
      const last = lastPoint(c.series)
      const d = last ? String(last.date).slice(0, 7) : undefined
      const base = sh.get(`${BASELINE_YEAR}-01`)
      const cur = d ? sh.get(d) : undefined
      if (base === undefined || cur === undefined) add(zip, 'shelter', 'SKIP', `BLS missing Jan 2025 or ${d}`)
      else {
        const exp = round1(((cur - base) / base) * 100)
        add(zip, 'shelter math', near(c.shelterChange, exp, 0.11) ? 'PASS' : 'FAIL', `change ${c.shelterChange}% vs ${exp}% (BLS ${base} -> ${cur})`)
      }
    }
  }

  // Gas (EIA weekly)
  const g = get(snap, 'gas.data')
  const duoarea: string | undefined = g?.duoarea ?? get(audit, 'gasSeries.duoarea')
  if (!g) return add(zip, 'gas', 'SKIP', get(snap, 'gas.error') ?? 'no data in response')
  if (!duoarea) return add(zip, 'gas', 'SKIP', 'no duoarea in response')
  const product = get(audit, 'sources.gas.product')
  if (product === undefined) add(zip, 'gas product', 'WARN', 'site does not report its EIA product (pre-EPMR deploy?)')
  else add(zip, 'gas product', product === 'EPMR' ? 'PASS' : 'FAIL', `site product ${product} (expected EPMR = regular)`)
  if (!EIA_KEY) return add(zip, 'gas', 'SKIP', 'EIA_API_KEY not set')
  try {
    const eia = await fetchEia(duoarea)
    if (!eia.length) return add(zip, 'gas source', 'FAIL', `EIA ${duoarea} returned no data`)
    const eiaBase = eia.find((d) => d.period <= GAS_BASELINE_DATE)
    if (!isNum(g.baseline)) add(zip, 'gas baseline', 'SKIP', 'not exposed')
    else if (!eiaBase) add(zip, 'gas baseline', 'FAIL', `EIA ${duoarea} has no reading on/before ${GAS_BASELINE_DATE}`)
    else add(zip, 'gas baseline', near(g.baseline, eiaBase.value, 0.0051) ? 'PASS' : 'FAIL', `site ${g.baseline} vs EIA ${eiaBase.value} (${eiaBase.period})`)

    const last = lastPoint(g.series)
    const siteDate = last ? String(last.date).slice(0, 10) : undefined
    const eiaAt = siteDate ? eia.find((d) => d.period === siteDate) : undefined
    if (!last || !eiaAt) add(zip, 'gas latest', 'SKIP', `no EIA reading matching site date ${siteDate}`)
    else add(zip, 'gas latest', near(Number(last.price), eiaAt.value, 0.0051) ? 'PASS' : 'FAIL', `${siteDate}: site ${last.price} vs EIA ${eiaAt.value}`)
    if (isNum(g.current) && last && !near(g.current, Number(last.price), 0.0051)) add(zip, 'gas current', 'FAIL', `current ${g.current} != last point ${last.price}`)
    if (isNum(g.current) && isNum(g.baseline) && isNum(g.change))
      add(zip, 'gas math', near(g.change, g.current - g.baseline, 0.0101) ? 'PASS' : 'FAIL', `change ${g.change} vs ${(g.current - g.baseline).toFixed(3)}`)
    if (siteDate) {
      const age = daysSince(new Date(`${siteDate}T00:00:00Z`))
      add(zip, 'gas age', age <= MAX_AGE_DAYS.eia ? 'PASS' : 'FAIL', `${age}d (max ${MAX_AGE_DAYS.eia})`)
    }
    if (eia[0].period !== siteDate) add(zip, 'gas freshness vs EIA', 'WARN', `site latest ${siteDate}, EIA latest ${eia[0].period} (cache lag)`)
  } catch (e) {
    add(zip, 'gas source', 'FAIL', `EIA fetch error: ${(e as Error).message}`)
  }
}

// ---------------------------------------------------------------------------
// --codes: every mapped EIA duoarea / BLS CPI area returns data; PAD map matches EIA
// ---------------------------------------------------------------------------
const OFFICIAL_PAD: Record<string, string> = {
  ME: '1A', NH: '1A', VT: '1A', MA: '1A', RI: '1A', CT: '1A',
  NY: '1B', NJ: '1B', PA: '1B', DE: '1B', MD: '1B', DC: '1B',
  VA: '1C', WV: '1C', NC: '1C', SC: '1C', GA: '1C', FL: '1C',
  OH: '2', MI: '2', IN: '2', IL: '2', WI: '2', MN: '2', IA: '2', MO: '2', ND: '2', SD: '2', NE: '2', KS: '2', KY: '2', TN: '2', OK: '2',
  TX: '3', LA: '3', MS: '3', AL: '3', AR: '3', NM: '3',
  MT: '4', ID: '4', WY: '4', CO: '4', UT: '4',
  WA: '5', OR: '5', CA: '5', NV: '5', AZ: '5', AK: '5', HI: '5',
}

async function checkCodes() {
  const eiaMap = await import('../src/lib/mappings/eia-gas')
  const cpiMap = await import('../src/lib/mappings/county-metro-cpi')

  const duoareas = new Set<string>(['NUS'])
  for (const d of Object.values(eiaMap.CPI_TO_EIA_CITY) as Json[]) duoareas.add(d.duoarea)
  for (const d of Object.values(eiaMap.COUNTY_EIA_CITY_OVERRIDES) as Json[]) duoareas.add(d.duoarea)
  for (const d of Object.values(eiaMap.STATE_LEVEL_CODES) as Json[]) duoareas.add(d.duoarea)
  for (const d of Object.values(eiaMap.PAD_DUOAREA) as string[]) duoareas.add(d)
  for (const code of duoareas) {
    try {
      const data = await fetchEia(code)
      add('codes', `EIA ${code}`, data.length ? 'PASS' : 'FAIL', data.length ? `${data[0].value} (${data[0].period})` : 'no data')
    } catch (e) {
      add('codes', `EIA ${code}`, 'FAIL', (e as Error).message)
    }
    await new Promise((r) => setTimeout(r, 150))
  }

  const areas = [...Object.keys(cpiMap.BLS_CPI_AREAS), '0000']
  const ids = areas.flatMap((a) => [`CUUR${a}SAF11`, `CUUR${a}SAH1`, `CUUR${a}SA0E`])
  try {
    const res = await fetchBls(ids)
    for (const id of ids) add('codes', `BLS ${id}`, res.get(id)?.size ? 'PASS' : 'FAIL', res.get(id)?.size ? `latest ${latestKey(res.get(id)!)}` : 'no data')
  } catch (e) {
    add('codes', 'BLS CPI areas', 'FAIL', (e as Error).message)
  }

  for (const [st, pad] of Object.entries(eiaMap.STATE_TO_PAD) as Array<[string, unknown]>) {
    const off = OFFICIAL_PAD[st]
    if (off) add('codes', `PAD ${st}`, String(pad) === off ? 'PASS' : 'FAIL', `ours ${pad}, EIA ${off}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const withCodes = args.includes('--codes')
  const zips = args.filter((a) => /^\d{5}$/.test(a))
  const targets = zips.length ? zips : DEFAULT_ZIPS
  console.log(`verify-live: ${BASE_URL}  zips=${targets.length}  BLS key=${BLS_KEY ? 'yes' : 'no'}  EIA key=${EIA_KEY ? 'yes' : 'no'}\n`)

  // 1. Fetch site responses
  const snaps = new Map<string, Json>()
  for (const zip of targets) {
    try {
      snaps.set(zip, await fetchJson(`${BASE_URL}/api/data/${zip}?audit=true`))
    } catch (e) {
      add(zip, 'site fetch', 'FAIL', (e as Error).message)
    }
  }

  // 2. One batched BLS call for every series the site reported
  const ids = new Set<string>()
  for (const snap of snaps.values()) {
    const a = snap._audit?.blsSeriesIds ?? {}
    for (const id of [snap.cpi?.data?.seriesIds?.groceries, snap.cpi?.data?.seriesIds?.shelter,
      a.cpiGroceries, a.cpiShelter]) if (typeof id === 'string') ids.add(id)
  }
  let bls = new Map<string, Map<string, number>>()
  if (ids.size) {
    try {
      bls = await fetchBls([...ids])
    } catch (e) {
      add('all', 'BLS fetch', 'FAIL', (e as Error).message)
    }
  } else if (snaps.size) {
    add('all', 'BLS series', 'SKIP', 'response exposes no BLS series IDs')
  }

  // 3. Per-zip checks
  for (const [zip, snap] of snaps) await checkZip(zip, bls, snap)

  if (withCodes) await checkCodes()

  // 4. Report
  const w = Math.max(...rows.map((r) => r.check.length), 5)
  for (const r of rows) console.log(`${r.zip.padEnd(6)} ${r.check.padEnd(w)}  ${r.status.padEnd(4)}  ${r.detail}`)
  const count = (s: Status) => rows.filter((r) => r.status === s).length
  console.log(`\nSUMMARY: ${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('WARN')} WARN, ${count('SKIP')} SKIP`)
  if (count('FAIL') > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(2)
})
