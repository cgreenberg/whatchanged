// County-level price data, built offline by scripts/build-local-data.py and served as static JSON
// from /public/data. No API keys, no runtime upstream calls. Used by the national county map and the
// Housing graph's Zillow tabs. Every date/window shown comes from meta.json or the series themselves.
// The map's Gas / Groceries / Electricity layers come from /api/map-metrics (cache reads only).

import type { MapMetrics } from '@/lib/api/map-metrics'
import { STATE_FIPS_MAP } from '@/lib/mappings/state-fips'
import { fmtSignedDollars, fmtSignedPct, fmtMonthYear, fmtDay } from '@/lib/format'
import type { EconomicSnapshot } from '@/types'
import { notCurrentText } from '@/lib/rent-range'
import { ELECTRICITY_BASELINE_FROM, ELECTRICITY_BASELINE_TO, ELECTRICITY_BASELINE_LABEL, ELECTRICITY_BASELINE_SHORT } from '@/lib/baseline'

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
  /** Rent seasonally adjusted with this pool's typical pattern (series too short for its own), e.g. "Maine counties". */
  rentSaPool?: string
  /**
   * County shards only, for counties with no Zillow county series: the county's metro (OMB 2020 CBSA) rent —
   * the Rent card's metro rung and the Rent tab — with its seasonally adjusted monthly levels in `rentMS`.
   */
  rentM?: { n: string; cbsa: string; rent: number; cur: number; flag?: boolean; saPool?: string }
  rentMS?: CompactSeries
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

