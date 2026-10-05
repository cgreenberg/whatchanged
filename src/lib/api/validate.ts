// Sanity ranges (CLAUDE.md): values outside these are treated as bad data →
// the source is shown as "Data unavailable" and the value is never cached as success.

import type { CpiData } from '@/types'
import type { GasSeriesData } from './eia'
import {
  ELECTRICITY_PRICE_RANGE,
  ELECTRICITY_METHOD,
  ELECTRICITY_CHANGE_RANGE,
  ELECTRICITY_USAGE_RANGE,
  type ElectricitySeriesData,
} from './eia-electricity'

export const CPI_CHANGE_RANGE = [-20, 50] as const
export const GAS_PRICE_RANGE = [1, 10] as const

const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

export function isValidCpi(d: CpiData | null | undefined): boolean {
  if (!d || !Array.isArray(d.series)) return false
  if (!(d.groceriesBaseline > 0) || !(d.groceriesCurrent > 0)) return false
  if (!inRange(d.groceriesChange, CPI_CHANGE_RANGE)) return false
  if (d.shelterChange !== undefined && !inRange(d.shelterChange, CPI_CHANGE_RANGE)) return false
  // The rent index (SEHA) is validated on its own where it is used (shelter $ only): an implausible rent index
  // drops that dollar figure, never the whole CPI area's groceries and shelter numbers.
  return true
}

/** CPI rent of primary residence % change usable for the shelter $ figure. */
export function isValidRentIndexChange(v: number | null | undefined): v is number {
  return inRange(v, CPI_CHANGE_RANGE)
}

export function isValidGasSeries(d: GasSeriesData | null | undefined): boolean {
  if (!d || !Array.isArray(d.series) || !d.series.length) return false
  if (!inRange(d.current, GAS_PRICE_RANGE)) return false
  if (!inRange(d.baseline, GAS_PRICE_RANGE)) return false
  if (typeof d.baselineDate !== 'string' || typeof d.latestDate !== 'string') return false
  return true
}

/** EIA residential electricity: price 5–60 ¢/kWh, change −50…+100 %, usage 100–3,000 kWh/mo (or none). */
export function isValidElectricity(d: ElectricitySeriesData | null | undefined): boolean {
  if (!d || !Array.isArray(d.series) || !d.series.length) return false
  // Older cached payloads (seasonally adjusted, or the 12-months-ending-Jan-2025 'avg12' baseline) → invalid → refetched.
  if (d.method !== ELECTRICITY_METHOD) return false
  for (const v of [d.current, d.baseline, d.latestMonthPrice, d.baselineMonthPrice]) {
    if (!inRange(v, ELECTRICITY_PRICE_RANGE)) return false
  }
  if (!inRange(d.change, ELECTRICITY_CHANGE_RANGE)) return false
  if (d.usageKwh !== null && !inRange(d.usageKwh, ELECTRICITY_USAGE_RANGE)) return false
  if (typeof d.latestPeriod !== 'string' || typeof d.baselinePeriod !== 'string') return false
  return true
}
