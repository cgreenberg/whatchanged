// Zip- and county-level "local pulse" data, built offline by scripts/build-local-data.py
// and served as static JSON from /public/data. No API keys, no runtime upstream calls.
//
// Validation (docs/validation/FINDINGS.md) shows county differences are corroborated by independent
// sources but zip-vs-zip differences inside a county are not, so the UI leads with county (or city)
// figures and shows zip figures as estimates. Every date/window shown comes from meta.json.

/** Site-wide baseline month (Jan 20 2025 → BLS/Zillow monthly data use the January 2025 value). */
export const BASELINE_MONTH = '2025-01'

export interface MonthlySeries {
  start: string // YYYY-MM of s[0]
  s: (number | null)[]
  base: number // baseline-month value
  cur: number
  pct: number // % change since the baseline month
  asOf: string
}

/** Rent: `sa` = seasonally adjusted change since the baseline month; `yoy` = latest month vs the same month a
 * year earlier (series too short to adjust). `cur` is always the observed (unadjusted) latest asking rent. */
export interface RentFigure {
  basis: 'sa' | 'yoy'
  pct: number
  cur: number
  asOf: string
  start?: string
  s?: (number | null)[] // SA series, trend line only (sa basis)
}

export interface ListingSnapshot {
  price: number
  priceYoY: number | null // fractional, 0.05 = +5%
  active: number
  activeYoY: number | null
  dom: number | null
  domYoY: number | null
  reduced: number | null // share of listings with a price cut
  volatile: boolean
}

export interface ZipPulse {
  hv?: MonthlySeries
  rent?: RentFigure
  listings?: ListingSnapshot
}

export interface CountyPulse {
  n: string
  z?: string
  hv?: number; hvCur?: number
  rent?: number; rentYoY?: number; rentCur?: number
  ur?: number; urBase?: number; urCur?: number
  wage?: number; wageCur?: number
  jobs?: number; emp?: number
  cpi?: number; cpiArea?: string; cpiName?: string
  real?: number
  permits?: number; permitsCur?: number
  approx?: string[]; approxFrom?: string
  flags?: string[]
  note?: Record<string, string>
}

export type CountyMap = Record<string, CountyPulse>

export interface CityPulse {
  n: string
  county: string
  hv?: { pct: number; cur: number; asOf: string }
  rent?: { pct: number; cur: number; asOf: string; basis: 'sa' | 'yoy' }
}

export interface SourceMeta {
  latest: string
  label: string
  url: string
  short?: string
  adjustment?: string
  window?: string
  /** LAUS: the preliminary month the static headline excludes (YYYY-MM). */
  preliminaryExcluded?: string
}

export interface PulseMeta {
  baseline: string
  paycheckWindow?: string
  sources: Record<string, SourceMeta>
}

// ---------- Fetching: failures reject (callers show "Data unavailable") and are never cached ----------

const cache = new Map<string, Promise<unknown>>()

function getJson<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined
  if (!p) {
    p = fetch(url).then(r => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
      return r.json() as Promise<T>
    })
    cache.set(url, p)
    p.catch(() => cache.delete(url))
  }
  return p
}

/** Test hook. */
export function clearPulseCache() {
  cache.clear()
}

export function fetchPulseMeta(): Promise<PulseMeta> {
  return getJson<PulseMeta>('/data/meta.json')
}

/** Resolves null when the zip has no zip-level data; rejects on network/HTTP failure. */
export async function fetchZipPulse(zip: string): Promise<ZipPulse | null> {
  if (!/^\d{5}$/.test(zip)) return null
  try {
    const shard = await getJson<Record<string, ZipPulse>>(`/data/zip/${zip.slice(0, 3)}.json`)
    return shard[zip] ?? null
  } catch (e) {
    // A missing shard (404) just means no zip in that prefix has data.
    if (e instanceof Error && /HTTP 404/.test(e.message)) return null
    throw e
  }
}

/** One county from the per-state shard (small download for the zip lookup). */
export async function fetchCounty(countyFips: string): Promise<CountyPulse | null> {
  if (!/^\d{5}$/.test(countyFips)) return null
  try {
    const shard = await getJson<CountyMap>(`/data/county/${countyFips.slice(0, 2)}.json`)
    return shard[countyFips] ?? null
  } catch (e) {
    if (e instanceof Error && /HTTP 404/.test(e.message)) return null
    throw e
  }
}

