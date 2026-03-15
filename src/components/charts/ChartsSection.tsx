'use client'
import { motion } from 'framer-motion'
import { chartConfigs } from '@/lib/charts/chart-config'
import { EraChart } from './EraChart'
import type { EconomicSnapshot } from '@/types'

interface ChartsSectionProps {
  snapshot: EconomicSnapshot
}

// Map chart config IDs to the right data from the snapshot
function getChartData(
  id: string,
  snapshot: EconomicSnapshot
): Array<{ date: string; [key: string]: unknown }> {
  switch (id) {
    case 'unemployment':
      return snapshot.unemployment.data?.series.map(p => ({
        date: p.date,
        rate: p.rate,
      })) ?? []
    case 'cpi':
      return snapshot.cpi.data?.series.map(p => ({
        date: p.date,
        groceries: p.groceries,
        shelter: p.shelter,
        energy: p.energy,
      })) ?? []
    case 'gas':
      return snapshot.gas.data?.series.map(p => ({
        date: p.date,
        price: p.price,
      })) ?? []
    default:
      return []
  }
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sortedCharts.map(config => (
          <EraChart
            key={config.id}
            config={config}
            data={getChartData(config.id, snapshot)}
          />
        ))}
      </div>
    </motion.section>
  )
}
