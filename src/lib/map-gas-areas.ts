// Gas map layer: what kind of published area each gas series covers, derived client-side from the
// /api/map-metrics payload (area ids and labels; nothing new is sent, so older cached payloads still render).
//
// Gas prices are published for a few dozen areas, not by county:
//   city    — an EIA weekly city series ("e:YORD" Chicago) or a BLS monthly metro average price ("b:S35C" Atlanta)
//   state   — one of EIA's nine weekly state averages ("e:SOH" Ohio)
//   region  — an EIA PADD / sub-PADD average ("e:R20" Midwest) that several states share
//   standin — a HI/AK county with no series of its own, colored by the nearest metro's ("b:S49F*")
//   survey  — an Alaska borough priced from the DCRA community fuel survey ("d:02050")
//   island  — Puerto Rico's island-wide DACO series ("p:PR")

import type { MapGasArea, MapMetrics } from '@/lib/api/map-metrics'
import { STATE_FIPS_MAP } from '@/lib/mappings/state-fips'

export type GasAreaKind = 'city' | 'state' | 'region' | 'standin' | 'survey' | 'island'

/** The kind of area a gas series covers, from its id ("e:R20", "b:S35C", …), else its label (defensive); null = unknown. */
export function gasAreaKind(g: Pick<MapGasArea, 'id' | 'label' | 'source' | 'standIn'> | null | undefined): GasAreaKind | null {
  if (!g) return null
  if (g.standIn) return 'standin'
  const id = typeof g.id === 'string' ? g.id : ''
  const m = /^([ebdp]):(.+)$/.exec(id)
  if (m) {
    const [, src, code] = m
    if (src === 'd') return 'survey'
    if (src === 'p') return 'island'
    if (src === 'b') return code.endsWith('*') ? 'standin' : 'city'
    if (code === 'NUS') return null // U.S. average: never drawn as an area of its own
    if (code.startsWith('Y')) return 'city'
    if (/^S[A-Z]{2}$/.test(code)) return 'state'
    if (code.startsWith('R')) return 'region'
    return null
  }
  if (g.source === 'dcra') return 'survey'
  if (g.source === 'daco') return 'island'
  const label = g.label ?? ''
  if (/\(PADD [^)]+\)/.test(label)) return 'region'
  if (/ state avg$/.test(label)) return 'state'
  if (/ (area|metro) avg$/.test(label)) return 'city'
  return null
}

const statesMemo = new WeakMap<MapMetrics, Map<number, number>>()

/** Number of states (FIPS prefixes) whose counties take each gas area, by index into `m.gas`; once per payload. */
export function gasAreaStateCounts(m: MapMetrics): Map<number, number> {
  const hit = statesMemo.get(m)
  if (hit) return hit
  const sets = new Map<number, Set<string>>()
  for (const [fips, row] of Object.entries(m.counties ?? {})) {
    const i = row?.[0]
    if (typeof i !== 'number' || i < 0) continue
    let s = sets.get(i)
    if (!s) sets.set(i, (s = new Set()))
    s.add(fips.slice(0, 2))
  }
  const out = new Map([...sets].map(([i, s]) => [i, s.size] as const))
  statesMemo.set(m, out)
  return out
}

/**
 * The principal county of the city each city / metro gas series is named for (EIA city duoarea or BLS metro area
 * code → county FIPS). The map's dot marks that county; when the series' counties don't include it (BLS
 * Minneapolis-St. Paul S24A is used only for two Wisconsin counties: Minnesota is one of EIA's nine state-average
 * states, so Hennepin County etc. take the Minnesota average), the area gets its outline but no dot, and its
 * wording says which side it is used for. tests/unit/map-gas-areas.test.ts checks every dotted area in
 * county-geo.json has an entry here.
 */
