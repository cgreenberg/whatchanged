// County-level price data, built offline by scripts/build-local-data.py and served as static JSON
// from /public/data. No API keys, no runtime upstream calls. Used by the national county map and the
// Housing graph's Zillow tabs. Every date/window shown comes from meta.json or the series themselves.
// The map's Gas / Groceries / Electricity layers come from /api/map-metrics (cache reads only).

import type { MapMetrics } from '@/lib/api/map-metrics'
import { gasAreaKind, gasAreaOutside, gasAreaStateCounts, gasKindText, type GasAreaKind } from '@/lib/map-gas-areas'
import { STATE_FIPS_MAP } from '@/lib/mappings/state-fips'
import { fmtSignedDollars, fmtSignedPct, fmtMonthYear, fmtDay } from '@/lib/format'
import type { EconomicSnapshot } from '@/types'
import { notCurrentText, rentSeasonalCaveat, type SeasonalCaveat } from '@/lib/rent-range'
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
  /** Seasonal pattern the county's own is blended with (by history length), e.g. "Maine counties"; rentSaW = own weight 0..1. */
  rentSaPool?: string
  rentSaW?: number
  /** Seasonal-pattern caveat at the displayed (as-of) month (same as county-rent.json `saCaveat`; rent-range.ts). */
  rentSaCav?: SeasonalCaveat
  /**
   * County shards only, for counties with no Zillow county series: the county's metro (OMB 2020 CBSA) rent —
   * the Rent card's metro rung and the Rent tab — with its seasonally adjusted monthly levels in `rentMS`.
   */
  rentM?: { n: string; cbsa: string; rent: number; cur: number; flag?: boolean; saPool?: string; saW?: number; cav?: SeasonalCaveat }
  rentMS?: CompactSeries
  /**
   * County shards only, for counties with no usable county or metro rent: the county's most populous city with a
   * Zillow series (`n` city, `st` state, `id` Zillow RegionID) — the Rent card's city rung and the Rent tab — with
   * its seasonally adjusted monthly levels in `rentCS`.
   */
  rentC?: { n: string; st: string; id: string; rent: number; cur: number; saPool?: string; saW?: number; cav?: SeasonalCaveat }
  rentCS?: CompactSeries
  /**
   * Map only, for counties with no Zillow rent at all: HUD 2-bedroom Fair Market Rent, % change (`p`) from the base
   * fiscal year (`b`, $/mo) to the latest (`c`); fiscal years in meta.sources.hudFmr. `from` = copied from another
   * area; `areas` = New England towns in several HUD areas (the most common one used).
   */
  rentH?: { p: number; b: number; c: number; from?: string; areas?: number }
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
  clamp: number // fallback symmetric color domain, % (the map derives its scale from the data: mapScaleFor)
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
    key: 'rent', label: 'Rent (new listings)', short: 'Rent', clamp: 10, sourceKey: 'zori',
    describe: c => (c.rent == null ? null : `${fmtPct(c.rent)}${c.rentCur ? ` · typical asking rent ${fmtMoney(c.rentCur)}/mo` : ''}`),
    window: sinceBaseline,
  },
]

export interface LiveMetricDef {
  key: LiveMetricKey
  label: string
  short: string
  /** Fallback symmetric color domain ($/gal for gas, % for the others) until data loads; the map uses mapScaleFor. */
  clamp: number
  /**
   * Sequential scale (dimmest = smallest change, brightest = largest) when nearly every county moved the same way: gas
   * rose ~$0.9–1.3 almost everywhere, so a diverging scale around 0 painted the whole map one color. Values on the other
   * side of zero take a distinct color (oppositeColor) with their own legend chip.
   */
  sequential?: true
  unit: 'usd' | 'pct'
  /** Why blocks of counties share one color (gas: none here, the legend's "published for N areas" line says it). */
  scopeNote?: string
}

