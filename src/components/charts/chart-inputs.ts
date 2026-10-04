// Snapshot → chart rows + provenance for the plain (non-tabbed) charts and the Housing graph's CPI tab.
import type { ChartConfig } from '@/lib/charts/chart-config'
import type { Row } from '@/lib/charts/chart-data'
import { cpiGeoLabel, type Provenance } from '@/lib/provenance'
import { fmtDay, fmtMonthYear, DATE_UNAVAILABLE } from '@/lib/format'
import {
  HOUSING_NOTE, SHELTER_SHORT_NOTE, gasCaveatFor, gasSourceInfo, isMonthDatedGas, cpiItemStale,
  ELECTRICITY_SOURCE, ELECTRICITY_SOURCE_URL, ELECTRICITY_SEASONAL_NOTE, electricityPlace, fmtCents,
} from '@/lib/hero-cards'
import type { EconomicSnapshot, HeatingFuelData } from '@/types'
import { HEATING_NOTE, NYSERDA_NOTE } from '@/lib/charts/chart-config'

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
      const monthly = isMonthDatedGas(g)
      const geography = g ? `${g.geoLevel ?? g.region}${g.isNationalFallback ? ' (local data unavailable)' : ''}` : 'area unavailable'
      const src = gasSourceInfo(g)
      const cadence = g?.source === 'dcra' ? 'twice yearly (Jan & Jul surveys)' : 'monthly'
      const description = g?.source === 'dcra'
        ? 'Alaska DCRA Community Fuel Price Survey: retail price per gallon of gasoline in surveyed communities, each January and July. No U.S. line: the survey covers Alaska only.'
        : g?.source === 'daco'
          ? 'DACO (Puerto Rico Department of Consumer Affairs) monthly island-wide average retail price per gallon of regular gasoline. No U.S. line: DACO publishes Puerto Rico only.'
          : 'BLS CPI average price per gallon of regular gasoline, published monthly. Used for metros where EIA publishes no weekly city series, and for Hawaii/Alaska.'
      const sourceLabel = g?.source === 'dcra' ? 'Alaska DCRA Community Fuel Price Survey (CC BY 4.0)'
        : g?.source === 'daco' ? 'DACO Puerto Rico' : 'BLS CPI Average Price Data'
      return {
        // Unpublished BLS months stay as empty rows so the chart marks the gap
        data: withEmptyRows(series.map(p => ({ date: p.date, price: p.price })), g?.unpublished),
        nationalData: national.map(p => ({ date: p.date, price: p.price })),
        stale: !!snapshot.gas.stale,
        weeklyGasBaseline: !monthly,
        // Name the overlay's source: BLS monthly and EIA weekly U.S. averages differ
        nationalLabel: national.length ? (monthly ? 'U.S. city avg, BLS monthly' : 'U.S. avg, EIA weekly') : undefined,
        note: gasCaveatFor(snapshot) ??
          (g?.source === 'dcra' ? 'Survey prices each January and July; the line connects the surveys.' : undefined),
        ...(monthly
          ? {
              configOverrides: {
                description,
                sourceLabel,
                sourceUrl: src.sourceUrl,
                // Two points a year: straight segments between surveys (a smoothed curve would invent in-between prices)
                ...(g?.source === 'dcra'
                  ? { series: [{ dataKey: 'price', label: 'Regular gas ($/gal), survey', color: '#F59E0B', type: 'linear' as const }] }
                  : {}),
              },
            }
          : {}),
        provenance: {
          source: src.source,
          sourceUrl: src.sourceUrl,
          geography: monthly ? `${geography} · ${cadence}` : geography,
          asOf: latest ? (monthly ? `${fmtMonthYear(latest.slice(0, 7))}${g?.source === 'dcra' ? ' survey' : ''}` : `week of ${fmtDay(latest)}`) : DATE_UNAVAILABLE,
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

/** Weekly rows with an empty row at each side of a gap > 5 weeks (the heating survey's April–September break), so the graph shows the gap. */
export function withSeasonGaps(points: ReadonlyArray<{ date: string; price: number }>): Row[] {
  const rows: Row[] = []
  const DAY = 86_400_000
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i > 0) {
      const a = Date.parse(`${points[i - 1].date}T00:00:00Z`)
      const b = Date.parse(`${p.date}T00:00:00Z`)
      if (b - a > 35 * DAY) rows.push({ date: iso(a + 7 * DAY) }, { date: iso(b - 7 * DAY) })
    }
    rows.push({ date: p.date, price: p.price })
  }
  return rows
}

/** Home heating graph tab (Heating oil | Propane): rows, same-source comparison and provenance. */
export function getHeatingInput(product: 'oil' | 'propane', snapshot: EconomicSnapshot): ChartInput {
  const r = snapshot.heating?.[product] ?? null
  const h: HeatingFuelData | null = r?.data ?? null
  const fuel = product === 'oil' ? 'heating oil' : 'propane'
  const step = snapshot.trace?.[product === 'oil' ? 'heatingOil' : 'propane']?.find(s => s.status === 'used' || s.status === 'stale')
  const nyserda = h?.source === 'nyserda'
  return {
    data: h ? withSeasonGaps(h.series) : [],
    nationalData: h?.nationalSeries ? withSeasonGaps(h.nationalSeries) : [],
    stale: !!r?.stale,
    weeklyGasBaseline: true,
    nationalLabel: h?.nationalSeries?.length ? h.nationalLabel : undefined,
    note: h ? h.offSeasonNote ?? (nyserda ? `${h.geography}: NYSERDA survey, year-round.` : `Statewide average for ${h.geography.replace(/ \(statewide\)$/, '')}.`) : r?.error ?? undefined,
    info: nyserda ? [NYSERDA_NOTE] : [HEATING_NOTE],
    ...(h && Number.isFinite(h.change)
      ? { headline: { pct: h.change, detail: `$${h.current.toFixed(2)}/gal, week of ${fmtDay(h.latestDate)}` } }
      : {}),
    provenance: {
      source: nyserda ? 'NYSERDA home heating oil survey (Open NY)' : `EIA weekly residential ${fuel} (SHOPP)`,
      sourceUrl: step?.citationUrl ?? (nyserda ? 'https://data.ny.gov/d/rc94-5y2u' : 'https://www.eia.gov/petroleum/heatingoilpropane/'),
      geography: h ? `${h.geography}, ${nyserda ? 'weekly Sep–Mar, twice monthly Apr–Aug' : 'weekly in heating season'}` : snapshot.location?.stateName ?? 'this area',
      asOf: h ? `week of ${fmtDay(h.latestDate)}` : DATE_UNAVAILABLE,
      adjustment: NOT_SA,
    },
  }
}
