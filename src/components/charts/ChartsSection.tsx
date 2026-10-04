'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { chartConfigs } from '@/lib/charts/chart-config'
import type { ChartConfig } from '@/lib/charts/chart-config'
import type { Row } from '@/lib/charts/chart-data'
import { EraChart } from './EraChart'
import { ProvenanceLine } from '@/components/ProvenanceLine'
import { cpiGeoLabel, type Provenance } from '@/lib/provenance'
import { fmtDay, fmtMonthYear, fmtSignedPts, DATE_UNAVAILABLE } from '@/lib/format'
import { fetchCounty, fetchPulseMeta, flagNote, type CountyPulse, type PulseMeta } from '@/lib/local-pulse'
import { SHELTER_VS_RENT_NOTE, SHELTER_NOTE_NO_RENT, GAS_SOURCE, gasCaveatFor, cpiItemStale } from '@/lib/hero-cards'
import type { EconomicSnapshot } from '@/types'

interface ChartsSectionProps {
  snapshot: EconomicSnapshot
}

const NOT_SA = 'not seasonally adjusted'

type ChartProvenance = Omit<Provenance, 'window' | 'asOf'> & { asOf?: string }

interface ChartInput {
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


/**
 * Months of the live LAUS series that are preliminary (BLS footnote P). Uses the API's per-point
 * `preliminary` flags; else `latestPreliminary` marks the last point; else (older API responses
 * without either field) the month the static pipeline excluded as preliminary, if the chart has it.
 */
export function preliminaryMonths(
  u: EconomicSnapshot['unemployment']['data'],
  metaPreliminaryMonth?: string,
): string[] {
  const series = Array.isArray(u?.series) ? u!.series : []
  if (!series.length) return []
  const flagged = series.filter(p => p.preliminary === true).map(p => p.date)
  if (flagged.length) return flagged
  if (u?.latestPreliminary === true) return [series[series.length - 1].date]
  // Older cached responses predate both fields: fall back to the month the static pipeline excluded
  const hasFields = series.some(p => 'preliminary' in p) || (!!u && 'latestPreliminary' in u)
  if (!hasFields && metaPreliminaryMonth && series.some(p => p.date === metaPreliminaryMonth)) return [metaPreliminaryMonth]
  return []
}

/**
 * Geography of the live LAUS series: the CT planning region when the zip
 * resolves to one (BLS no longer publishes CT counties), else the county.
 */
export function unemploymentAreaLabel(snapshot: EconomicSnapshot): string {
  const name = snapshot.unemployment.data?.lausAreaName
  return name ? ctRegionLabel(name) : snapshot.location.countyName
}

/** "Western Connecticut Planning Region" → "Western Connecticut planning region"; adds ", CT" when the name lacks it. */
export function ctRegionLabel(name: string): string {
  const label = name.replace(/ Planning Region$/, ' planning region')
  return /Connecticut/.test(label) ? label : `${label}, CT`
}

/** Map chart config IDs to snapshot data + provenance. */
export function getChartInput(id: string, snapshot: EconomicSnapshot, opts: { metaPreliminaryMonth?: string } = {}): ChartInput {
  switch (id) {
    case 'unemployment': {
      const u = snapshot.unemployment.data
      const series = Array.isArray(u?.series) ? u!.series : []
      const national = Array.isArray(u?.nationalSeries) ? u!.nationalSeries : []
      const prelim = new Set(preliminaryMonths(u, opts.metaPreliminaryMonth))
      const latestIsPrelim = !!u?.latestPeriod && prelim.has(u.latestPeriod)
      return {
        data: series.map(p => (prelim.has(p.date) ? { date: p.date, rate: p.rate, preliminary: true } : { date: p.date, rate: p.rate })),
        nationalData: national.map(p => ({ date: p.date, rate: p.rate })),
        stale: !!snapshot.unemployment.stale,
        nationalLabel: national.length ? `U.S., ${u?.nationalSeriesId ?? 'LNU04000000'}` : undefined,
        provenance: {
          source: 'BLS LAUS',
          sourceUrl: u?.seriesId ? `https://data.bls.gov/timeseries/${u.seriesId}` : 'https://www.bls.gov/lau/',
          geography: `${unemploymentAreaLabel(snapshot)}, monthly`,
          asOf: u?.latestPeriod ? `${fmtMonthYear(u.latestPeriod)}${latestIsPrelim ? ' (preliminary)' : ''}` : undefined,
          adjustment: NOT_SA,
        },
      }
    }
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
        note: item === 'shelter' ? (snapshot.rent ? SHELTER_VS_RENT_NOTE : SHELTER_NOTE_NO_RENT) : undefined,
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

/**
 * County unemployment headline: our 3-month seasonally adjusted averages (not raw NSA months).
 * It comes from the county-level static shard; for legacy CT counties those figures are an
 * approximation from one planning region, which can differ from the zip's planning region
 * used by the chart below — both areas are labeled.
 */
export function UnemploymentHeadline({ county, meta, countyName, chartArea, chartPreliminary = [] }: {
  county: CountyPulse | null
  meta: PulseMeta | null
  countyName: string
  /** Geography of the chart's live LAUS series (e.g. a CT planning region). */
  chartArea?: string
  /** Preliminary months drawn at the end of the chart (excluded from the headline). */
  chartPreliminary?: string[]
}) {
  const laus = meta?.sources.laus
  const approx = !!county?.approx?.includes('ur')
  const headlineArea = approx && county?.approxFrom
    ? `${ctRegionLabel(county.approxFrom)} (approximates ${county.n})`
    : county?.n ?? countyName
  const provenance: Provenance = {
    source: laus?.short ?? 'BLS LAUS',
    sourceUrl: laus?.url,
    geography: headlineArea,
    window: laus?.window ?? '3-month averages',
    asOf: laus?.latest ? fmtMonthYear(laus.latest) : DATE_UNAVAILABLE,
    adjustment: laus?.adjustment || 'seasonally adjusted by whatchanged',
  }
  const ok = county?.ur != null && county.urBase != null && county.urCur != null && Number.isFinite(county.ur)
  const headlineRegion = approx && county?.approxFrom ? ctRegionLabel(county.approxFrom) : null
  const differs = !!headlineRegion && !!chartArea && headlineRegion !== chartArea
  const caveat = ok ? flagNote(county, 'ur') : null
  const prelimMonths = chartPreliminary.length
    ? chartPreliminary
    : laus?.preliminaryExcluded ? [laus.preliminaryExcluded] : []
  const prelimLabel = prelimMonths.map(m => fmtMonthYear(m)).join(', ')
  return (
    <div className="mb-3" data-testid="unemployment-headline">
      {ok ? (
        <p className="text-sm text-zinc-200">
          <span className="text-2xl text-white mr-2" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>
            {fmtSignedPts(county!.ur!)}
          </span>
          {county!.urBase!.toFixed(1)}% → {county!.urCur!.toFixed(1)}%
          <span className="text-zinc-500"> (3-month avg, seasonally adjusted by whatchanged)</span>
        </p>
      ) : (
        <p className="text-sm text-zinc-500">Headline change unavailable for this county.</p>
      )}
      {caveat && (
        <p className="text-[11px] text-amber-300/80" data-testid="flag-note">{caveat}</p>
      )}
      {ok && prelimMonths.length > 0 && (
        <p className="text-[11px] text-zinc-500" data-testid="unemployment-prelim-note">
          The headline uses complete months{laus?.latest ? ` through ${fmtMonthYear(laus.latest)}` : ''} and excludes the
          preliminary {prelimLabel} figure{chartPreliminary.length ? ' (hollow dot on the chart)' : ''}.
        </p>
      )}
      {approx && (
        <p className="text-[11px] text-amber-300/80" data-testid="unemployment-approx-note">
          Approximation: BLS no longer publishes {county!.n}; this headline uses
          {' '}{county?.approxFrom ? ctRegionLabel(county.approxFrom) : 'a neighboring planning region'}.
          {differs && <> The chart below shows your zip&apos;s area, {chartArea}.</>}
        </p>
      )}
      <ProvenanceLine provenance={provenance} />
    </div>
  )
}

export function ChartsSection({ snapshot }: ChartsSectionProps) {
  const sortedCharts = [...chartConfigs].sort((a, b) => a.order - b.order)
  const countyFips = snapshot.location.countyFips
  const [county, setCounty] = useState<{ fips: string; data: CountyPulse | null } | null>(null)
  const [meta, setMeta] = useState<PulseMeta | null>(null)

  useEffect(() => {
    let live = true
    fetchCounty(countyFips)
      .then(c => { if (live) setCounty({ fips: countyFips, data: c }) })
      .catch(() => { if (live) setCounty({ fips: countyFips, data: null }) })
    fetchPulseMeta().then(m => { if (live) setMeta(m) }).catch(() => {})
    return () => { live = false }
  }, [countyFips])

  const countyData = county?.fips === countyFips ? county.data : null
  const metaPreliminaryMonth = meta?.sources.laus?.preliminaryExcluded

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mt-12"
      data-testid="charts-section"
    >
      <h2 className="text-2xl font-bebas text-white mb-6">Trends Over Time</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sortedCharts.map(config => {
          const input = getChartInput(config.id, snapshot, { metaPreliminaryMonth })
          const mergedConfig: ChartConfig = { ...config, ...input.configOverrides }
          return (
            <EraChart
              key={config.id}
              config={mergedConfig}
              data={input.data}
              nationalData={input.nationalData}
              provenance={input.provenance}
              stale={input.stale}
              weeklyGasBaseline={input.weeklyGasBaseline}
              nationalLabel={input.nationalLabel}
              headline={config.id === 'unemployment'
                ? <UnemploymentHeadline county={countyData} meta={meta} countyName={snapshot.location.countyName} chartArea={unemploymentAreaLabel(snapshot)}
                    chartPreliminary={preliminaryMonths(snapshot.unemployment.data, metaPreliminaryMonth)} />
                : undefined}
              note={input.note}
            />
          )
        })}
      </div>
    </motion.section>
  )
}