export const LIVE_METRICS: LiveMetricDef[] = [
  {
    key: 'gas', label: 'Gas prices ($/gal change)', short: 'Gas', clamp: 0.5, unit: 'usd', sequential: true,
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
  /** Short publisher for hover tooltips: "EIA", "BLS", "BLS CPI", "Alaska DCRA", "PR DACO". */
  source: string
  /** Served from the last-good copy. */
  stale?: true
  /** The window / month the value covers, always shown with it ("Jan 2025 → Aug 2026 monthly averages"). */
  when: string
  /** Gas: not on the layer's common window (Alaska survey, a lagging series): patterned, its own months in `when`. */
  ownWindow?: true
  /** Gas: HI/AK county with no series of its own, colored by the nearest metro's (patterned). */
  standIn?: true
  /** Gas: Alaska DCRA community survey. */
  survey?: true
  /** Gas: the kind of published area (city / state / regional average, …; map-gas-areas.ts), null when unknown. */
  kind?: GasAreaKind | null
  /** Gas: plain-language area + kind ("Midwest region average · used for counties in 13 states (EIA PADD 2)"), when known. */
  kindText?: string
}

/** "Jan 2025 → Aug 2026 monthly averages" — the gas layer's common window (map-metrics gasWindow). */
export function gasWindowText(m: MapMetrics | null | undefined): string | null {
  const w = m?.gasWindow
  return w ? `${fmtMonthYear(w.from)} → ${fmtMonthYear(w.to)} monthly averages` : null
}

/** "12 mo to Jul 2026 vs yr centered on Jan '25" — the electricity layer's window. */
export function elecWindowText(asOf: string | null | undefined): string {
  return `12-mo avg${asOf ? ` to ${fmtMonthYear(asOf)}` : ''} vs ${ELECTRICITY_BASELINE_SHORT}`
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
      value: e.pct, text: `${fmtPct(e.pct)} 12-mo avg vs ${ELECTRICITY_BASELINE_SHORT}`, area: `${e.label} statewide`,
      detail: `12-mo avg ${e.cents.toFixed(1)}¢/kWh, 12 months to ${fmtMonthYear(e.asOf)} · EIA${e.stale ? STALE_COPY : ''}`, asOf: e.asOf,
      source: 'EIA', when: elecWindowText(e.asOf), ...(e.stale ? { stale: true as const } : {}),
    }
  }
  const row = m.counties?.[fips]
  if (!row) return null
  if (key === 'gas') {
    const g = m.gas?.[row[0]]
    if (!g || g.change == null || g.current == null) return null
    const source = g.source === 'dcra' ? 'Alaska DCRA' : g.source === 'daco' ? 'PR DACO' : g.source === 'bls' ? 'BLS' : 'EIA'
    const flags = {
      ...(g.stale ? { stale: true as const } : {}),
      ...(g.standIn ? { standIn: true as const } : {}),
      ...(g.source === 'dcra' ? { survey: true as const } : {}),
      kind: gasAreaKind(g),
      ...((t) => (t ? { kindText: t } : {}))(gasKindText(g, gasAreaStateCounts(m).get(row[0]), gasAreaOutside(m, row[0]))),
    }
    const area = g.standIn ? `${g.label} (no series for this county)` : g.label
    if (g.window !== 'own' && g.asOf && m.gasWindow) {
      // The layer's common window: Jan 2025 → the common month, monthly averages (EIA weeklies averaged by month)
      const how = g.source === 'eia' ? 'EIA weekly prices averaged by month' : g.source === 'bls' ? 'BLS monthly' : 'Puerto Rico DACO monthly'
      const window = `${fmtMonthYear(g.baselineAsOf ?? m.gasWindow.from)} → ${fmtMonthYear(g.asOf)} monthly averages`
      return {
        value: g.change, text: `${fmtSignedDollars(g.change)}/gal, ${window}`, area,
        detail: `${fmtMonthYear(g.asOf)} avg $${g.current.toFixed(2)}/gal · ${how}${g.stale ? STALE_COPY : ''}`,
        asOf: g.asOf, source, when: window, ...flags,
      }
    }
    // Its own window (as on the card): Alaska's twice-yearly survey, or a series behind the common month. An older
    // payload (CDN-cached before round 16) has no `window` / `gasWindow`: its values are the card's own latest
    // figures, drawn plainly (unknown window, not patterned), never all marked "own window"
    const legacy = g.window === undefined
    const at = (d: string | null | undefined) => (!d ? '' : g.frequency === 'weekly'
      ? `week of ${fmtDay(d)}`
      : g.frequency === 'semiannual' ? `${fmtMonthYear(d)} survey` : fmtMonthYear(d))
    const window = g.frequency === 'semiannual'
      ? `${fmtMonthYear(g.baselineAsOf ?? BASELINE_MONTH)} → ${fmtMonthYear(g.asOf)} surveys`
      : `${at(g.baselineAsOf) || fmtMonthYear(BASELINE_MONTH)} → ${at(g.asOf)}`
    const how = g.source === 'dcra' ? 'Alaska DCRA survey (twice yearly)' : g.source === 'daco' ? 'Puerto Rico DACO monthly' : g.source === 'bls' ? 'BLS monthly' : 'EIA weekly'
    return {
      value: g.change, text: `${fmtSignedDollars(g.change)}/gal, ${window}`, area,
      detail: `$${g.current.toFixed(2)}/gal · ${how}${g.asOf ? `, ${at(g.asOf)}` : ''}${g.stale ? STALE_COPY : ''}`,
      asOf: g.asOf, source, ...(legacy ? {} : { ownWindow: true as const }), ...flags,
      when: legacy ? window : g.source === 'dcra' ? `${window} (survey months, not monthly averages)` : `${window} (own window, not the map's common month)`,
    }
  }
  const c = m.groceries?.[row[1]]
  if (!c || c.pct == null) return null
  return {
    value: c.pct, text: `${fmtPct(c.pct)} ${sinceBaseline(null)}`, area: c.label,
    detail: `BLS CPI food at home${c.asOf ? `, ${fmtMonthYear(c.asOf)}` : ''}${c.stale ? STALE_COPY : ''}`, asOf: c.asOf,
    source: 'BLS CPI', when: `${fmtMonthYear(BASELINE_MONTH)} → ${fmtMonthYear(c.asOf)}`, ...(c.stale ? { stale: true as const } : {}),
  }
}

