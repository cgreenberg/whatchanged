// Rent tiers on the county map, in the Rent card's order, then one map-only tier:
//   county — the county's own Zillow series (counties.json `rent`), solid;
//   metro  — no county series: the county's metro's Zillow rent (src/lib/data/metro-rent.json, OMB March 2020
//            CBSAs), the card's metro rung (src/lib/rent.ts lookupMetroRent), light stripes;
//   city   — no county or usable metro series: the county's most populous city with a Zillow series
//            (src/lib/data/city-rent.json), the card's city rung (lookupCityRent), dots;
//   hud    — none of those: HUD's 2-bedroom Fair Market Rent change between fiscal years (counties.json `rentH`),
//            MAP ONLY (never on the card) and NEVER COLORED: a yearly HUD projected estimate, not a market-rent index (its median ran
//            about twice Zillow's), so the county is drawn in the no-data gray and HUD's figure appears only in the
//            tooltip / panel, labeled as an estimate. HUD values never enter the color scale (rentFillValue).
// Same rules as the card: a metro or city flagged as a statistical outlier, or outside the plausible range, never
// stands in for a county. Client-safe: it bundles only the small metro and city files (not county-rent.json);
// tests/unit/map-metro-rent.test.ts checks the map agrees with the card's ladder for every county.

import metroRent from '@/lib/data/metro-rent.json'
import cityRent from '@/lib/data/city-rent.json'
import { mapScaleFor, scaleColor, type CountyRecord, type CountyMap, type MapScale } from '@/lib/county-data'
import { RENT_PCT_RANGE, hasSeasonalCaveat, type SeasonalCaveat } from '@/lib/rent-range'

interface MetroRow {
  name: string
  pct: number
  baseRent: number
  curRent: number
  asOf: string
  flagged?: boolean
  saCaveat?: SeasonalCaveat
}

interface MetroRentFile {
  meta: { pctRange?: [number, number] }
  metros: Record<string, MetroRow>
  /** County FIPS → CBSA, only for counties without a county row. */
  counties: Record<string, string>
  /** Counties whose metro's % change is outside the plausible range. */
  outOfRangeCounties?: Record<string, string>
}

const METRO = metroRent as unknown as MetroRentFile
const [PCT_MIN, PCT_MAX] = METRO.meta?.pctRange ?? RENT_PCT_RANGE

export interface MapMetroRent {
  cbsa: string
  /** CBSA title, e.g. "Birmingham, AL". */
  name: string
  /** Seasonally adjusted % change since Jan 2025. */
  pct: number
  /** Latest observed typical asking rent, $/mo. */
  cur: number
  asOf: string
  /** Seasonal-pattern caveat at the displayed month (rent-range.ts), when there is one. */
  saCaveat?: SeasonalCaveat
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The metro rent that stands in for a county on the map, or null. Only meaningful for counties with no county
 * rent value on the map (metro-rent.json lists only counties without a usable county series).
 */
export function mapMetroRent(fips: string): MapMetroRent | null {
  if (!/^\d{5}$/.test(fips)) return null
  if (METRO.outOfRangeCounties?.[fips]) return null
  const cbsa = METRO.counties?.[fips]
  const row = cbsa ? METRO.metros?.[cbsa] : undefined
  if (!cbsa || !row) return null
  if (row.flagged === true) return null
  const { pct, baseRent, curRent, asOf, name, saCaveat } = row
  if (!finite(pct) || pct < PCT_MIN || pct > PCT_MAX) return null
  if (!finite(baseRent) || baseRent <= 0 || !finite(curRent) || curRent <= 0) return null
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}$/.test(asOf)) return null
  return { cbsa, name, pct, cur: curRent, asOf, ...(hasSeasonalCaveat(saCaveat) ? { saCaveat } : {}) }
}

interface CityRow extends MetroRow {
  state: string
}

interface CityRentFile {
  meta: { pctRange?: [number, number] }
  cities: Record<string, CityRow>
  /** County FIPS → Zillow city RegionID, only for counties with no usable county or metro rent. */
  counties: Record<string, string>
}

const CITY = cityRent as unknown as CityRentFile

