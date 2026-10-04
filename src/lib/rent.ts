// County rent on new leases (Zillow ZORI, seasonally adjusted by whatchanged), bundled as
// src/lib/data/county-rent.json by scripts/build-local-data.py. Server-side only (the JSON is
// ~57KB); the snapshot carries the result so the page, share card and OG image agree.

import countyRent from '@/lib/data/county-rent.json'
import type { RentData } from '@/types'

interface CountyRentRow {
  pct: number
  baseRent: number
  curRent: number
  asOf: string
  name: string
  flagged?: boolean
  note?: string
}

interface CountyRentFile {
  meta: { source: string; adjustment: string; baseMonth: string; asOf: string }
  counties: Record<string, CountyRentRow>
}

const FILE = countyRent as unknown as CountyRentFile

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
  | { data: null; why: 'no-county' | 'no-series' | 'out-of-range' | 'malformed' }

export function lookupCountyRent(countyFips: string | null | undefined): CountyRentLookup {
  if (!countyFips || !/^\d{5}$/.test(countyFips)) return { data: null, why: 'no-county' }
  const row = FILE.counties?.[countyFips]
  if (!row) return { data: null, why: 'no-series' }
  const { pct, baseRent, curRent, asOf, name, flagged, note } = row
  if (!finite(pct)) return { data: null, why: 'malformed' }
  if (pct < PCT_MIN || pct > PCT_MAX) return { data: null, why: 'out-of-range' }
  if (!finite(baseRent) || baseRent <= 0 || !finite(curRent) || curRent <= 0) return { data: null, why: 'malformed' }
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}$/.test(asOf)) return { data: null, why: 'malformed' }
  return {
    data: {
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
    },
  }
}

export function getCountyRent(countyFips: string | null | undefined): RentData | null {
  return lookupCountyRent(countyFips).data
}
