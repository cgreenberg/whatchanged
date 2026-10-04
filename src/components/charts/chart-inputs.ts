// Snapshot → chart rows + provenance for the plain (non-tabbed) charts and the Housing graph's CPI tab.
import type { ChartConfig } from '@/lib/charts/chart-config'
import type { Row } from '@/lib/charts/chart-data'
import { cpiGeoLabel, type Provenance } from '@/lib/provenance'
import { fmtDay, fmtMonthYear, DATE_UNAVAILABLE } from '@/lib/format'
import {
  HOUSING_NOTE, SHELTER_SHORT_NOTE, gasCaveatFor, gasSourceInfo, isMonthlyGas, cpiItemStale,
  ELECTRICITY_SOURCE, ELECTRICITY_SOURCE_URL, ELECTRICITY_SEASONAL_NOTE, electricityPlace, fmtCents,
} from '@/lib/hero-cards'
import type { EconomicSnapshot } from '@/types'

export const NOT_SA = 'not seasonally adjusted'

export type ChartProvenance = Omit<Provenance, 'window' | 'asOf'> & { asOf?: string }

export interface ChartInput {
  data: Row[]
  nationalData: Row[]
  provenance: ChartProvenance
  stale?: boolean
  configOverrides?: Partial<ChartConfig>
  weeklyGasBaseline?: boolean
  /** National overlay label, shown in provenance only while the overlay is on. */
  nationalLabel?: string
  /** One short line shown under the chart (longer explanations go in `info`). */
  note?: string
  /** Lines shown in the graph's ⓘ disclosure, after the graph description. */
  info?: string[]
  /** Headline above the graph: the same % as the card, with a short detail. */
  headline?: { pct: number; detail?: string }
}

/** Insert an empty row for each listed date not already present (kept sorted by date). */
export function withEmptyRows(rows: Row[], dates: readonly string[] | undefined): Row[] {
  if (!dates?.length) return rows
  const have = new Set(rows.map(r => r.date))
  const extra = dates.filter(d => !have.has(d)).map(d => ({ date: d }) as Row)
  return extra.length ? [...rows, ...extra].sort((a, b) => a.date.localeCompare(b.date)) : rows
}

/** Map chart config IDs to snapshot data + provenance. */
export function getChartInput(id: string, snapshot: EconomicSnapshot): ChartInput {
  switch (id) {
    case 'cpi-groceries':
    case 'cpi-shelter': {
      const c = snapshot.cpi.data
      const item = id === 'cpi-groceries' ? 'groceries' : 'shelter'
      const itemName = item === 'groceries' ? 'food at home' : item
      const seriesId = c?.seriesIds?.[item]
      const series = Array.isArray(c?.series) ? c!.series : []
      const national = Array.isArray(c?.nationalSeries) ? c!.nationalSeries : []
      return {
        data: series.map(p => ({ date: p.date, [item]: p[item] })),
        nationalData: national.map(p => ({ date: p.date, [item]: p[item] })),
        stale: cpiItemStale(snapshot, item),
        ...(item === 'shelter' ? { note: SHELTER_SHORT_NOTE, info: [HOUSING_NOTE] } : {}),
        provenance: {
          source: `BLS CPI ${itemName}`,
          sourceUrl: seriesId ? `https://data.bls.gov/timeseries/${seriesId}` : 'https://data.bls.gov/cgi-bin/surveymost?cu',
          geography: cpiGeoLabel(c),
          adjustment: NOT_SA,
        },
      }
    }
    case 'gas': {
      const g = snapshot.gas.data
      const series = Array.isArray(g?.series) ? g!.series : []
      const national = Array.isArray(g?.nationalSeries) ? g!.nationalSeries : []
      const latest = g?.latestDate ?? series[series.length - 1]?.date
      // BLS tiers are monthly (dates YYYY-MM): monthly x-axis and the Jan 2025 baseline month;
      // the national overlay is the BLS U.S. average (same source and frequency).
      const monthly = isMonthlyGas(g)
      const geography = g ? `${g.geoLevel ?? g.region}${g.isNationalFallback ? ' (local data unavailable)' : ''}` : 'area unavailable'
      const src = gasSourceInfo(g)
      return {
        // Unpublished BLS months stay as empty rows so the chart marks the gap
        data: withEmptyRows(series.map(p => ({ date: p.date, price: p.price })), g?.unpublished),
        nationalData: national.map(p => ({ date: p.date, price: p.price })),
        stale: !!snapshot.gas.stale,
        weeklyGasBaseline: !monthly,
        // Name the overlay's source: BLS monthly and EIA weekly U.S. averages differ
        nationalLabel: national.length ? (monthly ? 'U.S. city avg, BLS monthly' : 'U.S. avg, EIA weekly') : undefined,
        note: gasCaveatFor(snapshot),
        ...(monthly
          ? {
              configOverrides: {
                description: 'BLS CPI average price per gallon of regular gasoline, published monthly. Used for metros where EIA publishes no weekly city series, and for Hawaii/Alaska.',
                sourceLabel: 'BLS CPI Average Price Data',
                sourceUrl: src.sourceUrl,
              },
            }
          : {}),
        provenance: {
          source: src.source,
          sourceUrl: src.sourceUrl,
          geography: monthly ? `${geography} · monthly` : geography,
          asOf: latest ? (monthly ? fmtMonthYear(latest.slice(0, 7)) : `week of ${fmtDay(latest)}`) : DATE_UNAVAILABLE,
          adjustment: NOT_SA,
        },
      }
    }
    case 'electricity': {
      const e = snapshot.electricity?.data ?? null
      const series = Array.isArray(e?.series) ? e!.series : []
      const national = Array.isArray(e?.nationalSeries) ? e!.nationalSeries : []
      const place = e ? electricityPlace(e) : snapshot.location?.stateName ?? 'this area'
      return {
        data: series.map(p => ({ date: p.date, sa: p.sa, price: p.price })),
        // National comparison: the U.S. seasonally adjusted line only
        nationalData: national.map(p => ({ date: p.date, sa: p.sa })),
        stale: !!snapshot.electricity?.stale,
        nationalLabel: national.length ? 'U.S. avg, EIA' : undefined,
        note: e ? `Statewide average for ${place}.` : snapshot.electricity?.error ?? undefined,
        info: [ELECTRICITY_SEASONAL_NOTE],
        ...(e && Number.isFinite(e.change)
          ? { headline: { pct: e.change, detail: `seasonally adjusted · ${fmtCents(e.current)} in ${fmtMonthYear(e.latestPeriod)}` } }
          : {}),
        provenance: {
          source: ELECTRICITY_SOURCE,
          sourceUrl: ELECTRICITY_SOURCE_URL,
          geography: e ? `${place} (statewide), monthly` : place,
          asOf: e ? fmtMonthYear(e.latestPeriod) : DATE_UNAVAILABLE,
          adjustment: 'bold line seasonally adjusted by whatchanged; thin line as published',
        },
      }
    }
    default:
      return { data: [], nationalData: [], provenance: { source: 'unknown', geography: 'unknown', adjustment: 'unknown' } }
  }
}