export const GAS_AREA_PRINCIPAL_COUNTY: Readonly<Record<string, string>> = {
  // EIA weekly city series
  Y05LA: '06037', Y05SF: '06075', Y35NY: '36061', Y44HO: '48201', Y48SE: '53033',
  YBOS: '25025', YCLE: '39035', YDEN: '08031', YMIA: '12086', YORD: '17031',
  // BLS monthly metro average prices
  S11A: '25025', S12A: '36061', S12B: '42101', S23A: '17031', S23B: '26163', S24A: '27053', S24B: '29510',
  S35A: '11001', S35B: '12086', S35C: '13121', S35D: '12057', S35E: '24510', S37A: '48113', S37B: '48201',
  S48A: '04013', S48B: '08031', S49A: '06037', S49B: '06075', S49C: '06065', S49D: '53033', S49E: '06073',
  S49F: '15003', S49G: '02020',
}

/** "e:YORD" → "YORD", "b:S24A" → "S24A" (stand-in "*" dropped); null for other ids. */
const areaCode = (id: string | undefined): string | null => /^[eb]:([A-Z0-9]+)\*?$/.exec(id ?? '')?.[1] ?? null

/** The named city's principal county for a gas area id, when known. */
export function gasAreaPrincipalCounty(id: string | undefined): string | null {
  const code = areaCode(id)
  return code ? GAS_AREA_PRINCIPAL_COUNTY[code] ?? null : null
}

/**
 * Where a city / metro area's dot goes: the named city's principal county when the area includes it; no dot (null)
 * when the area is known not to include it (the outline alone marks it, so a Minneapolis dot never sits in
 * Wisconsin); for an area with no known principal county, its county with the most jobs.
 */
export function gasCityDotCounty(id: string | undefined, fipsList: readonly string[], jobsOf: (fips: string) => number): string | null {
  const principal = gasAreaPrincipalCounty(id)
  if (principal) return fipsList.includes(principal) ? principal : null
  let best: string | null = null
  for (const f of fipsList) if (!best || jobsOf(f) > jobsOf(best)) best = f
  return best
}

/** A city / metro area whose named city's principal county takes a different series ("the Wisconsin side"). */
export interface GasAreaOutside {
  /** States of the counties the area is used for: "Wisconsin". */
  side: string
  /** The principal county's state: "Minnesota". */
  home: string
  /** What the principal county uses instead ("the Minnesota state average (EIA)"), null when unknown. */
  homeUses: string | null
}

const outsideMemo = new WeakMap<MapMetrics, Map<number, GasAreaOutside | null>>()

const listJoin = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

/** For a city / metro gas area (index into `m.gas`): the side it is used for when its named city is elsewhere; else null. */
export function gasAreaOutside(m: MapMetrics, idx: number): GasAreaOutside | null {
  let memo = outsideMemo.get(m)
  if (!memo) outsideMemo.set(m, (memo = new Map()))
  if (memo.has(idx)) return memo.get(idx)!
  let out: GasAreaOutside | null = null
  const g = m.gas?.[idx]
  const principal = g && gasAreaKind(g) === 'city' ? gasAreaPrincipalCounty(g.id) : null
  const homeRow = principal ? m.counties?.[principal] : undefined
  if (principal && homeRow?.[0] !== idx) {
    const states = new Set<string>()
    for (const [fips, row] of Object.entries(m.counties ?? {})) if (row?.[0] === idx) states.add(fips.slice(0, 2))
    const name = (st: string) => STATE_FIPS_MAP[st]?.name ?? st
    const homeArea = typeof homeRow?.[0] === 'number' ? m.gas?.[homeRow[0]] : undefined
    const homeUses = homeArea ? gasKindText(homeArea) : null
    if (states.size > 0) {
      out = {
        side: listJoin([...states].sort().map(name)),
        home: name(principal.slice(0, 2)),
        homeUses: homeUses ? `the ${homeUses}` : null,
      }
    }
  }
  memo.set(idx, out)
  return out
}

/**
 * Plain-language description of a gas area for the tooltip and the selected-county panel:
 *   "Midwest region average · used for counties in 13 states (EIA PADD 2)", "Chicago area price (EIA)",
 *   "Atlanta-Sandy Springs-Roswell metro price (BLS)", "Ohio state average (EIA)"; a metro whose named city's county
 *   takes another series says which side it is used for ("…metro price (BLS), used here for the Wisconsin side; the
 *   Minnesota side uses the Minnesota state average (EIA)").
 * null for kinds that keep their own wording (HI/AK stand-in, Alaska survey, Puerto Rico) or an unrecognized label.
 */