/** All counties (national map). */
export function fetchCounties(): Promise<CountyMap> {
  return getJson<CountyMap>('/data/counties.json')
}

/** Zillow city figures, only when the city's Zillow county matches the zip's county. */
export async function fetchCity(stateAbbr: string, cityName: string, countyName: string): Promise<CityPulse | null> {
  if (!/^[A-Z]{2}$/.test(stateAbbr) || !cityName || !countyName) return null
  let shard: Record<string, CityPulse>
  try {
    shard = await getJson<Record<string, CityPulse>>(`/data/cities/${stateAbbr}.json`)
  } catch (e) {
    if (e instanceof Error && /HTTP 404/.test(e.message)) return null
    throw e
  }
  const norm = (s: string) => s.trim().toLowerCase()
  const hits = Object.values(shard).filter(c => norm(c.n) === norm(cityName) && norm(c.county) === norm(countyName))
  return hits.length === 1 ? hits[0] : null
}

// ---------- Formatting ----------

export function fmtPct(v: number, digits = 1): string {
  const r = Number(v.toFixed(digits))
  if (r === 0) return '0%'
  return `${r > 0 ? '+' : ''}${r.toFixed(digits)}%`
}

export function fmtMoney(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6 || Math.round(a / 1e3) >= 1000) return `$${(v / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `$${Math.round(v / 1e3)}K`
  return `$${Math.round(v).toLocaleString('en-US')}`
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function sinceBaseline(meta: PulseMeta | null): string {
  return `since ${fmtMonth(meta?.baseline ?? BASELINE_MONTH)}`
}

export const YOY_WINDOW = 'vs the same month a year earlier'

/** Provenance footer: `Source · geography · window · as-of · adjustment`. Missing parts are skipped. */
export function provenance(
  meta: PulseMeta | null,
  sourceKey: string,
  geography: string,
  window?: string,
  adjustmentOverride?: string,
  /** The displayed row's own latest month (YYYY-MM) when it has one; else the source's latest from meta. */
  asOfOverride?: string,
): string {
  const s = meta?.sources[sourceKey]
  const latest = asOfOverride || s?.latest
  const parts = [
    s?.short ?? s?.label,
    geography,
    window ?? s?.window,
    latest ? (/^\d{4}-\d{2}$/.test(latest) ? fmtMonth(latest) : latest) : undefined,
    adjustmentOverride ?? s?.adjustment,
  ]
  return parts.filter(Boolean).join(' · ')
}

// ---------- Map metrics ----------

export type MetricKey = 'hv' | 'rent' | 'real' | 'ur' | 'permits'

export interface MetricDef {
  key: MetricKey
  label: string
  short: string
  clamp: number // symmetric color domain
  unit: '%' | 'pts'
  sourceKey: string
  /** Value text for one county; never contains dates (windows come from meta). */
  describe: (c: CountyPulse) => string | null
  window: (meta: PulseMeta | null) => string
}

const signed = (v: number, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`

export const METRICS: MetricDef[] = [
  {
    key: 'hv', label: 'Home values', short: 'Home values', clamp: 10, unit: '%', sourceKey: 'zhvi',
    describe: c => (c.hv == null ? null : `${fmtPct(c.hv)}${c.hvCur ? ` · typical home ${fmtMoney(c.hvCur)}` : ''}`),
    window: sinceBaseline,
  },
  {
    key: 'rent', label: 'Rent (new leases)', short: 'Rent', clamp: 10, unit: '%', sourceKey: 'zori',
    describe: c => (c.rent == null ? null : `${fmtPct(c.rent)}${c.rentCur ? ` · typical asking rent ${fmtMoney(c.rentCur)}/mo` : ''}`),
    window: sinceBaseline,
  },
  {
    key: 'real', label: 'Paychecks vs. prices', short: 'Paycheck vs prices', clamp: 6, unit: '%', sourceKey: 'qcew',
    describe: c =>
      c.real == null || c.wage == null || c.cpi == null
        ? null
        : `Wages ${fmtPct(c.wage)} vs prices ${fmtPct(c.cpi)} → ${c.real >= 0 ? 'ahead' : 'behind'} by ${Math.abs(c.real).toFixed(1)}%`,
    window: m => m?.paycheckWindow ?? m?.sources.qcew?.window ?? '',
  },
  {
    key: 'ur', label: 'Unemployment rate', short: 'Unemployment', clamp: 1.5, unit: 'pts', sourceKey: 'laus',
    describe: c =>
      c.ur == null ? null : `${signed(c.ur)} pts${c.urBase != null && c.urCur != null ? ` · ${c.urBase.toFixed(1)}% → ${c.urCur.toFixed(1)}%` : ''}`,
    window: m => m?.sources.laus?.window ?? '',
  },
  {
    key: 'permits', label: 'New home construction', short: 'New construction', clamp: 60, unit: '%', sourceKey: 'permits',
    describe: c =>
      c.permits == null ? null : `${fmtPct(c.permits, 0)} permitted units${c.permitsCur != null ? ` (${c.permitsCur.toLocaleString('en-US')} units)` : ''}`,
    window: m => m?.sources.permits?.window ?? '',
  },
]

