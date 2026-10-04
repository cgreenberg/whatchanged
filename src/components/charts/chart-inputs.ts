// Snapshot → chart rows + provenance for the plain (non-tabbed) charts and the Housing graph's CPI tab.
import type { ChartConfig } from '@/lib/charts/chart-config'
import type { Row } from '@/lib/charts/chart-data'
import { cpiGeoLabel, type Provenance } from '@/lib/provenance'
import { fmtDay, DATE_UNAVAILABLE } from '@/lib/format'
import { HOUSING_NOTE, GAS_SOURCE, gasCaveatFor, cpiItemStale } from '@/lib/hero-cards'
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
  /** One-line explanation shown under the chart. */
  note?: string
}

/** Map chart config IDs to snapshot data + provenance. */
export function getChartInput(id: string, snapshot: EconomicSnapshot): ChartInput {
  switch (id) {
    case 'cpi-groceries':
    case 'cpi-shelter':
    case 'cpi-energy': {
      const c = snapshot.cpi.data
      const item = id === 'cpi-groceries' ? 'groceries' : id === 'cpi-shelter' ? 'shelter' : 'energy'
      const itemName = item === 'groceries' ? 'food at home' : item
      const seriesId = c?.seriesIds?.[item]
      const series = Array.isArray(c?.series) ? c!.series : []
      const national = Array.isArray(c?.nationalSeries) ? c!.nationalSeries : []
      return {
        data: series.map(p => ({ date: p.date, [item]: p[item] })),
        nationalData: national.map(p => ({ date: p.date, [item]: p[item] })),
        stale: cpiItemStale(snapshot, item),
        note: item === 'shelter' ? HOUSING_NOTE : undefined,
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
      return {
        data: series.map(p => ({ date: p.date, price: p.price })),
        nationalData: national.map(p => ({ date: p.date, price: p.price })),
        stale: !!snapshot.gas.stale,
        weeklyGasBaseline: true,
        note: gasCaveatFor(snapshot),
        provenance: {
          source: GAS_SOURCE,
          sourceUrl: g?.tier === 3 ? 'https://www.eia.gov/petroleum/weekly/includes/padds.php' : 'https://www.eia.gov/petroleum/gasdiesel/',
          geography: g ? `${g.geoLevel ?? g.region}${g.isNationalFallback ? ' (local data unavailable)' : ''}` : 'area unavailable',
          asOf: latest ? `week of ${fmtDay(latest)}` : DATE_UNAVAILABLE,
          adjustment: NOT_SA,
        },
      }
    }
    default:
      return { data: [], nationalData: [], provenance: { source: 'unknown', geography: 'unknown', adjustment: 'unknown' } }
  }
}

