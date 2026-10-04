// Gas prices for places EIA and BLS don't price, bundled by scripts/build-local-data.py (server-side only):
//
//  - Alaska outside the Anchorage CBSA: the Alaska DCRA Community Fuel Price Survey (src/lib/data/ak-gas.json),
//    twice a year (January and July) for ~100 communities, CC BY 4.0. Each zip maps to its own surveyed
//    community, else the nearest surveyed community in the same borough / census area (≤ 100 km), else the DCRA
//    region average — always labeled which.
//  - Puerto Rico: DACO's monthly island-wide average retail price of regular gasoline (src/lib/data/pr-gas.json).
//
// Baseline and current always come from the same series (Jan 2025 survey / month → latest). Neither source
// publishes a U.S. figure, so there is no national comparison (never another source's U.S. average).

import akGas from '@/lib/data/ak-gas.json'
import prGas from '@/lib/data/pr-gas.json'
import type { GasLookupResult, GasSeriesData } from '@/lib/api/eia'
import { BASELINE_MONTH } from '@/lib/baseline'
import { lookupZip } from '@/lib/data/zip-lookup'

export * from './static-gas-meta'

/** $/gal sanity range for these series (remote Alaska villages pay well over $10). */
export const STATIC_GAS_RANGE = { dcra: [1, 20], daco: [1, 10] } as const

interface Series { v: Array<number | null> }
interface AkFile {
  meta: { latestSurvey: string; baseSurvey: string; start: string; url: string }
  communities: Record<string, Series & { b: string; r: string }>
  regions: Record<string, Series>
  zips: Record<string, { k: 'c' | 'n'; c: string; km?: number } | { k: 'r'; r: string }>
}
interface PrFile { meta: { asOf: string; start: string; url: string; baseMonth: string }; v: Array<number | null> }

const AK = akGas as unknown as AkFile
const PR = prGas as unknown as PrFile

