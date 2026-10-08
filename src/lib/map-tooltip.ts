// Hover / keyboard-focus tooltip text for one county on the national map: county name + state, the metric's
// value with its sign and units, and the geography + source the number covers ("Zillow county",
// "Atlanta metro (BLS)", "Georgia statewide (EIA)"). Same values the map colors the county with.

import type { MapMetrics } from '@/lib/api/map-metrics'
import { fmtPct, fmtMonth, flagNote, liveValue, type CountyRecord, type MetricKey } from '@/lib/county-data'
import { mapMetroRent } from '@/lib/map-metro-rent'
import { fmtSignedDollars } from '@/lib/format'
import { hasSeasonalCaveat, SEASONAL_CAVEAT_SHORT } from '@/lib/rent-range'

export interface MapTooltipModel {
  /** "Fulton County, GA". */
  name: string
  /** "Rent +4.7%", "Gas +$0.87/gal", "Rent: No data". */
  value: string
  /** "Zillow county", "Atlanta metro (BLS)", "Georgia statewide (EIA)"; null when there is no data. */
  geo: string | null
  /** Short caveat: "unusual value", "last available copy", "†seasonal pattern uncertain" (rent). */
  note?: string
  /** The county is colored by its metro's rent (no Zillow county series). */
  metro?: true
  noData: boolean
}

const SHORT: Record<MetricKey, string> = { gas: 'Gas', rent: 'Rent', hv: 'Home prices', groceries: 'Groceries', elec: 'Electricity' }

export function mapTooltip({ fips, metric, county, liveData, frame }: {
  fips: string
  metric: MetricKey
  county: CountyRecord | undefined
  liveData: MapMetrics | null
  /** Time-lapse playback: the frame's value and month (county metrics only). */
  frame?: { value: number | undefined; month: string }
}): MapTooltipModel {
  const name = county?.n ?? `County ${fips}`
  const short = SHORT[metric]
  const noData: MapTooltipModel = { name, value: `${short}: No data`, geo: null, noData: true }
  if (metric === 'rent' || metric === 'hv') {
    if (frame) {
      const v = frame.value
      return typeof v === 'number' && Number.isFinite(v)
        ? { name, value: `${short} ${fmtPct(v)}`, geo: `Zillow county, ${fmtMonth(frame.month)}`, noData: false }
        : noData
    }
    const v = county?.[metric]
    if (typeof v === 'number' && Number.isFinite(v)) {
      const flagged = flagNote(county, metric)
      const notes = [flagged ? 'unusual value' : '', metric === 'rent' && hasSeasonalCaveat(county?.rentSaCav) ? SEASONAL_CAVEAT_SHORT : ''].filter(Boolean)
      return { name, value: `${short} ${fmtPct(v)}`, geo: 'Zillow county', ...(notes.length ? { note: notes.join(' · ') } : {}), noData: false }
    }
    const m = metric === 'rent' ? mapMetroRent(fips) : null
    if (m) {
      return {
        name, value: `${short} ${fmtPct(m.pct)}`, geo: `${m.name} metro rent (Zillow; no county series)`, metro: true,
        ...(m.saCaveat ? { note: SEASONAL_CAVEAT_SHORT } : {}), noData: false,
      }
    }
    return noData
  }
  const lv = liveValue(liveData, fips, metric)
  if (!lv) return noData
  return {
    name,
    value: metric === 'gas' ? `${short} ${fmtSignedDollars(lv.value)}/gal` : `${short} ${fmtPct(lv.value)}`,
    geo: `${lv.area} (${lv.source})`,
    ...(lv.stale ? { note: 'last available copy' } : {}),
    noData: false,
  }
}
