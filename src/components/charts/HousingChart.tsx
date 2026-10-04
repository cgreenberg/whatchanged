'use client'
import { useEffect, useState } from 'react'
import { EraChart, ChartHeadline } from './EraChart'
import { getChartInput, type ChartInput } from './chart-inputs'
import { housingTabConfigs, type ChartConfig } from '@/lib/charts/chart-config'
import {
  fetchCounty, fetchUsHousing, seriesRows, seriesChangeSinceBaseline, flagNote, fmtMoney,
  type CountyRecord, type UsHousing,
} from '@/lib/county-data'
import { fmtMonthYear } from '@/lib/format'
import type { EconomicSnapshot } from '@/types'
import { monthOlderThan, RENT_STALE_DAYS, HOUSING_NOTE } from '@/lib/hero-cards'
import { LADDERS } from '@/lib/resolution/ladders'
import { resolveLadderSync } from '@/lib/resolution/resolve'
import type { TraceStep } from '@/lib/resolution/types'

export type HousingTab = 'rent' | 'homePrices' | 'shelter'

const TABS: Array<{ key: HousingTab; label: string }> = [
  { key: 'rent', label: 'Rent' },
  { key: 'homePrices', label: 'Home prices' },
  { key: 'shelter', label: 'Shelter (CPI)' },
]

const ZILLOW_URL = 'https://www.zillow.com/research/data/'
const ZILLOW_RENT_ADJ = 'seasonally adjusted by whatchanged'
const ZILLOW_HV_ADJ = 'smoothed and seasonally adjusted by Zillow'
/** The one short line under each Zillow tab; the full description and the CPI-vs-Zillow note are in the graph's ⓘ. */
export const ZORI_SHORT_NOTE = 'Asking rents on new leases (Zillow), same series as the Rent card.'
export const ZHVI_SHORT_NOTE = 'Typical home value (Zillow), smoothed and seasonally adjusted.'

type CountyState = { status: 'loading' } | { status: 'ok'; data: CountyRecord | null } | { status: 'error' }

/**
 * Inputs for a Zillow tab from the county shard (+ the U.S. series for "Show national"). Stale badge
 * when the series' latest month ended more than RENT_STALE_DAYS ago (same rule as the Rent card).
 */
export function zillowTabInput(
  tab: 'rent' | 'homePrices', county: CountyRecord | null, us: UsHousing | null, geoName: string, now: Date = new Date(),
): ChartInput {
  const rent = tab === 'rent'
  const data = seriesRows(rent ? county?.rentS : county?.hvS, rent ? 'rent' : 'hv')
  const nationalData = seriesRows(rent ? us?.rentS : us?.hvS, rent ? 'rent' : 'hv')
  return {
    data,
    nationalData,
    stale: monthOlderThan(data[data.length - 1]?.date, RENT_STALE_DAYS, now),
    nationalLabel: nationalData.length ? (rent ? 'U.S. ZORI' : 'U.S. ZHVI') : undefined,
    provenance: {
      source: rent ? 'Zillow ZORI' : 'Zillow Home Value Index (ZHVI)',
      sourceUrl: ZILLOW_URL,
      geography: `${geoName}, monthly`,
      adjustment: rent ? ZILLOW_RENT_ADJ : ZILLOW_HV_ADJ,
    },
  }
}

/**
 * Trace for the Home prices tab: the home-prices ladder resolved here, against the county shard (the
 * series ships only in the static per-state shard, so the server snapshot doesn't carry it).
 */
export function homePricesTrace(location: EconomicSnapshot['location'], county: CountyRecord | null, now: Date = new Date()): TraceStep[] {
  const rows = seriesRows(county?.hvS, 'hv')
  return resolveLadderSync(LADDERS.homePrices, location, {
    now,
    countyHomeValue: () => (rows.length ? { asOf: rows[rows.length - 1].date } : null),
  }).steps
}