/** Latest as-of among a live metric's areas ("YYYY-MM[-DD]"), for the footer. */
export function liveAsOf(m: MapMetrics | null | undefined, key: LiveMetricKey): string | null {
  if (!m) return null
  if (key === 'gas' && m.gasWindow) return m.gasWindow.to
  const dates = key === 'elec'
    ? Object.values(m.electricity ?? {}).map(e => e.asOf)
    : key === 'gas' ? (m.gas ?? []).map(g => g.asOf) : (m.groceries ?? []).map(c => c.asOf)
  return dates.filter((d): d is string => !!d).sort().pop() ?? null
}

/**
 * Footer for a live metric: source · geography · window · as-of · adjustment. Gas is short (source · area kinds · window ·
 * as-of · adjustment): its legend names the published areas, its tooltip the area, source and months of each one, and the About
 * page's methods the rest (EIA weeklies averaged by month, the Gas card's latest week, HI/AK stand-ins).
 */
export function liveFooter(key: LiveMetricKey, m: MapMetrics | null | undefined): string {
  const asOf = liveAsOf(m, key)
  const latest = asOf ? `latest ${asOf.length > 7 ? fmtDay(asOf) : fmtMonthYear(asOf)}` : 'not loaded'
  if (key === 'gas') {
    const w = gasWindowText(m)
    return `EIA weekly / BLS monthly regular gas · metro, state or region (see legend) · ${w ?? `${sinceBaseline(null)} · ${latest}`} · not seasonally adjusted`
  }
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
 * No-data fill (every map layer): a quiet solid neutral gray, hueless and lighter than any near-zero color (the scale's
 * midpoint is near-black), so a missing county never reads as a ~0% change.
 */
export const NO_DATA_COLOR = '#5f6268'

/** "HUD fair market rent (yearly estimate, FY2025→FY2027)" from the build's meta (fiscal years come from the data). */
export function hudRentLabel(meta: LocalMeta | null | undefined): string {
  return meta?.sources?.hudFmr?.label ?? 'HUD fair market rent (yearly estimate)'
}

/** HUD fiscal-year window from the build's meta: "FY2025→FY2027", and when the latest year starts ("Oct 2026"). */
export function hudWindow(meta: LocalMeta | null | undefined): { window: string; latestStarts: string | null } {
  const s = meta?.sources?.hudFmr as (SourceMeta & { base?: string }) | undefined
  const y = Number(/^FY(\d{4})$/.exec(s?.latest ?? '')?.[1])
  return {
    window: s?.base && s?.latest ? `${s.base}→${s.latest}` : 'between fiscal years',
    // a federal fiscal year starts in October of the previous calendar year
    latestStarts: Number.isFinite(y) ? fmtMonthYear(`${y - 1}-10`) : null,
  }
}

/**
 * The map panel's provenance for a HUD-tier county (geography, window, projection, adjustment), from meta. HUD's
 * figure is shown here and in the tooltip only, never as a map color: a yearly projected estimate, not a market-rent index.
 */
export function hudPanelArea(meta: LocalMeta | null | undefined): string {
  const { window, latestStarts } = hudWindow(meta)
  const latest = window.split('→')[1]
  return `${hudRentLabel(meta)} · HUD fair market rent area covering this county (its metro FMR area, or the county itself if non-metro) · ` +
    `${window}, not since ${fmtMonthYear(BASELINE_MONTH)}; both years are HUD projections from older survey data${latest && latestStarts ? ` (${latest} starts ${latestStarts})` : ''} · ` +
    'yearly, not seasonally adjusted · a yearly projected estimate, not a market-rent index; no usable Zillow rent for this county, so it is gray on the map (the Rent card uses CPI shelter)'
}
export function divergingColor(v: number | undefined, clamp: number): string {
  if (v == null || !Number.isFinite(v)) return NO_DATA_COLOR
  const t = Math.max(-1, Math.min(1, v / clamp))
  const a = Math.pow(Math.abs(t), 0.7)
  const end = t < 0 ? NEG : POS
  const c = MID.map((m, i) => Math.round(m + (end[i] - m) * a))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/**
 * Map color scale, derived from the counties' values so the layer never saturates for most counties:
 *   diverging  — symmetric around 0 (blue fell, orange rose), ±clamp = the SCALE_PCTL quantile of |value| rounded
 *                UP to a nice step (so ≥ 95% of counties sit inside it);
 *   sequential — every county (2nd–98th percentile) moved the same way: lo..hi rounded outward to a nice step, dim
 *                = smallest change, bright = largest (gas: a diverging scale around 0 painted every county "rose");
 *                any value on the other side of zero takes oppositeColor.
 */
export type MapScale =
  | { kind: 'diverging'; clamp: number }
  | { kind: 'sequential'; lo: number; hi: number }

export const SCALE_PCTL = 0.95
const SEQ_LO_PCTL = 0.02
const SEQ_HI_PCTL = 0.98
const PCT_STEPS = [1, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50]
const USD_STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}
const niceCeil = (v: number, steps: number[]) => steps.find((s) => s >= v - 1e-9) ?? steps[steps.length - 1]

/** The map's color scale for these county values (one per county; non-finite ignored). */
export function mapScaleFor(values: Iterable<number | undefined>, unit: 'usd' | 'pct', fallbackClamp: number, sequential = false): MapScale {
  const v = [...values].filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length < 2) return { kind: 'diverging', clamp: fallbackClamp }
  const steps = unit === 'usd' ? USD_STEPS : PCT_STEPS
  if (sequential) {
    const qlo = quantile(v, SEQ_LO_PCTL)
    const qhi = quantile(v, SEQ_HI_PCTL)
    if (qlo >= 0 || qhi <= 0) {
      const step = unit === 'usd' ? 0.05 : 0.5
      let lo = Math.floor(qlo / step + 1e-9) * step
      let hi = Math.ceil(qhi / step - 1e-9) * step
      if (hi - lo < 2 * step) { lo -= step; hi += step }
      if (qlo >= 0) lo = Math.max(0, lo)
      else hi = Math.min(0, hi)
      return { kind: 'sequential', lo: Number(lo.toFixed(2)), hi: Number(hi.toFixed(2)) }
    }
  }
  const abs = v.map(Math.abs).sort((a, b) => a - b)
  return { kind: 'diverging', clamp: niceCeil(quantile(abs, SCALE_PCTL), steps) }
}