export interface MapCityRent {
  /** Zillow city RegionID. */
  id: string
  /** Zillow's city name ("Murrells Inlet") and its state ("SC"). */
  name: string
  state: string
  pct: number
  cur: number
  asOf: string
  saCaveat?: SeasonalCaveat
}

/** The city rent that stands in for a county on the map (no usable county or metro series), or null. */
export function mapCityRent(fips: string): MapCityRent | null {
  if (!/^\d{5}$/.test(fips)) return null
  const id = CITY.counties?.[fips]
  const row = id ? CITY.cities?.[id] : undefined
  if (!id || !row || row.flagged === true) return null
  const { pct, baseRent, curRent, asOf, name, state, saCaveat } = row
  if (!finite(pct) || pct < PCT_MIN || pct > PCT_MAX) return null
  if (!finite(baseRent) || baseRent <= 0 || !finite(curRent) || curRent <= 0) return null
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}$/.test(asOf)) return null
  return { id, name, state, pct, cur: curRent, asOf, ...(hasSeasonalCaveat(saCaveat) ? { saCaveat } : {}) }
}

export interface MapHudRent {
  /** % change of the 2-bedroom Fair Market Rent between the two fiscal years (meta.sources.hudFmr). */
  pct: number
  /** 2-bedroom FMR, $/mo: base fiscal year and latest. */
  base: number
  cur: number
  /** Copied from another area (Valdez-Cordova AK ← Chugach Census Area). */
  from?: string
  /** New England: the county's towns fall in this many HUD areas (the most common one is used). */
  areas?: number
}

/** HUD Fair Market Rent change for a county with no Zillow rent at all (map only), or null. */
export function mapHudRent(c: CountyRecord | null | undefined): MapHudRent | null {
  const h = c?.rentH
  if (!h || !finite(h.p) || h.p < PCT_MIN || h.p > PCT_MAX) return null
  if (!finite(h.b) || h.b <= 0 || !finite(h.c) || h.c <= 0) return null
  return {
    pct: h.p, base: h.b, cur: h.c,
    ...(typeof h.from === 'string' && h.from ? { from: h.from } : {}),
    ...(finite(h.areas) && h.areas > 1 ? { areas: h.areas } : {}),
  }
}

export type MapRentTier =
  | { tier: 'county'; pct: number }
  | { tier: 'metro'; pct: number; metro: MapMetroRent }
  | { tier: 'city'; pct: number; city: MapCityRent }
  | { tier: 'hud'; pct: number; hud: MapHudRent }

/** The rent value the map colors a county with, and which tier it comes from (county → metro → city → HUD). */
export function mapRentTier(fips: string, c: CountyRecord | null | undefined): MapRentTier | null {
  if (c && finite(c.rent)) return { tier: 'county', pct: c.rent }
  const metro = mapMetroRent(fips)
  if (metro) return { tier: 'metro', pct: metro.pct, metro }
  const city = mapCityRent(fips)
  if (city) return { tier: 'city', pct: city.pct, city }
  const hud = mapHudRent(c)
  if (hud) return { tier: 'hud', pct: hud.pct, hud }
  return null
}

/**
 * The value the Rent layer COLORS a county with: its own Zillow series, else its metro's or city's (the card's
 * ladder). undefined for a HUD-tier county and for no data: both are drawn in the no-data gray, and HUD's yearly
 * estimate never enters the color scale.
 */
export function rentFillValue(fips: string, c: CountyRecord | null | undefined): number | undefined {
  const t = mapRentTier(fips, c)
  return t && t.tier !== 'hud' ? t.pct : undefined
}

/**
 * The Rent layer's color scale and fills for these counties (latest values, not the time-lapse): Zillow county, metro
 * and city values only. A county with no fill entry is drawn in NO_DATA_COLOR (HUD tier included).
 */
export function rentLayer(fipsList: Iterable<string>, data: CountyMap, fallbackClamp: number): { scale: MapScale; fills: Map<string, string> } {
  const values = new Map<string, number>()
  for (const f of fipsList) {
    const v = rentFillValue(f, data[f])
    if (v !== undefined) values.set(f, v)
  }
  const scale = mapScaleFor(values.values(), 'pct', fallbackClamp)
  const fills = new Map<string, string>()
  for (const [f, v] of values) fills.set(f, scaleColor(v, scale))
  return { scale, fills }
}