export function metricFooter(def: MetricDef, meta: PulseMeta | null, geography = 'county'): string {
  return provenance(meta, def.sourceKey, geography, def.window(meta) || undefined)
}

/** Flag keys used for a displayed metric (paychecks combine wages and the real-pay gap). */
const FLAG_KEYS: Record<string, string[]> = { real: ['real', 'wage'], wage: ['wage', 'real'] }

export const MOVERS_MIN_JOBS = 75000

/** Biggest movers among large counties, excluding approximated counties and flagged outliers
 * (for paychecks, a wage OR real-pay flag excludes the county, matching flagNote).
 * Top and bottom lists never overlap. */
export function moversFor(data: CountyMap, metric: MetricKey, n = 5) {
  const rows = Object.entries(data)
    .filter(([, c]) =>
      typeof c[metric] === 'number' && Number.isFinite(c[metric]) &&
      (c.emp ?? 0) >= MOVERS_MIN_JOBS && !c.approx?.length &&
      !(FLAG_KEYS[metric] ?? [metric]).some(k => c.flags?.includes(k)))
    .sort((a, b) => (b[1][metric] as number) - (a[1][metric] as number))
  const k = Math.min(n, Math.floor(rows.length / 2))
  return { top: rows.slice(0, k), bottom: rows.slice(rows.length - k).reverse() }
}

/** Shown when a county figure is a statistical outlier (flags) but has no documented note. */
export const FLAG_CAVEAT =
  'Unusual value: far outside the range most U.S. counties show, so treat it with caution.'


/**
 * Caveat for a flagged county metric: "Unusual value: <documented note>" when the build documents why,
 * else a generic outlier caveat; null when the metric isn't flagged or noted.
 */
export function flagNote(c: CountyPulse | null | undefined, key: string): string | null {
  if (!c) return null
  const keys = FLAG_KEYS[key] ?? [key]
  const note = keys.map(k => c.note?.[k]).find(Boolean)
  if (note) return `Unusual value: ${note}`
  if (keys.some(k => c.flags?.includes(k))) return FLAG_CAVEAT
  return null
}

export function approxNote(c: CountyPulse): string | null {
  if (!c.approx?.length) return null
  return `Approximation: some figures for ${c.n} (jobs, wages, unemployment, permits) come from ${c.approxFrom ?? 'a neighboring area'}, because the source no longer publishes this county separately.`
}

// Neutral diverging scale (not good/bad coded): blue = fell, amber = rose.
const NEG = [59, 130, 246]
const MID = [39, 39, 42]
const POS = [245, 158, 11]
export function divergingColor(v: number | undefined, clamp: number): string {
  if (v == null || !Number.isFinite(v)) return '#18181b'
  const t = Math.max(-1, Math.min(1, v / clamp))
  const a = Math.pow(Math.abs(t), 0.7)
  const end = t < 0 ? NEG : POS
  const c = MID.map((m, i) => Math.round(m + (end[i] - m) * a))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** Months the county time-lapse rows for `metric` are aligned to (rent may cover different months). */
export function timelineMonths(t: { months: string[]; rentMonths?: string[] }, metric: string): string[] {
  return metric === 'rent' && t.rentMonths?.length ? t.rentMonths : t.months
}
