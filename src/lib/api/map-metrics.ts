// County map "live" metrics (Gas, Groceries, Electricity), built by READING the cache only.
//
// These prices are published for metros, regions or states, not counties, so every county
// takes the value of the series the zip lookups assign it (src/lib/data/county-geo.json, built
// from the same lookup functions the snapshot uses). The endpoint never calls BLS/EIA and never
// spends the runtime upstream budget: a key missing from the cache (and its :lastgood copy) is
// simply "no data" on the map until the next refresh writes it. Exception: Alaska boroughs outside the
// Anchorage CBSA take the bundled DCRA community-survey value (src/lib/static-gas.ts akGasForCounty), the
// same series the gas card's ladder uses there, instead of the Anchorage stand-in; Puerto Rico takes the bundled
// DACO island-wide series (src/lib/static-gas.ts lookupPrGas), as the card does, instead of the U.S. average.
//
// Gas compares like with like (round 16): weekly EIA, monthly BLS and DACO prices all on ONE window — the monthly average
// of a common latest month (the latest month every BLS and EIA series on the map has; EIA weeklies averaged by calendar
// month, a month counted once complete) minus the Jan 2025 monthly average — so timing gaps between sources never read as
// local differences. Computed from the same cached series (no extra keys, nothing fetched). Areas that can't be put on
// that window (the DCRA survey, a series lagging the rest) keep their own window, marked `window: 'own'` (patterned on
// the map, with their months in the tooltip). The gas CARD keeps its own latest figure.
//
// A value read from a `:lastgood` copy (the fresh key expired) is marked `stale` and counted in `stale`, so the
// route serves it with a short CDN lifetime. buildMapMetricsMemo keeps one in-process copy for 60 s so repeated
// requests (CDN misses) cost ~250 Redis reads at most once a minute per instance.

import countyGeoJson from '@/lib/data/county-geo.json'
import { getCachedEnvelope, lastGoodKey } from '@/lib/cache/kv'
import type { CpiData } from '@/types'
import { cpiCacheKey } from './bls-cpi'
import { describeDuoarea, type GasSeriesData, type GasLookupResult } from './eia'
import { describeBlsGasArea } from './bls-gas'
import { electricityCacheKey, ELECTRICITY_STATES, type ElectricitySeriesData } from './eia-electricity'
import { isValidCpi, isValidGasSeries, isValidElectricity } from './validate'
import { CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES } from '@/lib/mappings/eia-gas'
import { cpiShortGeo } from '@/lib/hero-cards'
import { akGasForCounty, lookupPrGas } from '@/lib/static-gas'
import { staticGasStatus } from '@/lib/static-gas-meta'
import { BASELINE_MONTH, addMonths, displayedChange } from '@/lib/baseline'
import { GAS_PRICE_RANGE } from './validate'
import countyCentroids from '@/lib/data/county-centroids.json'

interface CountyGeo {
  state: string
  cpiArea: string
  cpiTier: 1 | 2 | 3 | 4
  cpiName: string
  gasSource: 'eia' | 'bls'
  gasDuoarea: string
  gasTier: 1 | 2 | 3
}
const COUNTY_GEO = countyGeoJson as unknown as Record<string, CountyGeo>
const COUNTY_NAMES = countyCentroids as unknown as Record<string, { name?: string } | undefined>

