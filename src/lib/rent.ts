// Rent on new leases (Zillow ZORI, seasonally adjusted by whatchanged), bundled by
// scripts/build-local-data.py: county rows (src/lib/data/county-rent.json); for counties Zillow
// has no county series for, the county's metro (src/lib/data/metro-rent.json; OMB March 2020 CBSAs,
// the vintage Zillow's metros use); and where neither is usable, the county's most populous city with a
// Zillow series (src/lib/data/city-rent.json). Server-side only; the snapshot carries the result so the
// page, share card and OG image agree. (HUD Fair Market Rents fill the map only, never the card.)

import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import cityRent from '@/lib/data/city-rent.json'
import type { RentData } from '@/types'
import { RENT_PCT_RANGE, type NotCurrentInfo } from '@/lib/rent-range'

interface CountyRentRow {
  pct: number
  baseRent: number
  curRent: number
  asOf: string
  name: string
  flagged?: boolean
  note?: string
  saPool?: string
  saW?: number
  saCaveat?: { gap: number; month: number; low?: boolean }
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
  /** Counties whose Zillow series stops before the file's latest month: months with a value + the last one. */
  notCurrent?: Record<string, NotCurrentInfo>
}

const FILE = countyRent as unknown as CountyRentFile
const TOO_NEW = new Set(FILE.tooNew ?? [])
const NO_BASELINE = new Set(FILE.noBaseline ?? [])
const OUT_OF_RANGE = new Set(FILE.outOfRange ?? [])
const NOT_CURRENT: Record<string, NotCurrentInfo> = FILE.notCurrent ?? {}

/** The county's own Zillow series when it stops before Zillow's latest month (else undefined). */
export function countyNotCurrent(countyFips: string | null | undefined): NotCurrentInfo | undefined {
  return countyFips ? NOT_CURRENT[countyFips] : undefined
}

/** Why a county's own Zillow series isn't usable, when Zillow publishes a current row for it. */
function countySeriesWhy(countyFips: string): 'too-new' | 'no-baseline' | 'out-of-range' | 'not-current' | null {
  return TOO_NEW.has(countyFips) ? 'too-new'
    : NO_BASELINE.has(countyFips) ? 'no-baseline'
      : OUT_OF_RANGE.has(countyFips) ? 'out-of-range'
        : NOT_CURRENT[countyFips] ? 'not-current'
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
  | { data: null; why: 'no-county' | 'no-series' | 'too-new' | 'no-baseline' | 'not-current' | 'out-of-range' | 'county-out-of-range' | 'malformed' | 'flagged'; notCurrent?: NotCurrentInfo }

export function lookupCountyRent(countyFips: string | null | undefined): CountyRentLookup {
  if (!countyFips || !/^\d{5}$/.test(countyFips)) return { data: null, why: 'no-county' }
  const row = FILE.counties?.[countyFips]
  if (!row) {
    const why = countySeriesWhy(countyFips) ?? 'no-series'
    return { data: null, why, ...(why === 'not-current' ? { notCurrent: NOT_CURRENT[countyFips] } : {}) }
  }
  const bad = checkRow(row)
  if (bad) return { data: null, why: bad }
  const { pct, baseRent, curRent, asOf, name, flagged, note, saPool, saW, saCaveat } = row
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
      ...seasonalFields(saPool, saW, saCaveat),
    },
  }
}

/**
 * The state (or U.S.) seasonal pattern the series was shrunk toward, the weight on its own pattern (0..1), and the
 * seasonal-pattern caveat when the build flagged one (validated: finite gap, month 1–12).
 */
function seasonalFields(saPool: unknown, saW: unknown, saCaveat?: unknown): Pick<RentData, 'saPool' | 'saW' | 'saCaveat'> {
  const c = saCaveat as { gap?: unknown; month?: unknown; low?: unknown } | undefined
  const caveatOk = !!c && finite(c.gap) && Number.isInteger(c.month) && (c.month as number) >= 1 && (c.month as number) <= 12
  return {
    ...(typeof saPool === 'string' && saPool ? { saPool } : {}),
    ...(typeof saW === 'number' && saW >= 0 && saW <= 1 ? { saW } : {}),
    ...(caveatOk ? { saCaveat: { gap: c!.gap as number, month: c!.month as number, ...(c!.low === true ? { low: true } : {}) } } : {}),
  }
}

function checkRow(row: Pick<CountyRentRow, 'pct' | 'baseRent' | 'curRent' | 'asOf'>): 'out-of-range' | 'malformed' | null {
  const { pct, baseRent, curRent, asOf } = row
  if (!finite(pct)) return 'malformed'
  if (pct < PCT_MIN || pct > PCT_MAX) return 'out-of-range'
  if (!finite(baseRent) || baseRent <= 0 || !finite(curRent) || curRent <= 0) return 'malformed'
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}$/.test(asOf)) return 'malformed'
  return null
}

