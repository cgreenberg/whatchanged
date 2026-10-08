// Metro rent on the county map: counties with no Zillow county rent series, colored by their metro's
// Zillow rent (src/lib/data/metro-rent.json, OMB March 2020 CBSAs) — the same metro rung the Rent card uses
// (src/lib/rent.ts lookupMetroRent), with the same rules: a metro flagged as a statistical outlier, or one
// outside the plausible range, never stands in for a county. Client-safe: it bundles only the small metro
// file (not county-rent.json); tests/unit/map-metro-rent.test.ts checks it agrees with the card's ladder for
// every county.

import metroRent from '@/lib/data/metro-rent.json'
import { RENT_PCT_RANGE } from '@/lib/rent-range'

interface MetroRow {
  name: string
  pct: number
  baseRent: number
  curRent: number
  asOf: string
  flagged?: boolean
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
  const { pct, baseRent, curRent, asOf, name } = row
  if (!finite(pct) || pct < PCT_MIN || pct > PCT_MAX) return null
  if (!finite(baseRent) || baseRent <= 0 || !finite(curRent) || curRent <= 0) return null
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}$/.test(asOf)) return null
  return { cbsa, name, pct, cur: curRent, asOf }
}