export interface MapGasArea {
  /**
   * "e:R1X" (EIA duoarea), "b:S35C" (BLS area; "*" suffix = HI/AK stand-in for a county with no series), or
   * "d:02050" (an Alaska borough / census area priced from the DCRA community fuel survey, bundled, never cached).
   */
  id: string
  label: string
  source: 'eia' | 'bls' | 'dcra' | 'daco'
  frequency: 'weekly' | 'monthly' | 'semiannual'
  standIn?: true
  /**
   * Served from the last-good copy (the fresh cache entry expired), or a bundled DCRA / DACO value whose survey /
   * month is overdue (staticGasStatus — the card marks the same value stale).
   */
  stale?: true
  /**
   * `window: 'common'`: $/gal change from the Jan 2025 monthly average to the common month's average (MapMetrics.gasWindow),
   * `current` = that month's average and `asOf` = that month (YYYY-MM). `window: 'own'` (DCRA survey; a series that
   * lags the common month): the series' own baseline → latest, as on the card (`baselineAsOf` → `asOf`). null = not cached.
   */
  change: number | null
  current: number | null
  asOf: string | null
  baselineAsOf?: string | null
  window?: 'common' | 'own'
}

/** The gas layer's common window: Jan 2025 → `to` monthly averages (null when no BLS / EIA series is cached). */
export interface MapGasWindow { from: string; to: string }

export interface MapCpiArea {
  area: string
  label: string
  /** CPI food at home % change since its baseline month (same as the groceries card); null = not cached. */
  pct: number | null
  asOf: string | null
  stale?: true
}

export interface MapElectricity {
  label: string
  /** % change of the 12-month average price vs the 12 months centered on Jan 2025 (same as the electricity card) and that average price. */
  pct: number
  cents: number
  asOf: string
  stale?: true
}

export interface MapMetrics {
  gas: MapGasArea[]
  gasWindow: MapGasWindow | null
  groceries: MapCpiArea[]
  /** By state (USPS code); states not cached are absent. */
  electricity: Record<string, MapElectricity>
  /**
   * County FIPS → [index into gas, index into groceries]; -1 = the county has no regional series of its own (only
   * the U.S. average: territories' national CPI / NUS gas), drawn as no data — the map never paints a national
   * stand-in. The state is the FIPS prefix.
   */
  counties: Record<string, [number, number]>
  /** Cache keys with no usable cached copy (the map shows those areas as no data). */
  missing: number
  /** Cache keys served from their last-good copy (marked `stale` on the area). */
  stale: number
}

/** EIA city labels ("Boston area avg") from the mapping tables; states/PADDs are labeled by describeDuoarea. */
function eiaCityLabel(duoarea: string): string | undefined {
  for (const t of [CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES]) {
    const hit = Object.values(t).find((v) => v.duoarea === duoarea)
    if (hit) return hit.label
  }
  return undefined
}

function gasLookupFor(g: CountyGeo): { id: string; lookup: GasLookupResult } {
  if (g.gasSource === 'bls') {
    // Tier 2 BLS = a HI/AK county outside the Honolulu/Anchorage CBSA showing that metro's series
    const standIn = g.gasTier === 2
    return { id: `b:${g.gasDuoarea}${standIn ? '*' : ''}`, lookup: describeBlsGasArea(g.gasDuoarea, { standIn }) }
  }
  return { id: `e:${g.gasDuoarea}`, lookup: describeDuoarea(g.gasDuoarea, eiaCityLabel(g.gasDuoarea)) }
}

/** The cached copy of a key, else its last-good copy (`stale`); never fetches. Errors / invalid data → null. */
export async function readCacheOnly<T>(key: string, validate: (d: T) => boolean): Promise<{ data: T; stale: boolean } | null> {
  for (const k of [key, lastGoodKey(key)]) {
    try {
      const env = await getCachedEnvelope<T>(k)
      if (env && validate(env.data)) return { data: env.data, stale: k !== key }
    } catch {
      // Redis error or cool-down: treat as not cached (the map shows no data; nothing is fetched)
    }
  }
  return null
}

const MEMO_MS = 60_000
let memo: { at: number; body: MapMetrics } | null = null
let inflight: Promise<MapMetrics> | null = null

