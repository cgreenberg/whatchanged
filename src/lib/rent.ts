// Rent on new leases (Zillow ZORI, seasonally adjusted by whatchanged), bundled by
// scripts/build-local-data.py: county rows (src/lib/data/county-rent.json) and, for counties Zillow
// has no county series for, the county's metro (src/lib/data/metro-rent.json; OMB March 2020 CBSAs,
// the vintage Zillow's metros use). Server-side only; the snapshot carries the result so the page,
// share card and OG image agree.

import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import type { RentData } from '@/types'

interface CountyRentRow {
  pct: number
  baseRent: number
  curRent: number
  asOf: string
  name: string
  flagged?: boolean
  note?: string
  saPool?: string
}

interface CountyRentFile {
  meta: { source: string; adjustment: string; baseMonth: string; asOf: string }
  counties: Record<string, CountyRentRow>
  /** Counties with a Zillow series that is too new (no data by Jan 2024) to measure since Jan 2025. */
  tooNew?: string[]
}

const FILE = countyRent as unknown as CountyRentFile
const TOO_NEW = new Set(FILE.tooNew ?? [])

interface MetroRentFile {
  meta: { source: string; adjustment: string; baseMonth: string; asOf: string; geography: string }
  metros: Record<string, Omit<CountyRentRow, 'note'>>
  /** County FIPS → CBSA code, only for counties without a county row. */
  counties: Record<string, string>
}

const METRO = metroRent as unknown as MetroRentFile

export const RENT_SOURCE_URL = 'https://www.zillow.com/research/data/'
/** Same sanity range as other price changes (CPI −20%…+50%). */
const PCT_MIN = -20
const PCT_MAX = 50

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Signed $/mo change consistent with the SA % change, applied to the observed current rent. */
export function rentMonthlyChange(curRent: number, pct: number): number {
  const v = Math.round(curRent - curRent / (1 + pct / 100))
  return Object.is(v, -0) ? 0 : v
}

/** County rent lookup with the reason when there is no usable figure (for the resolution trace). */
export type CountyRentLookup =
  | { data: RentData }
  | { data: null; why: 'no-county' | 'no-series' | 'too-new' | 'out-of-range' | 'malformed' }

export function lookupCountyRent(countyFips: string | null | undefined): CountyRentLookup {
  if (!countyFips || !/^\d{5}$/.test(countyFips)) return { data: null, why: 'no-county' }
  const row = FILE.counties?.[countyFips]
  if (!row) return { data: null, why: TOO_NEW.has(countyFips) ? 'too-new' : 'no-series' }
  const bad = checkRow(row)
  if (bad) return { data: null, why: bad }
  const { pct, baseRent, curRent, asOf, name, flagged, note, saPool } = row
  return {
    data: {
      level: 'county',
      pct,
      baseRent,
      curRent,
      monthlyChange: rentMonthlyChange(curRent, pct),
      baseMonth: FILE.meta.baseMonth,
      asOf,
      countyFips,
      geoName: name,
      source: FILE.meta.source,
      sourceUrl: RENT_SOURCE_URL,
      adjustment: FILE.meta.adjustment,
      ...(flagged === true ? { flagged: true } : {}),
      ...(typeof note === 'string' && note ? { note } : {}),
      ...(typeof saPool === 'string' && saPool ? { saPool } : {}),
    },
  }
}

function checkRow(row: Omit<CountyRentRow, 'note'>): 'out-of-range' | 'malformed' | null {
  const { pct, baseRent, curRent, asOf } = row
  if (!finite(pct)) return 'malformed'
  if (pct < PCT_MIN || pct > PCT_MAX) return 'out-of-range'
  if (!finite(baseRent) || baseRent <= 0 || !finite(curRent) || curRent <= 0) return 'malformed'
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}$/.test(asOf)) return 'malformed'
  return null
}

/** The county's metro (OMB 2020 CBSA) when Zillow has no county series: CBSA code + title, without fetching. */
export function metroForCounty(countyFips: string | null | undefined): { cbsa: string; name: string } | null {
  const cbsa = countyFips ? METRO.counties?.[countyFips] : undefined
  const row = cbsa ? METRO.metros?.[cbsa] : undefined
  return cbsa && row ? { cbsa, name: row.name } : null
}

/**
 * Metro rent for a county without a county series (the rent ladder's metro rung). `geoName` is
 * "{CBSA title} metro"; `countyFips` stays the zip's county.
 */
export function lookupMetroRent(countyFips: string | null | undefined, countyName?: string): CountyRentLookup {
  if (!countyFips || !/^\d{5}$/.test(countyFips)) return { data: null, why: 'no-county' }
  const m = metroForCounty(countyFips)
  if (!m) return { data: null, why: 'no-series' }
  const row = METRO.metros[m.cbsa]
  const bad = checkRow(row)
  if (bad) return { data: null, why: bad }
  const { pct, baseRent, curRent, asOf, name, flagged, saPool } = row
  return {
    data: {
      level: 'metro',
      cbsa: m.cbsa,
      countyWhy: TOO_NEW.has(countyFips) ? 'too-new' : 'none',
      ...(countyName ? { countyName } : {}),
      pct,
      baseRent,
      curRent,
      monthlyChange: rentMonthlyChange(curRent, pct),
      baseMonth: METRO.meta.baseMonth,
      asOf,
      countyFips,
      geoName: `${name} metro`,
      source: METRO.meta.source,
      sourceUrl: RENT_SOURCE_URL,
      adjustment: METRO.meta.adjustment,
      ...(flagged === true ? { flagged: true } : {}),
      ...(typeof saPool === 'string' && saPool ? { saPool } : {}),
    },
  }
}

export function getCountyRent(countyFips: string | null | undefined): RentData | null {
  return lookupCountyRent(countyFips).data
}