/**
 * Sequential scale: the distinct hue for a value on the other side of zero (a fall on a "rose" scale, and vice versa).
 * With `v`, its shade scales with the size of the move, like the main side (a $0.10 fall on a +$0.05…+$1.35 scale is a
 * dim blue, not the brightest one); without `v`, the full end color (legend swatch end).
 */
export function oppositeColor(scale: MapScale, v?: number): string | null {
  if (scale.kind !== 'sequential') return null
  const end = scale.hi > 0 ? NEG : POS
  if (v === undefined || !Number.isFinite(v)) return `rgb(${end[0]},${end[1]},${end[2]})`
  const reach = Math.max(Math.abs(scale.lo), Math.abs(scale.hi)) || 1
  const t = Math.max(0, Math.min(1, Math.abs(v) / reach))
  // never as dim as the main side's floor: the other hue must stay readable
  const a = OPPOSITE_MIN + (1 - OPPOSITE_MIN) * t
  const c = MID.map((m, i) => Math.round(m + (end[i] - m) * a))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
/** Dimmest opposite-side shade (fraction of the way from the charcoal midpoint to the end color). */
export const OPPOSITE_MIN = 0.4

/** Sequential scale: is `v` on the other side of zero from the scale (drawn in oppositeColor)? */
export function isOppositeSide(v: number | undefined, scale: MapScale): boolean {
  if (scale.kind !== 'sequential' || v == null || !Number.isFinite(v)) return false
  return scale.hi > 0 ? v < 0 : v > 0
}

/** Fill color for a value on a map scale. */
export function scaleColor(v: number | undefined, scale: MapScale): string {
  if (scale.kind === 'diverging') return divergingColor(v, scale.clamp)
  if (v == null || !Number.isFinite(v)) return NO_DATA_COLOR
  // Never clamp a fall into the dimmest "rose" color (or a rise into "fell"): its own distinct color
  if (isOppositeSide(v, scale)) return oppositeColor(scale, v)!
  const rose = scale.hi > 0
  const span = scale.hi - scale.lo || 1
  // Rising: lo dim → hi bright; falling: hi (smallest drop) dim → lo (biggest drop) bright
  const t = Math.max(0, Math.min(1, rose ? (v - scale.lo) / span : (scale.hi - v) / span))
  return rampColor(rose ? SEQ_RISE_RAMP : SEQ_FALL_RAMP, t)
}

/**
 * Sequential ramps (gas): three stops, luminance rising with the change ("brighter = rose more"). The low end is a
 * clear amber, well off the page background and hue-distinct from the gray no-data fill (it used to start a fifth of
 * the way from the charcoal midpoint, so the smallest rises nearly vanished into the background).
 */
export const SEQ_RISE_RAMP: ReadonlyArray<readonly [number, number, number]> = [[186, 110, 44], [240, 146, 48], [255, 214, 128]]
const SEQ_FALL_RAMP: ReadonlyArray<readonly [number, number, number]> = [[60, 110, 175], [74, 144, 217], [170, 205, 245]]

function rampColor(ramp: ReadonlyArray<readonly [number, number, number]>, t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(x))
  const f = x - i
  const c = ramp[i].map((a, k) => Math.round(a + (ramp[i + 1][k] - a) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** [r, g, b] from `rgb(r,g,b)` or `#rrggbb`; null otherwise. */
export function parseColor(color: string): [number, number, number] | null {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  return h ? [parseInt(h[1], 16), parseInt(h[2], 16), parseInt(h[3], 16)] : null
}

/**
 * The sequential legend's claim: "every county rose" only when no drawn value is below zero (≥ 0), else "nearly every
 * county rose" (mirror for falls); null for a diverging scale.
 */
export function sequentialClaim(values: Iterable<number | undefined>, scale: MapScale): string | null {
  if (scale.kind !== 'sequential') return null
  const rose = scale.hi > 0
  let opposite = false
  for (const v of values) if (isOppositeSide(v, scale)) { opposite = true; break }
  return `${opposite ? 'nearly every' : 'every'} county ${rose ? 'rose' : 'fell'}; brighter = ${rose ? 'rose' : 'fell'} more`
}

/** "+$0.85" / "+12%" — a scale end value. */
export function fmtScaleValue(v: number, unit: 'usd' | 'pct'): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return unit === 'usd' ? `${sign}$${Math.abs(v).toFixed(2)}` : `${sign}${Math.abs(v)}%`
}

/** The legend's scale text: "±10%, set so 95% of counties fall inside; …" / "+$0.85 to +$1.35/gal (2nd–98th percentile)". */
export function scaleText(scale: MapScale, unit: 'usd' | 'pct'): string {
  const u = unit === 'usd' ? '/gal' : ''
  if (scale.kind === 'diverging') {
    return `±${unit === 'usd' ? `$${scale.clamp.toFixed(2)}` : `${scale.clamp}%`}${u}, set so 95% of counties fall inside; larger changes take the end color`
  }
  return `${fmtScaleValue(scale.lo, unit)} to ${fmtScaleValue(scale.hi, unit)}${u} (2nd–98th percentile)`
}

/** Months the county time-lapse rows for `metric` are aligned to (rent may cover different months). */
export function timelineMonths(t: { months: string[]; rentMonths?: string[] }, metric: string): string[] {
  return metric === 'rent' && t.rentMonths?.length ? t.rentMonths : t.months
}

/**
 * The selected zip's own county in the map panel shows the card's figure where the card uses something the
 * county-wide map value can't: Alaska's per-zip DCRA survey community (the map colors a borough by the median
 * of its surveyed communities) and a metro or city rent series standing in for a county with no Zillow county series.
 */
export interface ZipPanelOverrides {
  gas?: { text: string; area: string; detail: string }
  rent?: { text: string; area: string; seasonal?: string }
}

/** Why the county's own Zillow series isn't on the panel (same reasons as the card), short form. */
function metroStandInWhy(r: NonNullable<EconomicSnapshot['rent']>): string {
  const county = (r.countyName ?? '').replace(/,\s*[A-Z]{2}$/, '').trim() || 'this county'
  if (r.countyWhy === 'not-current') return notCurrentText(county, r.countyNotCurrent)
  if (r.countyWhy === 'too-new') return `Zillow's series for ${county} is too new to measure ${sinceBaseline(null)}`
  if (r.countyWhy === 'no-baseline') return `Zillow's series for ${county} has no ${fmtMonthYear(BASELINE_MONTH)} value`
  return 'no usable Zillow county series'
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
  if (r && r.level === 'city' && Number.isFinite(r.pct)) {
    out.rent = {
      text: `${fmtPct(r.pct)} ${sinceBaseline(null)} · typical asking rent $${Math.round(r.curRent).toLocaleString('en-US')}/mo`,
      area: `${r.cityName ? `${r.cityName} area` : r.geoName} rent (Zillow city series) · ${metroStandInWhy(r)}, and there is no usable metro series; the county’s most populous place with a Zillow series is used`,
    }
    const seasonal = rentSeasonalCaveat(r.saCaveat, 'city', r)
    if (seasonal) out.rent.seasonal = seasonal
  }
  if (r && r.level === 'metro' && Number.isFinite(r.pct)) {
    out.rent = {
      text: `${fmtPct(r.pct)} ${sinceBaseline(null)} · typical asking rent $${Math.round(r.curRent).toLocaleString('en-US')}/mo`,
      // No outer parentheses: the reason can carry its own ("… too new to use (only one month, Jul 2026)")
      area: `${r.geoName} · ${metroStandInWhy(r)}; the metro's is used`,
    }
    const seasonal = rentSeasonalCaveat(r.saCaveat, 'metro', r)
    if (seasonal) out.rent.seasonal = seasonal
  }
  return out
}