/** Signed % with a true minus sign ("−2.1%"), the same formatter as the cards. */
export function fmtPct(v: number, digits = 1): string {
  return fmtSignedPct(v, digits)
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

/** County-level map metrics (static Zillow pipeline): movers lists and the time-lapse apply. */
export type CountyMetricKey = 'rent' | 'hv'
/** Metro / regional / statewide series from the live cache: one value per area, no movers or time-lapse. */
export type LiveMetricKey = 'gas' | 'groceries' | 'elec'
export type MetricKey = CountyMetricKey | LiveMetricKey

export interface MetricDef {
  key: CountyMetricKey
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

export interface LiveMetricDef {
  key: LiveMetricKey
  label: string
  short: string
  /** Symmetric color domain: $/gal for gas, % for the others. */
  clamp: number
  unit: 'usd' | 'pct'
  /** Why blocks of counties share one color. */
  scopeNote: string
}

export const LIVE_METRICS: LiveMetricDef[] = [
  {
    key: 'gas', label: 'Gas prices ($/gal change)', short: 'Gas', clamp: 0.5, unit: 'usd',
    scopeNote: 'Gas prices are reported by metro area, state or region, not by county, so neighboring counties share one color.',
  },
  {
    key: 'groceries', label: 'Grocery prices (CPI)', short: 'Groceries', clamp: 5, unit: 'pct',
    scopeNote: 'Grocery prices (BLS CPI) are reported by metro area or Census division, not by county, so whole regions share one color.',
  },
  {
    key: 'elec', label: 'Electricity prices', short: 'Electricity', clamp: 20, unit: 'pct',
    scopeNote: 'Electricity prices are statewide averages (EIA), so each state is one color.',
  },
]

/** Chip order on the map: Gas | Rent | Home prices | Groceries | Electricity. */
export const MAP_METRIC_ORDER: MetricKey[] = ['gas', 'rent', 'hv', 'groceries', 'elec']

export const isCountyMetric = (k: MetricKey): k is CountyMetricKey => k === 'rent' || k === 'hv'

/** Shown instead of the movers lists for metro / regional / statewide metrics. */
export const NO_MOVERS_NOTE = "No biggest-mover lists for this measure: it isn't published county by county."

export function fetchMapMetrics(): Promise<MapMetrics> {
  return getJson<MapMetrics>('/api/map-metrics')
}

export interface LiveCountyValue {
  /** Gas: $/gal change; groceries / electricity: % change. */
  value: number
  /** "+$0.12/gal since Jan 2025", "+2.1% since Jan 2025". */
  text: string
  /** The series' area: "New England (PADD 1A) avg", "Atlanta metro", "Maine statewide". */
  area: string
  /** Extra detail: level, source, adjustment, as-of. */
  detail: string
  asOf: string | null
}

/** Appended when the map served a cache entry's last-good copy (the fresh one expired). */
const STALE_COPY = ' · last available copy, may be out of date'

/** One county's value for a live metric (null when the county's series is not cached / not published). */
export function liveValue(m: MapMetrics | null | undefined, fips: string, key: LiveMetricKey): LiveCountyValue | null {
  if (!m) return null
  if (key === 'elec') {
    const st = STATE_FIPS_MAP[fips.slice(0, 2)]?.abbr
    const e = st ? m.electricity?.[st] : undefined
    if (!e) return null
    return {
      value: e.pct, text: `${fmtPct(e.pct)} vs ${ELECTRICITY_BASELINE_SHORT}`, area: `${e.label} statewide`,
      detail: `${e.cents.toFixed(1)}¢/kWh avg, 12 months to ${fmtMonthYear(e.asOf)} · EIA${e.stale ? STALE_COPY : ''}`, asOf: e.asOf,
    }
  }
  const row = m.counties?.[fips]
  if (!row) return null
  if (key === 'gas') {
    const g = m.gas?.[row[0]]
    if (!g || g.change == null || g.current == null) return null
    const when = g.asOf
      ? g.frequency === 'weekly' ? `week of ${fmtDay(g.asOf)}` : g.frequency === 'semiannual' ? `${fmtMonthYear(g.asOf)} survey` : fmtMonthYear(g.asOf)
      : ''
    const how = g.source === 'dcra' ? 'Alaska DCRA survey (twice yearly)' : g.source === 'daco' ? 'Puerto Rico DACO monthly' : g.source === 'bls' ? 'BLS monthly' : 'EIA weekly'
    return {
      value: g.change, text: `${fmtSignedDollars(g.change)}/gal ${sinceBaseline(null)}`,
      area: g.standIn ? `${g.label} (no series for this county)` : g.label,
      detail: `$${g.current.toFixed(2)}/gal · ${how}${when ? `, ${when}` : ''}${g.stale ? STALE_COPY : ''}`,
      asOf: g.asOf,
    }
  }
  const c = m.groceries?.[row[1]]
  if (!c || c.pct == null) return null
  return {
    value: c.pct, text: `${fmtPct(c.pct)} ${sinceBaseline(null)}`, area: c.label,
    detail: `BLS CPI food at home${c.asOf ? `, ${fmtMonthYear(c.asOf)}` : ''}${c.stale ? STALE_COPY : ''}`, asOf: c.asOf,
  }
}

/** Latest as-of among a live metric's areas ("YYYY-MM[-DD]"), for the footer. */
export function liveAsOf(m: MapMetrics | null | undefined, key: LiveMetricKey): string | null {
  if (!m) return null
  const dates = key === 'elec'
    ? Object.values(m.electricity ?? {}).map(e => e.asOf)
    : key === 'gas' ? (m.gas ?? []).map(g => g.asOf) : (m.groceries ?? []).map(c => c.asOf)
  return dates.filter((d): d is string => !!d).sort().pop() ?? null
}

/** Footer for a live metric: source · geography · window · as-of · adjustment. */
export function liveFooter(key: LiveMetricKey, m: MapMetrics | null | undefined): string {
  const asOf = liveAsOf(m, key)
  const latest = asOf ? `latest ${asOf.length > 7 ? fmtDay(asOf) : fmtMonthYear(asOf)}` : 'not loaded'
  if (key === 'gas') return `EIA weekly / BLS monthly regular gasoline (Alaska outside Anchorage: DCRA community survey, twice yearly) · metro, state, region or Alaska borough · $ change ${sinceBaseline(null)} · ${latest} · not seasonally adjusted`
  if (key === 'groceries') return `BLS CPI food at home · metro area or Census division · ${sinceBaseline(null)} · ${latest} · not seasonally adjusted`
  return `EIA average residential electricity price · statewide · latest 12-month average price vs ${ELECTRICITY_BASELINE_LABEL} (${fmtMonthYear(ELECTRICITY_BASELINE_FROM)}–${fmtMonthYear(ELECTRICITY_BASELINE_TO)}) · ${latest} · no seasonal adjustment needed`
}

export function metricFooter(def: MetricDef, meta: LocalMeta | null, geography = 'county'): string {
  return provenance(meta, def.sourceKey, geography, def.window(meta) || undefined)
}

export const MOVERS_MIN_JOBS = 75000

/** Biggest movers among large counties (jobs count above the cut), excluding counties whose jobs count is
 * approximated (`approx` includes 'emp': Connecticut), counties with an approximated figure for this metric,
 * and flagged outliers. Top and bottom lists never overlap. */
export function moversFor(data: CountyMap, metric: CountyMetricKey, n = 5) {
  const rows = Object.entries(data)
    .filter(([, c]) =>
      typeof c[metric] === 'number' && Number.isFinite(c[metric]) &&
      // An approximated `emp` (borrowed jobs count, e.g. Connecticut planning regions) can't honestly pass
      // the size cut, and relaxing the cut would let tiny counties in: such counties are excluded
      (c.emp ?? 0) >= MOVERS_MIN_JOBS && !c.approx?.includes('emp') &&
      !c.approx?.includes(metric) && !c.flags?.includes(metric))
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

// Neutral diverging scale (not good/bad coded, colorblind-safe): blue = fell, orange = rose; the
// midpoint is the page's charcoal surface so near-zero counties recede.
const NEG = [74, 144, 217]
const MID = [36, 40, 46]
const POS = [236, 146, 58]
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

/**
 * The selected zip's own county in the map panel shows the card's figure where the card uses something the
 * county-wide map value can't: Alaska's per-zip DCRA survey community (the map colors a borough by the median
 * of its surveyed communities) and a metro rent series standing in for a county with no Zillow county series.
 */
export interface ZipPanelOverrides {
  gas?: { text: string; area: string; detail: string }
  rent?: { text: string; area: string }
}

/** Why the county's own Zillow series isn't on the panel (same reasons as the card), short form. */
function metroStandInWhy(r: NonNullable<EconomicSnapshot['rent']>): string {
  const county = (r.countyName ?? '').replace(/,\s*[A-Z]{2}$/, '').trim() || 'this county'
  if (r.countyWhy === 'not-current') return notCurrentText(county, r.countyNotCurrent)
  if (r.countyWhy === 'too-new') return `Zillow's series for ${county} is too new to measure ${sinceBaseline(null)}`
  if (r.countyWhy === 'no-baseline') return `Zillow's series for ${county} has no ${fmtMonthYear(BASELINE_MONTH)} value`
  return 'no Zillow county series'
}

export function zipPanelOverrides(s: EconomicSnapshot | null | undefined): ZipPanelOverrides {
  if (!s) return {}
  const out: ZipPanelOverrides = {}
  const g = s.gas?.data
  if (g && g.source === 'dcra' && Number.isFinite(g.change) && Number.isFinite(g.current)) {
    out.gas = {
      text: `${fmtSignedDollars(g.change)}/gal since the ${fmtMonthYear((g.baselineDate ?? BASELINE_MONTH).slice(0, 7))} survey`,
      area: `${g.geoLevel ?? 'Alaska DCRA survey'} (this zip, as on the card)`,
      detail: `$${g.current.toFixed(2)}/gal · Alaska DCRA survey (twice yearly)${g.latestDate ? `, ${fmtMonthYear(g.latestDate.slice(0, 7))} survey` : ''}`,
    }
  }
  const r = s.rent
  if (r && r.level === 'metro' && Number.isFinite(r.pct)) {
    out.rent = {
      text: `${fmtPct(r.pct)} ${sinceBaseline(null)} · typical asking rent $${Math.round(r.curRent).toLocaleString('en-US')}/mo`,
      area: `${r.geoName} (${metroStandInWhy(r)}; the metro's is used)`,
    }
  }
  return out
}
