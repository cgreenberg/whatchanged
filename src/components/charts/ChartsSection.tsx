'use client'
import { motion } from 'framer-motion'
import { chartConfigs } from '@/lib/charts/chart-config'
import type { ChartConfig } from '@/lib/charts/chart-config'
import { EraChart, ChartHeadline } from './EraChart'
import { HousingChart } from './HousingChart'
import { getChartInput } from './chart-inputs'
import type { EconomicSnapshot } from '@/types'

export { getChartInput, NOT_SA, type ChartInput, type ChartProvenance } from './chart-inputs'

interface ChartsSectionProps {
  snapshot: EconomicSnapshot
}

/** One plain (non-tabbed) chart from its config. */
function PlainChart({ config, snapshot }: { config: ChartConfig; snapshot: EconomicSnapshot }) {
  const input = getChartInput(config.id, snapshot)
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
      headline={input.headline ? <ChartHeadline pct={input.headline.pct} detail={input.headline.detail} /> : undefined}
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
      className="mt-12"
      data-testid="charts-section"
    >
      <h2 className="text-2xl font-bebas text-white mb-6">Trends Over Time</h2>
      {/* 2 × 2 on tablet/desktop (Gas | Groceries, Housing | Electricity, by config order); one column under 768px */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="charts-grid">
        {sortedCharts.map(config =>
          config.id === 'cpi-shelter'
            ? <HousingChart key={`housing-${snapshot.location.countyFips}`} snapshot={snapshot} shelterConfig={config} />
            : <PlainChart key={config.id} config={config} snapshot={snapshot} />
        )}
      </div>
    </motion.section>
  )
}
