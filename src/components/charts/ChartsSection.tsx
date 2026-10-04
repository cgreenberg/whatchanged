'use client'
import { motion } from 'framer-motion'
import { chartConfigs } from '@/lib/charts/chart-config'
import type { ChartConfig } from '@/lib/charts/chart-config'
import { EraChart, ChartHeadline } from './EraChart'
import { HousingChart } from './HousingChart'
import { HeatingChart } from './HeatingChart'
import { getChartInput } from './chart-inputs'
import { BASELINE_DAY_LABEL } from '@/lib/baseline'
import type { EconomicSnapshot } from '@/types'
import type { TraceMetric } from '@/lib/resolution/types'

export { getChartInput, NOT_SA, type ChartInput, type ChartProvenance } from './chart-inputs'

interface ChartsSectionProps {
  snapshot: EconomicSnapshot
}

/** One plain (non-tabbed) chart from its config. */
/** Ladder trace behind each plain graph. */
const TRACE_FOR_CHART: Record<string, TraceMetric> = { gas: 'gas', 'cpi-groceries': 'groceries', electricity: 'electricity' }

function PlainChart({ config, snapshot }: { config: ChartConfig; snapshot: EconomicSnapshot }) {
  const input = getChartInput(config.id, snapshot)
  const metric = TRACE_FOR_CHART[config.id]
  return (
    <EraChart
      config={{ ...config, ...input.configOverrides }}
      data={input.data}
      nationalData={input.nationalData}
      provenance={input.provenance}
      stale={input.stale}
      weeklyGasBaseline={input.weeklyGasBaseline}
      nationalLabel={input.nationalLabel}
      note={input.note}
      info={input.info}
      trace={metric ? snapshot.trace?.[metric] : undefined}
      headline={input.headline ? <ChartHeadline pct={input.headline.pct} detail={input.headline.detail} window={input.headline.window} dim={input.headline.dim} /> : undefined}
    />
  )
}

export function ChartsSection({ snapshot }: ChartsSectionProps) {
  const sortedCharts = [...chartConfigs].sort((a, b) => a.order - b.order)

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mt-14"
      data-testid="charts-section"
    >
      <div className="border-t border-line pt-5 mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div>
          <p className="kicker text-ink-3">The record</p>
          <h2 className="mt-1 font-display font-semibold text-3xl sm:text-[34px] leading-none tracking-tight text-ink">Trends over time</h2>
        </div>
        <p className="text-[12px] text-ink-3 max-w-sm">
          Gray field: since the {BASELINE_DAY_LABEL} baseline. Labels at right: latest value.
        </p>
      </div>
      {/* 2 × 2 on tablet/desktop (Gas | Groceries, Housing | Electricity, by config order), then Home heating
          where it has data; one column under 768px */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4" data-testid="charts-grid">
        {sortedCharts.map(config =>
          config.id === 'cpi-shelter'
            ? <HousingChart key={`housing-${snapshot.location.countyFips}`} snapshot={snapshot} shelterConfig={config} />
            : <PlainChart key={config.id} config={config} snapshot={snapshot} />
        )}
        {/* 5th graph, only where a heating-fuel source publishes for the place */}
        <HeatingChart snapshot={snapshot} />
      </div>
    </motion.section>
  )
}