/** Housing graph: Rent (Zillow ZORI) | Home prices (Zillow ZHVI) | Shelter (CPI). */
export function HousingChart({ snapshot, shelterConfig }: { snapshot: EconomicSnapshot; shelterConfig: ChartConfig }) {
  const countyFips = snapshot.location.countyFips
  const countyLabel = snapshot.rent?.geoName ?? `${snapshot.location.countyName}, ${snapshot.location.stateAbbr}`
  const [county, setCounty] = useState<CountyState>({ status: 'loading' })
  const [us, setUs] = useState<UsHousing | null>(null)
  const [choice, setChoice] = useState<HousingTab | null>(null)

  useEffect(() => {
    let live = true
    fetchCounty(countyFips)
      .then(c => { if (live) setCounty({ status: 'ok', data: c }) })
      .catch(() => { if (live) setCounty({ status: 'error' }) })
    fetchUsHousing().then(u => { if (live) setUs(u) }).catch(() => {})
    return () => { live = false }
  }, [countyFips])

  const c = county.status === 'ok' ? county.data : null
  const geoName = c?.n ?? countyLabel
  const hasRent = county.status === 'loading' ? !!snapshot.rent : seriesRows(c?.rentS, 'rent').length > 0
  const hasHv = county.status === 'loading' ? true : seriesRows(c?.hvS, 'hv').length > 0
  const available: Record<HousingTab, boolean> = { rent: hasRent, homePrices: hasHv, shelter: true }
  const fallback: HousingTab = hasRent ? 'rent' : 'shelter'
  const active: HousingTab = choice && available[choice] ? choice : fallback

  const missing = TABS.filter(t => !available[t.key]).map(t => t.key)
  const missingNote = county.status === 'error'
    ? 'Zillow data is unavailable right now.'
    : missing.length
      ? `No Zillow ${missing.map(k => (k === 'rent' ? 'rent' : 'home price')).join(' or ')} data for ${geoName}.`
      : null

  const tabs = (
    <div className="mb-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Housing measure">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            disabled={!available[t.key]}
            onClick={() => setChoice(t.key)}
            data-testid={`housing-tab-${t.key}`}
            className={`px-3 py-1 rounded-full text-xs border transition disabled:opacity-40 disabled:cursor-not-allowed ${
              active === t.key ? 'bg-blue-500 text-white border-blue-500 font-semibold' : 'border-zinc-700 text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {missingNote && <p className="text-[11px] text-zinc-500 mt-1" data-testid="housing-missing-note">{missingNote}</p>}
    </div>
  )

  // Zillow tab whose county shard is still loading: hold the space instead of flashing "Data unavailable".
  if (active !== 'shelter' && county.status === 'loading') {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4" data-testid="housing-chart" data-tab={active}>
        <h3 className="text-sm font-inter font-medium text-zinc-300 mb-2">{shelterConfig.title}</h3>
        {tabs}
        <div className="h-64 rounded-lg bg-zinc-800/40 animate-pulse" />
      </div>
    )
  }

  let input: ChartInput
  let config: ChartConfig
  let headline: React.ReactNode = null
  if (active === 'shelter') {
    input = getChartInput('cpi-shelter', snapshot)
    config = shelterConfig
    const pct = snapshot.cpi.data?.shelterChange
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      headline = <ChartHeadline testId="housing-headline" pct={pct} detail="CPI shelter (all renters and homeowners)" />
    }
  } else {
    input = zillowTabInput(active, c, us, geoName)
    config = active === 'rent' ? housingTabConfigs.rent : housingTabConfigs.homePrices
    const series = active === 'rent' ? c?.rentS : c?.hvS
    const pct = seriesChangeSinceBaseline(series)
    const level = active === 'rent' ? c?.rentCur : c?.hvCur
    const last = input.data[input.data.length - 1]?.date
    const caveat = flagNote(c, active === 'rent' ? 'rent' : 'hv')
    if (pct != null) {
      headline = (
        <ChartHeadline
          testId="housing-headline"
          pct={pct}
          detail={level
            ? active === 'rent'
              ? `typical asking rent ${fmtMoney(level)}/mo${last ? ` (${fmtMonthYear(last)}, observed)` : ''}`
              : `typical home ${fmtMoney(level)}${last ? ` (${fmtMonthYear(last)})` : ''}`
            : undefined}
          caveat={caveat}
        />
      )
    }
    input = {
      ...input,
      note: active === 'rent' ? ZORI_SHORT_NOTE : ZHVI_SHORT_NOTE,
      info: [HOUSING_NOTE],
    }
  }

  return (
    <div className="min-w-0" data-testid="housing-chart" data-tab={active}>
      <EraChart
        key={active}
        config={config}
        data={input.data}
        nationalData={input.nationalData}
        provenance={input.provenance}
        stale={input.stale}
        nationalLabel={input.nationalLabel}
        headline={<>{tabs}{headline}</>}
        note={input.note}
        info={input.info}
        trace={active === 'shelter' ? snapshot.trace?.shelter : active === 'rent' ? snapshot.trace?.rent : homePricesTrace(snapshot.location, c)}
      />
    </div>
  )
}