/** YYYY-01 / YYYY-07 survey months from `start`, one per value. */
function semiannualDates(start: string, n: number): string[] {
  const out: string[] = []
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${m === 1 ? '01' : '07'}`)
    if (m === 1) m = 7
    else { y++; m = 1 }
  }
  return out
}

function monthlyDates(start: string, n: number): string[] {
  const out: string[] = []
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { y++; m = 1 }
  }
  return out
}

const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** Series → GasSeriesData (baseline = the base month's value, current = the last value; both required). */
function toSeries(values: Array<number | null>, dates: string[], base: string, regionName: string,
  range: readonly [number, number]): GasSeriesData | null {
  const pts = dates.map((date, i) => ({ date, price: values[i] })).filter((p): p is { date: string; price: number } => inRange(p.price, range))
  const b = pts.find((p) => p.date === base)
  const latest = pts[pts.length - 1]
  if (!b || !latest || latest.date !== dates[dates.length - 1]) return null
  const unpublished = dates.filter((d, i) => d > pts[0].date && d < latest.date && !inRange(values[i], range))
  return {
    current: latest.price,
    latestDate: latest.date,
    baseline: b.price,
    baselineDate: b.date,
    change: Number((latest.price - b.price).toFixed(3)),
    series: pts,
    regionName,
    ...(unpublished.length ? { unpublished } : {}),
  }
}

export interface StaticGasHit {
  data: GasSeriesData
  lookup: GasLookupResult
  match?: 'community' | 'nearest' | 'region'
  /** Community or region name. */
  place: string
  km?: number
}

export type StaticGasLookup = { hit: StaticGasHit } | { hit: null; why: 'no-zip' | 'no-series' }

/** Alaska zip → its DCRA survey series (own community, nearest surveyed community, or region average). */
export function lookupAkGas(zip: string | null | undefined): StaticGasLookup {
  const m = zip ? AK.zips?.[zip] : undefined
  if (!m) return { hit: null, why: 'no-zip' }
  const dates = (n: number) => semiannualDates(AK.meta.start, n)
  if (m.k === 'r') {
    const r = AK.regions[m.r]
    const data = r && toSeries(r.v, dates(r.v.length), AK.meta.baseSurvey, `${m.r} region`, STATIC_GAS_RANGE.dcra)
    if (!data) return { hit: null, why: 'no-series' }
    return {
      hit: {
        data, match: 'region', place: m.r,
        lookup: dcraLookup(`region:${m.r}`, `DCRA ${m.r} region average`, `${m.r} Alaska region avg (DCRA survey)`, 3),
      },
    }
  }
  const c = AK.communities[m.c]
  const data = c && toSeries(c.v, dates(c.v.length), AK.meta.baseSurvey, m.c, STATIC_GAS_RANGE.dcra)
  if (!data) return { hit: null, why: 'no-series' }
  const nearest = m.k === 'n'
  return {
    hit: {
      data, match: nearest ? 'nearest' : 'community', place: m.c, ...(nearest && typeof m.km === 'number' ? { km: m.km } : {}),
      lookup: dcraLookup(m.c, `DCRA survey: ${m.c}`, nearest ? `${m.c} survey price (nearest surveyed community)` : `${m.c} survey price`, 1),
    },
  }
}

/**
 * The county map's Alaska gas value for a borough / census area (outside the Anchorage CBSA), following the
 * same ladder as the card, applied to the county's zips: the surveyed communities its zips resolve to (own or
 * nearest community) — one community → that community's series (exactly the card's figure); several → the
 * survey-by-survey median of those communities' prices (labeled "median of N surveyed communities") — else the
 * DCRA region average its zips fall back to. null when no zip in the county has a DCRA series (the map then
 * keeps the Anchorage stand-in, labeled as such).
 */
export interface AkCountyGas {
  data: GasSeriesData
  match: 'community' | 'median' | 'region'
  /** "Bethel survey price (Alaska DCRA)", "Bethel Census Area: median of 12 surveyed communities (Alaska DCRA)". */
  label: string
  /** Communities (or the one region) behind the value. */
  places: string[]
}

let akByCounty: Map<string, Array<{ k: 'c' | 'n'; c: string } | { k: 'r'; r: string }>> | null = null
function akZipsByCounty() {
  if (akByCounty) return akByCounty
  akByCounty = new Map()
  for (const [zip, m] of Object.entries(AK.zips ?? {})) {
    const f = lookupZip(zip)?.countyFips
    if (!f) continue
    const list = akByCounty.get(f) ?? []
    list.push(m)
    akByCounty.set(f, list)
  }
  return akByCounty
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Number(((s[mid - 1] + s[mid]) / 2).toFixed(3))
}

export function akGasForCounty(countyFips: string, countyName?: string): AkCountyGas | null {
  const zips = akZipsByCounty().get(countyFips)
  if (!zips?.length) return null
  const dates = (n: number) => semiannualDates(AK.meta.start, n)
  const communities = [...new Set(zips.flatMap((m) => (m.k === 'r' ? [] : [m.c])))].filter((c) => AK.communities[c]).sort()
  if (communities.length === 1) {
    const c = communities[0]
    const v = AK.communities[c].v
    const data = toSeries(v, dates(v.length), AK.meta.baseSurvey, c, STATIC_GAS_RANGE.dcra)
    if (data) return { data, match: 'community', label: `${c} survey price (Alaska DCRA)`, places: [c] }
  } else if (communities.length > 1) {
    const n = Math.max(...communities.map((c) => AK.communities[c].v.length))
    const v = Array.from({ length: n }, (_, i) => {
      const xs = communities.map((c) => AK.communities[c].v[i]).filter((x): x is number => inRange(x, STATIC_GAS_RANGE.dcra))
      return xs.length ? median(xs) : null
    })
    const where = countyName ?? 'This area'
    const data = toSeries(v, dates(n), AK.meta.baseSurvey, `${where} (median of ${communities.length} surveyed communities)`, STATIC_GAS_RANGE.dcra)
    if (data) {
      return { data, match: 'median', label: `${where}: median of ${communities.length} surveyed communities (Alaska DCRA)`, places: communities }
    }
  }
  // No usable community: the region average the county's zips fall back to (most zips' region if several)
  const counts = new Map<string, number>()
  for (const m of zips) if (m.k === 'r') counts.set(m.r, (counts.get(m.r) ?? 0) + 1)
  const region = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
  const r = region ? AK.regions[region] : undefined
  const data = r && toSeries(r.v, dates(r.v.length), AK.meta.baseSurvey, `${region} region`, STATIC_GAS_RANGE.dcra)
  return data ? { data, match: 'region', label: `${region} Alaska region avg (DCRA survey)`, places: [region!] } : null
}

function dcraLookup(area: string, seriesId: string, geoLevel: string, tier: 1 | 3): GasLookupResult {
  return { source: 'dcra', frequency: 'semiannual', areaCode: area, seriesId, geoLevel, tier, cacheKey: `static:dcra:${area}` }
}

/** Puerto Rico's DACO island-wide monthly series. */
export function lookupPrGas(): StaticGasLookup {
  const data = toSeries(PR.v, monthlyDates(PR.meta.start, PR.v.length), BASELINE_MONTH, 'Puerto Rico', STATIC_GAS_RANGE.daco)
  if (!data) return { hit: null, why: 'no-series' }
  return {
    hit: {
      data, place: 'Puerto Rico',
      lookup: {
        source: 'daco', frequency: 'monthly', areaCode: 'PR', seriesId: 'DACO: regular gasoline, island-wide average',
        geoLevel: 'Puerto Rico island-wide avg (DACO)', tier: 2, cacheKey: 'static:daco:PR',
      },
    },
  }
}
