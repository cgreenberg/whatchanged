'use client'
import { motion } from 'framer-motion'
import { chartConfigs } from '@/lib/charts/chart-config'
import type { ChartConfig } from '@/lib/charts/chart-config'
import { EraChart } from './EraChart'
import type { EconomicSnapshot } from '@/types'

interface ChartsSectionProps {
  snapshot: EconomicSnapshot
}

// Map chart config IDs to the right data from the snapshot
function getChartData(
  id: string,
  snapshot: EconomicSnapshot
): {
  data: Array<{ date: string; [key: string]: unknown }>
  nationalData: Array<{ date: string; [key: string]: unknown }>
  configOverrides: Partial<ChartConfig>
} {
  switch (id) {
    case 'unemployment': {
      const unemploymentData = snapshot.unemployment.data
      const seriesId = unemploymentData?.seriesId
      return {
        data: unemploymentData?.series.map(p => ({
          date: p.date,
          rate: p.rate,
        })) ?? [],
        nationalData: unemploymentData?.nationalSeries?.map(p => ({
          date: p.date,
          rate: p.rate,
        })) ?? [],
        configOverrides: seriesId
          ? { sourceUrl: `https://data.bls.gov/timeseries/${seriesId}` }
          : {},
      }
    }
    case 'cpi': {
      const cpiData = snapshot.cpi.data
      const metro = cpiData?.metro
      const seriesIds = cpiData?.seriesIds
      const isNational = metro === 'National'
      return {
        data: cpiData?.series.map(p => ({
          date: p.date,
          groceries: p.groceries,
          shelter: p.shelter,
          energy: p.energy,
        })) ?? [],
        nationalData: cpiData?.nationalSeries?.map(p => ({
          date: p.date,
          groceries: p.groceries,
          shelter: p.shelter,
          energy: p.energy,
        })) ?? [],
        configOverrides: {
          ...(metro ? { sourceLabel: `BLS CPI — ${metro}`, geoLevel: isNational ? 'National' : `Metro: ${metro}` } : {}),
          ...(seriesIds ? { sourceUrl: `https://data.bls.gov/timeseries/${seriesIds.groceries}` } : {}),
        },
      }
    }
    case 'gas':
      return {
        data: snapshot.gas.data?.series.map(p => ({
          date: p.date,
          price: p.price,
        })) ?? [],
        nationalData: [],
        configOverrides: {},
      }
    default:
      return { data: [], nationalData: [], configOverrides: {} }
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
        {sortedCharts.map(config => {
          const { data, nationalData, configOverrides } = getChartData(config.id, snapshot)
          const mergedConfig: ChartConfig = { ...config, ...configOverrides }
          return (
            <EraChart
              key={config.id}
              config={mergedConfig}
              data={data}
              nationalData={nationalData}
            />
          )
        })}
      </div>
    </motion.section>
  )
}