/** buildMapMetrics, memoized in-process for 60 s (one build at a time). */
export async function buildMapMetricsMemo(now = Date.now()): Promise<MapMetrics> {
  if (memo && now - memo.at < MEMO_MS) return memo.body
  if (!inflight) {
    inflight = buildMapMetrics()
      .then((body) => {
        memo = { at: Date.now(), body }
        return body
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** Tests only. */
export function resetMapMetricsMemo(): void {
  memo = null
  inflight = null
}

/** A series lagging the newest by more than this many months doesn't hold the common gas month back (drawn on its own window). */
export const GAS_COMMON_MAX_LAG = 2

/**
 * Monthly average $/gal by calendar month (YYYY-MM) of a gas series: monthly points as published (BLS, DACO); weekly
 * EIA readings (YYYY-MM-DD) averaged by month, the latest month only once complete (a reading in a later month, or its
 * last reading falls in the month's final week). Out-of-range averages are dropped.
 */
export function gasMonthlyAverages(series: ReadonlyArray<{ date: string; price: number }>): Map<string, number> {
  const out = new Map<string, number>()
  if (!series.length) return out
  if (series[0].date.length === 7) {
    for (const p of series) if (Number.isFinite(p.price)) out.set(p.date, p.price)
  } else {
    const sums = new Map<string, { s: number; n: number }>()
    for (const p of series) {
      if (!Number.isFinite(p.price)) continue
      const m = p.date.slice(0, 7)
      const a = sums.get(m) ?? { s: 0, n: 0 }
      a.s += p.price
      a.n++
      sums.set(m, a)
    }
    const lastDate = series.reduce((d, p) => (p.date > d ? p.date : d), '')
    const lastMonth = lastDate.slice(0, 7)
    const t = Date.parse(`${lastDate}T00:00:00Z`) + 7 * 86_400_000
    const lastComplete = Number.isFinite(t) && new Date(t).toISOString().slice(0, 7) !== lastMonth
    for (const [m, a] of sums) {
      if (m === lastMonth && !lastComplete) continue
      out.set(m, Number((a.s / a.n).toFixed(3)))
    }
  }
  for (const [m, v] of out) if (!(v >= GAS_PRICE_RANGE[0] && v <= GAS_PRICE_RANGE[1])) out.delete(m)
  return out
}

/** The common month: the earliest of the series' latest months, ignoring series > GAS_COMMON_MAX_LAG behind the newest. */
export function commonGasMonth(latestMonths: ReadonlyArray<string | undefined>): string | null {
  const ms = latestMonths.filter((m): m is string => !!m).sort()
  if (!ms.length) return null
  const floor = addMonths(ms[ms.length - 1], -GAS_COMMON_MAX_LAG)
  return ms.find((m) => m >= floor) ?? null
}

/** The area on the common window (Jan 2025 → `month` averages), or null when either month is missing. */
function onCommonWindow(avg: Map<string, number> | undefined, month: string | null) {
  const b = avg?.get(BASELINE_MONTH)
  const c = month ? avg?.get(month) : undefined
  if (b == null || c == null) return null
  // Same rounding as the card (the difference of the two averages as printed, to the cent)
  return { change: displayedChange(c, b), current: c, asOf: month, baselineAsOf: BASELINE_MONTH, window: 'common' as const }
}

const latestKey = (m: Map<string, number>) => [...m.keys()].sort().pop()

/** U.S.-average series: never drawn on the map (a county with only these is no data). */
const NATIONAL_GAS = 'NUS'
const NATIONAL_CPI = '0000'

export async function buildMapMetrics(now: Date = new Date()): Promise<MapMetrics> {
  const gasIdx = new Map<string, number>()
  const gasAreas: Array<{ id: string; lookup: GasLookupResult }> = []
  const cpiIdx = new Map<string, number>()
  const cpiAreas: CountyGeo[] = []
  const counties: Record<string, [number, number]> = {}

  // Alaska outside the Anchorage CBSA: the DCRA survey value the card's ladder picks for the county's zips
  // (bundled static data, so it is always present), instead of the Anchorage stand-in
  const staticGas = new Map<string, MapGasArea>()

  // Same rule as the card's ladder (staticGasStatus): an overdue DACO month / DCRA survey is still the value shown,
  // marked stale — exactly what the gas card shows for the county's zips.
  const pr = lookupPrGas().hit
  const prAvg = pr ? gasMonthlyAverages(pr.data.series) : undefined

  for (const [fips, g] of Object.entries(COUNTY_GEO)) {
    // Puerto Rico: DACO's island-wide monthly price (the card's rung), not the U.S. average
    if (g.state === 'PR' && pr) {
      const id = 'p:PR'
      if (!staticGas.has(id)) {
        staticGas.set(id, {
          id, label: pr.lookup.geoLevel, source: 'daco', frequency: 'monthly',
          ...(staticGasStatus('daco', pr.data.latestDate, now) === 'stale' ? { stale: true as const } : {}),
          change: Number(pr.data.change.toFixed(3)), current: pr.data.current, asOf: pr.data.latestDate,
          baselineAsOf: pr.data.baselineDate, window: 'own',
        })
        gasIdx.set(id, gasAreas.length)
        gasAreas.push({ id, lookup: pr.lookup })
      }
      if (g.cpiArea !== NATIONAL_CPI && !cpiIdx.has(g.cpiArea)) {
        cpiIdx.set(g.cpiArea, cpiAreas.length)
        cpiAreas.push(g)
      }
      counties[fips] = [gasIdx.get(id)!, g.cpiArea !== NATIONAL_CPI ? cpiIdx.get(g.cpiArea)! : -1]
      continue
    }
    const ak = g.state === 'AK' && g.gasSource === 'bls' && g.gasTier === 2 ? akGasForCounty(fips, COUNTY_NAMES[fips]?.name) : null
    if (ak) {
      const id = `d:${fips}`
      staticGas.set(id, {
        id, label: ak.label, source: 'dcra', frequency: 'semiannual',
        ...(staticGasStatus('dcra', ak.data.latestDate, now) === 'stale' ? { stale: true as const } : {}),
        change: Number(ak.data.change.toFixed(3)), current: ak.data.current, asOf: ak.data.latestDate,
        baselineAsOf: ak.data.baselineDate, window: 'own',
      })
      gasIdx.set(id, gasAreas.length)
      gasAreas.push({ id, lookup: { source: 'dcra', frequency: 'semiannual', areaCode: fips, seriesId: ak.label, geoLevel: ak.label, tier: 1, cacheKey: `static:dcra:county:${fips}` } })
      if (g.cpiArea !== NATIONAL_CPI && !cpiIdx.has(g.cpiArea)) {
        cpiIdx.set(g.cpiArea, cpiAreas.length)
        cpiAreas.push(g)
      }
      counties[fips] = [gasIdx.get(id)!, g.cpiArea !== NATIONAL_CPI ? cpiIdx.get(g.cpiArea)! : -1]
      continue
    }
    // A national stand-in (NUS gas, national CPI) is a labeled card fallback, never a map color: no data
    const gas = g.gasSource === 'eia' && g.gasDuoarea === NATIONAL_GAS ? null : gasLookupFor(g)
    if (gas && !gasIdx.has(gas.id)) {
      gasIdx.set(gas.id, gasAreas.length)
      gasAreas.push(gas)
    }
    const cpiOwn = g.cpiArea !== NATIONAL_CPI
    if (cpiOwn && !cpiIdx.has(g.cpiArea)) {
      cpiIdx.set(g.cpiArea, cpiAreas.length)
      cpiAreas.push(g)
    }
    counties[fips] = [gas ? gasIdx.get(gas.id)! : -1, cpiOwn ? cpiIdx.get(g.cpiArea)! : -1]
  }

  // One read per distinct cache key (stand-in ids share their metro's key)
  const gasKeys = [...new Set(gasAreas.filter((a) => !staticGas.has(a.id)).map((a) => a.lookup.cacheKey))]
  const [gasData, cpiData, elecData] = await Promise.all([
    Promise.all(gasKeys.map((k) => readCacheOnly<GasSeriesData>(k, isValidGasSeries))),
    Promise.all(cpiAreas.map((a) => readCacheOnly<CpiData>(cpiCacheKey(a.cpiArea), isValidCpi))),
    Promise.all(ELECTRICITY_STATES.map((st) => readCacheOnly<ElectricitySeriesData>(electricityCacheKey(st), isValidElectricity))),
  ])
  const gasByKey = new Map(gasKeys.map((k, i) => [k, gasData[i]]))
  let missing = 0
  let stale = 0

  // Like-for-like gas window: monthly averages, common latest month across every cached BLS / EIA series
  const avgByKey = new Map(gasKeys.map((k) => {
    const d = gasByKey.get(k)?.data
    return [k, d ? gasMonthlyAverages(d.series) : new Map<string, number>()] as const
  }))
  const common = commonGasMonth([...avgByKey.values()].filter((m) => m.has(BASELINE_MONTH)).map(latestKey))
  const gasWindow: MapGasWindow | null = common ? { from: BASELINE_MONTH, to: common } : null

  const gas: MapGasArea[] = gasAreas.map(({ id, lookup }) => {
    const fixed = staticGas.get(id)
    if (fixed) {
      // Puerto Rico's monthly DACO series joins the common window when it has that month
      const w = fixed.source === 'daco' ? onCommonWindow(prAvg, common) : null
      return w ? { ...fixed, ...w } : fixed
    }
    const hit = gasByKey.get(lookup.cacheKey) ?? null
    const d = hit?.data ?? null
    const w = d ? onCommonWindow(avgByKey.get(lookup.cacheKey), common) : null
    return {
      id,
      label: lookup.geoLevel,
      // Cached areas are live rungs only (EIA or BLS); the static DCRA / DACO areas returned above
      source: lookup.source as MapGasArea['source'],
      frequency: lookup.frequency as MapGasArea['frequency'],
      ...(lookup.standIn ? { standIn: true as const } : {}),
      ...(hit?.stale ? { stale: true as const } : {}),
      ...(w ?? {
        // Lagging / incomplete series: its own latest window (as on the card), patterned on the map
        change: d ? Number(d.change.toFixed(3)) : null,
        current: d ? d.current : null,
        asOf: d ? d.latestDate : null,
        baselineAsOf: d ? d.baselineDate : null,
        ...(d ? { window: 'own' as const } : {}),
      }),
    }
  })
  missing += gasKeys.filter((k) => !gasByKey.get(k)).length
  stale += gasKeys.filter((k) => gasByKey.get(k)?.stale).length

  const groceries: MapCpiArea[] = cpiAreas.map((g, i) => {
    const hit = cpiData[i]
    const d = hit?.data ?? null
    if (!d) missing++
    if (hit?.stale) stale++
    return {
      ...(hit?.stale ? { stale: true as const } : {}),
      area: g.cpiArea,
      label: cpiShortGeo({ tier: g.cpiTier, metro: g.cpiName, areaCode: g.cpiArea } as CpiData) ?? g.cpiName,
      pct: d ? Number(d.groceriesChange.toFixed(2)) : null,
      asOf: d?.groceriesLatestPeriod ?? null,
    }
  })

  const electricity: Record<string, MapElectricity> = {}
  ELECTRICITY_STATES.forEach((st, i) => {
    const hit = elecData[i]
    if (!hit) {
      missing++
      return
    }
    const d = hit.data
    if (hit.stale) stale++
    electricity[st] = {
      label: st === 'DC' ? 'District of Columbia' : d.stateName, pct: d.change, cents: d.current, asOf: d.latestPeriod,
      ...(hit.stale ? { stale: true as const } : {}),
    }
  })

  return { gas, gasWindow, groceries, electricity, counties, missing, stale }
}
