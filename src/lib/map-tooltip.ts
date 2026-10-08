// Hover / keyboard-focus tooltip text for one county on the national map: county name + state, the metric's
// value with its sign and units, and the geography + source the number covers ("Zillow county",
// "Atlanta metro (BLS)", "Georgia statewide (EIA)"). Same values the map colors the county with (rent: county →
// metro → city, map-metro-rent.ts mapRentTier). A HUD-tier county is gray on the map (no usable Zillow rent); its
// tooltip says so and adds HUD's Fair Market Rent figure, labeled as a yearly projected estimate, not a market-rent index.

import type { MapMetrics } from '@/lib/api/map-metrics'
import { fmtPct, fmtMonth, flagNote, liveValue, BASELINE_MONTH, type CountyRecord, type MetricKey } from '@/lib/county-data'
import { mapRentTier } from '@/lib/map-metro-rent'
import { fmtSignedDollars } from '@/lib/format'
import { hasSeasonalCaveat, SEASONAL_CAVEAT_SHORT } from '@/lib/rent-range'

export interface MapTooltipModel {
  /** "Fulton County, GA". */
  name: string
  /** "Rent +4.7%", "Gas +$0.87/gal", "Rent: No data". */
  value: string
  /**
   * "Zillow county", "Georgia statewide (EIA)", gas "Chicago area price (EIA)" / "Ohio state average (EIA)" /
   * "Midwest region average · used for counties in 13 states (EIA PADD 2)"; null when there is no data.
   */
  geo: string | null
  /** The window / month the value covers ("Jan 2025 → Aug 2026 monthly averages"); null when there is no data. */
  when?: string
  /** Short caveat: "unusual value", "last available copy", "†seasonal pattern uncertain" (rent). */
  note?: string
  /** The county is colored by its metro's rent (no Zillow county series). */
  metro?: true
  /** Rent tier the county is colored by when it isn't its own Zillow county series. */
  tier?: 'metro' | 'city' | 'hud'

  noData: boolean
}

const SHORT: Record<MetricKey, string> = { gas: 'Gas', rent: 'Rent', hv: 'Home prices', groceries: 'Groceries', elec: 'Electricity' }

export function mapTooltip({ fips, metric, county, liveData, frame, hudWindowText, countyWhen }: {
  fips: string
  metric: MetricKey
  county: CountyRecord | undefined
  liveData: MapMetrics | null
  /** Time-lapse playback: the frame's value and month (county metrics only). */
  frame?: { value: number | undefined; month: string }
  /** HUD tier's fiscal-year window from the build's meta (county-data.ts hudWindow): "FY2025→FY2027". */
  hudWindowText?: string
  /** Zillow layers: the window the county value covers ("Jan 2025 → Aug 2026"), from the build's meta. */
  countyWhen?: string
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
      return {
        name, value: `${short} ${fmtPct(v)}`, geo: 'Zillow county', ...(countyWhen ? { when: countyWhen } : {}),
        ...(notes.length ? { note: notes.join(' · ') } : {}), noData: false,
      }
    }
    const t = metric === 'rent' ? mapRentTier(fips, county) : null
    if (t?.tier === 'metro') {
      const m = t.metro
      return {
        name, value: `${short} ${fmtPct(m.pct)}`, geo: `${m.name} metro rent (Zillow; no usable county series)`, metro: true, tier: 'metro',
        ...(countyWhen ? { when: countyWhen } : {}),
        ...(m.saCaveat ? { note: SEASONAL_CAVEAT_SHORT } : {}), noData: false,
      }
    }
    if (t?.tier === 'city') {
      const c = t.city
      return {
        name, value: `${short} ${fmtPct(c.pct)}`, geo: `${c.name} area rent (Zillow city series; no usable county or metro series)`, tier: 'city',
        ...(countyWhen ? { when: countyWhen } : {}),
        ...(c.saCaveat ? { note: SEASONAL_CAVEAT_SHORT } : {}), noData: false,
      }
    }
    if (t?.tier === 'hud') {
      // Gray on the map (never colored): HUD's figure is a yearly projected estimate, not a market-rent index
      const h = t.hud
      return {
        name, value: `${short}: No usable Zillow rent here`, tier: 'hud', noData: true,
        geo: `HUD Fair Market Rent (a yearly projected estimate, not a market-rent index): ${fmtPct(h.pct)} · 2-bedroom, HUD area, ` +
          `${hudWindowText ?? 'between fiscal years'}, not since ${fmtMonth(BASELINE_MONTH)}${h.from ? `; ${h.from} figure` : ''}`,
      }
    }
    return noData
  }
  const lv = liveValue(liveData, fips, metric)
  if (!lv) return noData
  return {
    name,
    value: metric === 'gas' ? `${short} ${fmtSignedDollars(lv.value)}/gal` : `${short} ${fmtPct(lv.value)}`,
    // Gas: which kind of published area ("Chicago area price (EIA)", "Midwest region average · used for counties in 13
    // states (EIA PADD 2)"); otherwise the area + publisher once ("… (Alaska DCRA)" labels already name it)
    geo: lv.kindText ?? (lv.area.includes(`(${lv.source})`) ? lv.area : `${lv.area} (${lv.source})`),
    when: lv.when,
    ...(lv.stale ? { note: 'last available copy' } : {}),
    noData: false,
  }
}