export function gasKindText(g: Pick<MapGasArea, 'id' | 'label' | 'source' | 'standIn'>, states?: number, outside?: GasAreaOutside | null): string | null {
  const kind = gasAreaKind(g)
  const label = (g.label ?? '').trim()
  const pub = g.source === 'bls' ? 'BLS' : 'EIA'
  if (kind === 'region') {
    const r = /^(.*?)\s*\((PADD [^)]+)\)\s*avg$/.exec(label)
    if (!r) return null
    // States whose counties actually use this average (not the PADD's official membership)
    const used = states && states > 1 ? ` · used for counties in ${states} states` : ''
    return `${r[1]} region average${used} (EIA ${r[2]})`
  }
  if (kind === 'state') {
    const s = /^(.*) state avg$/.exec(label)
    return s ? `${s[1]} state average (EIA)` : null
  }
  if (kind === 'city') {
    const a = /^(.*) (area|metro) avg$/.exec(label)
    if (!a) return null
    const base = `${a[1]} ${a[2]} price (${pub})`
    if (!outside) return base
    return `${base}, used here for the ${outside.side} side; the ${outside.home} side uses ${outside.homeUses ?? 'a different series'}`
  }
  return null
}

/**
 * How many published gas areas the map draws: city, state, regional and Puerto Rico series that at least one county
 * row references and that have a change to color it with (HI/AK stand-ins repeat a metro's series and are not
 * counted; uncached / unused series are not drawn, so not counted), plus whether Alaska's community survey is drawn.
 */
export function gasAreaSummary(m: MapMetrics | null | undefined): { areas: number; survey: boolean } {
  const used = new Set<number>()
  for (const row of Object.values(m?.counties ?? {})) {
    const i = row?.[0]
    if (typeof i === 'number' && i >= 0) used.add(i)
  }
  let areas = 0
  let survey = false
  for (const i of used) {
    const g = m?.gas?.[i]
    if (!g || g.change == null || !Number.isFinite(g.change)) continue
    const k = gasAreaKind(g)
    if (k === 'survey') survey = true
    else if (k === 'city' || k === 'state' || k === 'region' || k === 'island') areas++
  }
  return { areas, survey }
}

/**
 * Regional-average stripes: thin dark lines at low alpha, so the striped area never reads brighter (or noticeably
 * darker) than an unstriped area with the same value. The legend swatch and the SVG pattern use these numbers.
 */
export interface StripePattern { rgb: readonly [number, number, number]; alpha: number; width: number; period: number }
export const GAS_REGION_STRIPE: StripePattern = { rgb: [17, 19, 22], alpha: 0.14, width: 1, period: 6 }
export const GAS_REGION_STRIPE_FILL = `rgba(${GAS_REGION_STRIPE.rgb.join(',')},${GAS_REGION_STRIPE.alpha})`
export const GAS_REGION_STRIPES_CSS =
  `repeating-linear-gradient(-45deg, ${GAS_REGION_STRIPE_FILL} 0 ${GAS_REGION_STRIPE.width}px, transparent ${GAS_REGION_STRIPE.width}px ${GAS_REGION_STRIPE.period}px)`

const srgbToLinear = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const relLum = (rgb: readonly number[]) => 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2])
const lightness = (y: number) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y)

/**
 * Apparent lightness shift of a fill under the stripe pattern, as a fraction (−0.017 = 1.7% darker): the pattern's
 * area-averaged light (linear luminance: stripe pixels alpha-blended over the fill), as CIE L* perceived lightness,
 * relative to the plain fill's.
 */
export function stripeLightnessShift(fill: readonly number[], stripe: StripePattern = GAS_REGION_STRIPE): number {
  const px = fill.map((c, i) => c * (1 - stripe.alpha) + stripe.rgb[i] * stripe.alpha)
  const cov = stripe.width / stripe.period
  const y = (1 - cov) * relLum(fill) + cov * relLum(px)
  return lightness(y) / lightness(relLum(fill)) - 1
}