function countyWhyForMetro(countyFips: string): NonNullable<RentData['countyWhy']> {
  const w = countySeriesWhy(countyFips)
  return w === 'too-new' || w === 'no-baseline' || w === 'not-current' ? w : 'none'
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
  // The county's OWN series is outside the plausible range: withheld, and its metro doesn't stand in (the build
  // gives such counties no metro row), so the trace says why instead of "not in a metro"
  if (countySeriesWhy(countyFips) === 'out-of-range') return { data: null, why: 'county-out-of-range' }
  const m = metroForCounty(countyFips)
  if (!m) return { data: null, why: 'no-series' }
  const row = METRO.metros[m.cbsa]
  const bad = checkRow(row)
  if (bad) return { data: null, why: bad }
  // A metro figure flagged as a statistical outlier never stands in for a county (often a change in the mix of
  // listings, not in rents): the card falls back to CPI shelter. A county's OWN flagged series is still shown, with ⚠.
  if (row.flagged === true) return { data: null, why: 'flagged' }
  const { pct, baseRent, curRent, asOf, name, saPool, saW, saCaveat } = row
  return {
    data: {
      level: 'metro',
      cbsa: m.cbsa,
      countyWhy: countyWhyForMetro(countyFips),
      ...(NOT_CURRENT[countyFips] ? { countyNotCurrent: NOT_CURRENT[countyFips] } : {}),
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
      ...seasonalFields(saPool, saW, saCaveat),
    },
  }
}

interface CityRentRow extends Omit<CountyRentRow, 'note' | 'name'> {
  /** Zillow's city name ("Murrells Inlet") and the city's state abbreviation. */
  name: string
  state: string
  /** County FIPS of the city (Census 2020 place / county-subdivision files). */
  county: string
}

interface CityRentFile {
  meta: { source: string; adjustment: string; baseMonth: string; asOf: string; pctRange?: [number, number] }
  cities: Record<string, CityRentRow>
  /** County FIPS → Zillow city RegionID, only for counties with no usable county or metro rent. */
  counties: Record<string, string>
}

const CITY = cityRent as unknown as CityRentFile

/**
 * "Murrells Inlet area, SC": the city rung's geography (Zillow's city name + state). Zillow's "city" regions include
 * unincorporated places (Census CDPs such as Murrells Inlet), so the label never calls the place a city.
 */
export function cityGeoName(name: string, state: string): string {
  return `${name} area, ${state}`
}

/** Why the county's metro doesn't stand in (the city rung's reason). */
function metroWhyForCity(countyFips: string): NonNullable<RentData['metroWhy']> {
  if (METRO.outOfRangeCounties?.[countyFips]) return 'out-of-range'
  const cbsa = METRO.counties?.[countyFips]
  return cbsa && METRO.metros?.[cbsa]?.flagged === true ? 'flagged' : 'none'
}

/**
 * City rent for a county with no usable county or metro series (the rent ladder's city rung): the county's most
 * populous city with a usable Zillow series. `geoName` is "{City} area, {ST}"; `countyFips` stays the zip's county.
 */
export function lookupCityRent(countyFips: string | null | undefined, countyName?: string): CountyRentLookup {
  if (!countyFips || !/^\d{5}$/.test(countyFips)) return { data: null, why: 'no-county' }
  // Same rule as the metro rung: a county whose OWN series is implausible gets no stand-in
  if (countySeriesWhy(countyFips) === 'out-of-range') return { data: null, why: 'county-out-of-range' }
  const id = CITY.counties?.[countyFips]
  const row = id ? CITY.cities?.[id] : undefined
  if (!id || !row) return { data: null, why: 'no-series' }
  const bad = checkRow(row)
  if (bad) return { data: null, why: bad }
  if (row.flagged === true) return { data: null, why: 'flagged' }
  const { pct, baseRent, curRent, asOf, name, state, saPool, saW, saCaveat } = row
  return {
    data: {
      level: 'city',
      cityId: id,
      cityName: name,
      metroWhy: metroWhyForCity(countyFips),
      countyWhy: countyWhyForMetro(countyFips),
      ...(NOT_CURRENT[countyFips] ? { countyNotCurrent: NOT_CURRENT[countyFips] } : {}),
      ...(countyName ? { countyName } : {}),
      pct,
      baseRent,
      curRent,
      monthlyChange: rentMonthlyChange(curRent, pct),
      baseMonth: CITY.meta.baseMonth,
      asOf,
      countyFips,
      geoName: cityGeoName(name, state),
      source: CITY.meta.source,
      sourceUrl: RENT_SOURCE_URL,
      adjustment: CITY.meta.adjustment,
      ...seasonalFields(saPool, saW, saCaveat),
    },
  }
}

export function getCountyRent(countyFips: string | null | undefined): RentData | null {
  return lookupCountyRent(countyFips).data
}
