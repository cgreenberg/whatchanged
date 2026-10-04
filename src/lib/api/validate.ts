// Sanity ranges (CLAUDE.md): values outside these are treated as bad data →
// the source is shown as "Data unavailable" and the value is never cached as success.

import type { CpiData } from '@/types'
import type { GasSeriesData } from './eia'

export const CPI_CHANGE_RANGE = [-20, 50] as const
export const GAS_PRICE_RANGE = [1, 10] as const

const inRange = (v: unknown, [lo, hi]: readonly [number, number]): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

export function isValidCpi(d: CpiData | null | undefined): boolean {
  if (!d || !Array.isArray(d.series)) return false
  if (!(d.groceriesBaseline > 0) || !(d.groceriesCurrent > 0)) return false
  if (!inRange(d.groceriesChange, CPI_CHANGE_RANGE)) return false
  if (d.shelterChange !== undefined && !inRange(d.shelterChange, CPI_CHANGE_RANGE)) return false
  if (d.rentIndexChange !== undefined && !inRange(d.rentIndexChange, CPI_CHANGE_RANGE)) return false
  return true
}

export function isValidGasSeries(d: GasSeriesData | null | undefined): boolean {
  if (!d || !Array.isArray(d.series) || !d.series.length) return false
  if (!inRange(d.current, GAS_PRICE_RANGE)) return false
  if (!inRange(d.baseline, GAS_PRICE_RANGE)) return false
  if (typeof d.baselineDate !== 'string' || typeof d.latestDate !== 'string') return false
  return true
}
