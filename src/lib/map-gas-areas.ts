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
 * Plain-language description of a gas area for the tooltip and the selected-county panel:
 *   "Midwest region average · shared across 13 states (EIA PADD 2)", "Chicago city price (EIA)",
 *   "Atlanta-Sandy Springs-Roswell metro price (BLS)", "Ohio state average (EIA)".
 * null for kinds that keep their own wording (HI/AK stand-in, Alaska survey, Puerto Rico) or an unrecognized label.
 */
export function gasKindText(g: Pick<MapGasArea, 'id' | 'label' | 'source' | 'standIn'>, states?: number): string | null {
  const kind = gasAreaKind(g)
  const label = (g.label ?? '').trim()
  const pub = g.source === 'bls' ? 'BLS' : 'EIA'
  if (kind === 'region') {
    const r = /^(.*?)\s*\((PADD [^)]+)\)\s*avg$/.exec(label)
    if (!r) return null
    const shared = states && states > 1 ? ` · shared across ${states} states` : ''
    return `${r[1]} region average${shared} (EIA ${r[2]})`
  }
  if (kind === 'state') {
    const s = /^(.*) state avg$/.exec(label)
    return s ? `${s[1]} state average (EIA)` : null
  }
  if (kind === 'city') {
    const area = /^(.*) area avg$/.exec(label)
    if (area) return `${area[1]} city price (${pub})`
    const metro = /^(.*) metro avg$/.exec(label)
    if (metro) return `${metro[1]} metro price (${pub})`
    return null
  }
  return null
}

/**
 * How many published gas areas the payload draws (city, state, regional and Puerto Rico series; HI/AK stand-ins
 * repeat a metro's series and are not counted), plus whether Alaska's community survey is drawn too.
 */
export function gasAreaSummary(m: MapMetrics | null | undefined): { areas: number; survey: boolean } {
  let areas = 0
  let survey = false
  for (const g of m?.gas ?? []) {
    const k = gasAreaKind(g)
    if (k === 'survey') survey = true
    else if (k === 'city' || k === 'state' || k === 'region' || k === 'island') areas++
  }
  return { areas, survey }
}
