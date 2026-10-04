// County-level price data, built offline by scripts/build-local-data.py and served as static JSON
// from /public/data. No API keys, no runtime upstream calls. Used by the national county map and the
// Housing graph's Zillow tabs. Every date/window shown comes from meta.json or the series themselves.

/** Site-wide baseline month (Jan 20 2025 → monthly Zillow data use the January 2025 value). */
export const BASELINE_MONTH = '2025-01'

/** Monthly series: `v[0]` is the value for `start` (YYYY-MM); null = month not published. */
export interface CompactSeries {
  start: string
  v: (number | null)[]
}

export interface CountyRecord {
  n: string
  /** Representative zip (most populous Zillow zip, else any crosswalk zip) so map taps can load the place. */
  z?: string
  /** Zillow ZHVI % change since the baseline month (seasonally adjusted by Zillow) and latest typical value. */
  hv?: number
  hvCur?: number
  /** Zillow ZORI % change since the baseline month (seasonally adjusted by whatchanged) and latest observed rent. */
  rent?: number
  rentCur?: number
  /** Last-quarter jobs (BLS QCEW), only used to pick counties large enough for the movers lists. */
  emp?: number
  approx?: string[]
  flags?: string[]
  note?: Record<string, string>
  /** Monthly ZHVI levels since 2016 (county shards only). */
  hvS?: CompactSeries
  /** Monthly ZORI levels since 2016, seasonally adjusted by whatchanged (county shards only). */
  rentS?: CompactSeries
}

export type CountyMap = Record<string, CountyRecord>

export interface SourceMeta {
  latest: string
  label: string
  url: string
  short?: string
  adjustment?: string
  window?: string
}

export interface LocalMeta {
  baseline: string
  sources: Record<string, SourceMeta>
}

export interface UsHousing {
  hvS?: CompactSeries
  rentS?: CompactSeries
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
export function clearCountyDataCache() {
  cache.clear()
}

export function fetchLocalMeta(): Promise<LocalMeta> {
  return getJson<LocalMeta>('/data/meta.json')
}

/** One county from the per-state shard (includes the monthly Zillow series). */
export async function fetchCounty(countyFips: string): Promise<CountyRecord | null> {
  if (!/^\d{5}$/.test(countyFips)) return null
  try {
    const shard = await getJson<CountyMap>(`/data/county/${countyFips.slice(0, 2)}.json`)
    return shard[countyFips] ?? null
  } catch (e) {
    if (e instanceof Error && /HTTP 404/.test(e.message)) return null
    throw e
  }
}

/** All counties (national map; no monthly series). */
export function fetchCounties(): Promise<CountyMap> {
  return getJson<CountyMap>('/data/counties.json')
}

/** U.S. ZHVI and seasonally adjusted ZORI series (Housing graph "Show national"). */
export function fetchUsHousing(): Promise<UsHousing> {
  return getJson<UsHousing>('/data/us-housing.json')
}

/** Month `i` steps after YYYY-MM `start`. */
export function addMonths(start: string, i: number): string {
  const [y, m] = start.split('-').map(Number)
  const n = y * 12 + (m - 1) + i
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
}

/** Chart rows `{ date, [key]: value }` for a compact series (unpublished months are skipped). */
export function seriesRows(s: CompactSeries | undefined | null, key: string): Array<{ date: string; [k: string]: unknown }> {
  if (!s || !/^\d{4}-\d{2}$/.test(s.start) || !Array.isArray(s.v)) return []
  const rows: Array<{ date: string; [k: string]: unknown }> = []
  s.v.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) rows.push({ date: addMonths(s.start, i), [key]: v })
  })
  return rows
}

