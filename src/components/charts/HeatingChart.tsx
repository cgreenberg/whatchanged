'use client'
import { useState } from 'react'
import { EraChart, ChartHeadline } from './EraChart'
import { getHeatingInput } from './chart-inputs'
import { heatingTabConfigs } from '@/lib/charts/chart-config'
import type { EconomicSnapshot } from '@/types'
import { isHeatingFuelRelevant } from '@/lib/heating-relevance'

export type HeatingTab = 'oil' | 'propane'

const TABS: Array<{ key: HeatingTab; label: string }> = [
  { key: 'oil', label: 'Heating oil' },
  { key: 'propane', label: 'Propane' },
]

/**
 * Tabs a place gets: fuels some source publishes there (a covered fuel whose source failed still shows) AND that
 * at least 5% of the state's homes heat with (Census ACS B25040), so the graph only appears where the fuel matters.
 */
export function heatingTabs(snapshot: EconomicSnapshot): HeatingTab[] {
  const st = snapshot.location?.stateAbbr
  return TABS.filter(t => !!snapshot.heating?.[t.key] && isHeatingFuelRelevant(st, t.key)).map(t => t.key)
}

/**
 * Home heating graph (after Electricity; not a hero card): Heating oil | Propane, tabs only where data exists and
 * the fuel matters in the state, and no graph at all otherwise.
 */
export function HeatingChart({ snapshot }: { snapshot: EconomicSnapshot }) {
  const available = heatingTabs(snapshot)
  const [choice, setChoice] = useState<HeatingTab | null>(null)
  if (!available.length) return null
  const withData = available.filter(k => !!snapshot.heating?.[k]?.data)
  const active: HeatingTab = choice && available.includes(choice) ? choice : withData[0] ?? available[0]
  const input = getHeatingInput(active, snapshot)
  const tabs = (
    <div className="mb-3">
      <div className="flex flex-wrap gap-x-5 border-b border-line" role="tablist" aria-label="Heating fuel">
        {TABS.filter(t => available.includes(t.key)).map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setChoice(t.key)}
            data-testid={`heating-tab-${t.key}`}
            className={`-mb-px pb-1.5 pt-0.5 text-[13px] border-b-2 transition-colors focus:outline-none focus-visible:text-ink ${
              active === t.key ? 'text-ink font-semibold' : 'border-transparent text-ink-3 hover:text-ink-2'
            }`}
            style={active === t.key ? { borderColor: heatingTabConfigs[t.key].series[0].color } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="min-w-0" data-testid="heating-chart" data-tab={active}>
      <EraChart
        key={active}
        config={heatingTabConfigs[active]}
        data={input.data}
        nationalData={input.nationalData}
        provenance={input.provenance}
        stale={input.stale}
        weeklyGasBaseline
        nationalLabel={input.nationalLabel}
        headline={<>{tabs}{input.headline ? <ChartHeadline testId="heating-headline" pct={input.headline.pct} detail={input.headline.detail} window={input.headline.window} dim={input.headline.dim} /> : null}</>}
        note={input.note}
        info={input.info}
        trace={snapshot.trace?.[active === 'oil' ? 'heatingOil' : 'propane']}
      />
    </div>
  )
}
