'use client'
import { useState } from 'react'
import { EraChart, ChartHeadline } from './EraChart'
import { getHeatingInput } from './chart-inputs'
import { heatingTabConfigs } from '@/lib/charts/chart-config'
import type { EconomicSnapshot } from '@/types'

export type HeatingTab = 'oil' | 'propane'

const TABS: Array<{ key: HeatingTab; label: string }> = [
  { key: 'oil', label: 'Heating oil' },
  { key: 'propane', label: 'Propane' },
]

/** Tabs a place gets: only fuels some source publishes there (a covered fuel whose source failed still shows). */
export function heatingTabs(snapshot: EconomicSnapshot): HeatingTab[] {
  return TABS.filter(t => !!snapshot.heating?.[t.key]).map(t => t.key)
}

/**
 * Home heating graph (after Electricity; not a hero card): Heating oil | Propane, tabs only where data exists,
 * and no graph at all where neither fuel has a source.
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
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Heating fuel">
        {TABS.filter(t => available.includes(t.key)).map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setChoice(t.key)}
            data-testid={`heating-tab-${t.key}`}
            className={`px-3 py-1 rounded-full text-xs border transition ${
              active === t.key ? 'bg-orange-500 text-white border-orange-500 font-semibold' : 'border-zinc-700 text-zinc-300'
            }`}
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
        headline={<>{tabs}{input.headline ? <ChartHeadline testId="heating-headline" pct={input.headline.pct} detail={input.headline.detail} /> : null}</>}
        note={input.note}
        info={input.info}
        trace={snapshot.trace?.[active === 'oil' ? 'heatingOil' : 'propane']}
      />
    </div>
  )
}