/** % change from the baseline month to the series' latest month, rounded to 0.1 (null when either is missing). */
export function seriesChangeSinceBaseline(s: CompactSeries | undefined | null): number | null {
  const rows = seriesRows(s, 'v')
  const base = rows.find(r => r.date === BASELINE_MONTH)
  const last = rows[rows.length - 1]
  if (!base || !last || last.date <= BASELINE_MONTH) return null
  const pct = ((last.v as number) / (base.v as number) - 1) * 100
  const r = Math.round(pct * 10) / 10
  return Object.is(r, -0) ? 0 : r
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

export function sinceBaseline(meta: LocalMeta | null): string {
  return `since ${fmtMonth(meta?.baseline ?? BASELINE_MONTH)}`
}

/** Provenance footer: `Source · geography · window · as-of · adjustment`. Missing parts are skipped. */
export function provenance(
  meta: LocalMeta | null,
  sourceKey: string,
  geography: string,
  window?: string,
): string {
  const s = meta?.sources[sourceKey]
  const latest = s?.latest
  const parts = [
    s?.short ?? s?.label,
    geography,
    window ?? s?.window,
    latest ? (/^\d{4}-\d{2}$/.test(latest) ? fmtMonth(latest) : latest) : undefined,
    s?.adjustment,
  ]
  return parts.filter(Boolean).join(' · ')
}

// ---------- Map metrics (prices only) ----------

export type MetricKey = 'rent' | 'hv'

export interface MetricDef {
  key: MetricKey
  label: string
  short: string
  clamp: number // symmetric color domain, %
  sourceKey: string
  /** Value text for one county; never contains dates (windows come from meta). */
  describe: (c: CountyRecord) => string | null
  window: (meta: LocalMeta | null) => string
}

export const METRICS: MetricDef[] = [
  {
    key: 'hv', label: 'Home prices', short: 'Home prices', clamp: 10, sourceKey: 'zhvi',
    describe: c => (c.hv == null ? null : `${fmtPct(c.hv)}${c.hvCur ? ` · typical home ${fmtMoney(c.hvCur)}` : ''}`),
    window: sinceBaseline,
  },
  {
    key: 'rent', label: 'Rent (new leases)', short: 'Rent', clamp: 10, sourceKey: 'zori',
    describe: c => (c.rent == null ? null : `${fmtPct(c.rent)}${c.rentCur ? ` · typical asking rent ${fmtMoney(c.rentCur)}/mo` : ''}`),
    window: sinceBaseline,
  },
]

export function metricFooter(def: MetricDef, meta: LocalMeta | null, geography = 'county'): string {
  return provenance(meta, def.sourceKey, geography, def.window(meta) || undefined)
}

export const MOVERS_MIN_JOBS = 75000

/** Biggest movers among large counties, excluding approximated counties and flagged outliers.
 * Top and bottom lists never overlap. */
export function moversFor(data: CountyMap, metric: MetricKey, n = 5) {
  const rows = Object.entries(data)
    .filter(([, c]) =>
      typeof c[metric] === 'number' && Number.isFinite(c[metric]) &&
      // `approx` lists approximated fields (in practice only `emp`, the jobs count used for the size
      // cut): only an approximated figure for THIS metric excludes a county, never an estimated jobs count
      (c.emp ?? 0) >= MOVERS_MIN_JOBS && !c.approx?.includes(metric) && !c.flags?.includes(metric))
    .sort((a, b) => (b[1][metric] as number) - (a[1][metric] as number))
  const k = Math.min(n, Math.floor(rows.length / 2))
  return { top: rows.slice(0, k), bottom: rows.slice(rows.length - k).reverse() }
}

/** Shown when a county figure is a statistical outlier (flags) but has no documented note. */
export const FLAG_CAVEAT =
  'Unusual value: far outside the range most U.S. counties show, so treat it with caution.'

/** Caveat for a flagged county metric: "Unusual value: <documented note>", else a generic caveat; null when not flagged. */
export function flagNote(c: CountyRecord | null | undefined, key: string): string | null {
  if (!c) return null
  const note = c.note?.[key]
  if (note) return `Unusual value: ${note}`
  if (c.flags?.includes(key)) return FLAG_CAVEAT
  return null
}

// Neutral diverging scale (not good/bad coded): blue = fell, amber = rose.
const NEG = [59, 130, 246]
const MID = [39, 39, 42]
const POS = [245, 158, 11]
/**
 * No-data fill: a hatch of mid-gray on near-black (map SVG pattern NO_DATA_PATTERN_ID), so a missing
 * county never reads as a ~0% change (the scale's midpoint is near-black). NO_DATA_COLOR is the
 * solid stand-in where a pattern can't be used (it is lighter than any near-zero color).
 */
export const NO_DATA_COLOR = '#71717a'
export const NO_DATA_PATTERN_ID = 'map-nodata-hatch'
export function divergingColor(v: number | undefined, clamp: number): string {
  if (v == null || !Number.isFinite(v)) return NO_DATA_COLOR
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
