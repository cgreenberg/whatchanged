// Rent on new leases (Zillow ZORI, seasonally adjusted by whatchanged), bundled by
// scripts/build-local-data.py: county rows (src/lib/data/county-rent.json) and, for counties Zillow
// has no county series for, the county's metro (src/lib/data/metro-rent.json; OMB March 2020 CBSAs,
// the vintage Zillow's metros use). Server-side only; the snapshot carries the result so the page,
// share card and OG image agree.

import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import type { RentData } from '@/types'
import { RENT_PCT_RANGE } from '@/lib/rent-range'

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
  meta: { source: string; adjustment: string; baseMonth: string; asOf: string; pctRange?: [number, number] }
  counties: Record<string, CountyRentRow>
  /** Counties whose own series has Jan 2025 + latest values but a % change outside meta.pctRange. */
  outOfRange?: string[]
  /** Counties with a Zillow series that is too new (no data by Jan 2024) to measure since Jan 2025. */
  tooNew?: string[]
  /** Counties whose Zillow series reaches back past Jan 2024 but has no Jan 2025 value to measure from. */
  noBaseline?: string[]
}

const FILE = countyRent as unknown as CountyRentFile
const TOO_NEW = new Set(FILE.tooNew ?? [])
const NO_BASELINE = new Set(FILE.noBaseline ?? [])
const OUT_OF_RANGE = new Set(FILE.outOfRange ?? [])

/** Why a county's own Zillow series isn't usable, when Zillow publishes a current row for it. */
function countySeriesWhy(countyFips: string): 'too-new' | 'no-baseline' | 'out-of-range' | null {
  return TOO_NEW.has(countyFips) ? 'too-new'
    : NO_BASELINE.has(countyFips) ? 'no-baseline'
      : OUT_OF_RANGE.has(countyFips) ? 'out-of-range'
        : null
}

interface MetroRentFile {
  meta: { source: string; adjustment: string; baseMonth: string; asOf: string; geography: string; pctRange?: [number, number] }
  metros: Record<string, Omit<CountyRentRow, 'note'>>
  /** County FIPS → CBSA code, only for counties without a county row. */
  counties: Record<string, string>
  /** County FIPS → CBSA for counties whose metro's % change is outside meta.pctRange (no row for that metro). */
  outOfRangeCounties?: Record<string, string>
}

const METRO = metroRent as unknown as MetroRentFile

export const RENT_SOURCE_URL = 'https://www.zillow.com/research/data/'
/** Sanity range: the one the build applied (meta.pctRange), else the shared constant (they are tested equal). */
const [PCT_MIN, PCT_MAX] = FILE.meta.pctRange ?? RENT_PCT_RANGE

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Signed $/mo change consistent with the SA % change, applied to the observed current rent. */
export function rentMonthlyChange(curRent: number, pct: number): number {
  const v = Math.round(curRent - curRent / (1 + pct / 100))
  return Object.is(v, -0) ? 0 : v
}

/** County rent lookup with the reason when there is no usable figure (for the resolution trace). */
export type CountyRentLookup =
  | { data: RentData }
  | { data: null; why: 'no-county' | 'no-series' | 'too-new' | 'no-baseline' | 'out-of-range' | 'malformed' | 'flagged' }

export function lookupCountyRent(countyFips: string | null | undefined): CountyRentLookup {
  if (!countyFips || !/^\d{5}$/.test(countyFips)) return { data: null, why: 'no-county' }
  const row = FILE.counties?.[countyFips]
  if (!row) return { data: null, why: countySeriesWhy(countyFips) ?? 'no-series' }
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

function countyWhyForMetro(countyFips: string): NonNullable<RentData['countyWhy']> {
  const w = countySeriesWhy(countyFips)
  return w === 'too-new' || w === 'no-baseline' ? w : 'none'
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
  if (METRO.outOfRangeCounties?.[countyFips]) return { data: null, why: 'out-of-range' }
  const m = metroForCounty(countyFips)
  if (!m) return { data: null, why: 'no-series' }
  const row = METRO.metros[m.cbsa]
  const bad = checkRow(row)
  if (bad) return { data: null, why: bad }
  // A metro figure flagged as a statistical outlier never stands in for a county (often a change in the mix of
  // listings, not in rents): the card falls back to CPI shelter. A county's OWN flagged series is still shown, with ⚠.
  if (row.flagged === true) return { data: null, why: 'flagged' }
  const { pct, baseRent, curRent, asOf, name, saPool } = row
  return {
    data: {
      level: 'metro',
      cbsa: m.cbsa,
      countyWhy: countyWhyForMetro(countyFips),
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
      ...(typeof saPool === 'string' && saPool ? { saPool } : {}),
    },
  }
}

export function getCountyRent(countyFips: string | null | undefined): RentData | null {
  return lookupCountyRent(countyFips).data
}
