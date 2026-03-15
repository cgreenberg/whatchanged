'use client'
import { useState, useMemo } from 'react'
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend,
  ReferenceArea, ReferenceLine,
  CartesianGrid,
} from 'recharts'
import type { ChartConfig, Timeframe } from '@/lib/charts/chart-config'
import { TimeframeToggle } from './TimeframeToggle'
import { computeTrendline } from '@/lib/charts/trendline'

// Political era boundaries
const BIDEN_START = '2021-01'
const BIDEN_END = '2025-01'
const TRUMP2_START = '2025-01'

interface EraChartProps {
  config: ChartConfig
  data: Array<{ date: string; [key: string]: unknown }>
}

function filterByTimeframe(
  data: Array<{ date: string }>,
  tf: Timeframe
): Array<{ date: string }> {
  const now = new Date()
  const yearsBack = tf === '1Y' ? 1 : tf === '3Y' ? 3 : tf === '5Y' ? 5 : 10
  const cutoff = new Date(now.getFullYear() - yearsBack, now.getMonth(), 1)
  const cutoffStr = cutoff.toISOString().slice(0, 7)
  return data.filter(d => d.date >= cutoffStr)
}

function formatDateLabel(dateStr: string): string {
  // "2025-01" → "Jan '25"
  const [year, month] = dateStr.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const m = parseInt(month, 10) - 1
  return `${months[m] ?? month} '${year.slice(2)}`
}

export function EraChart({ config, data }: EraChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(config.defaultTimeframe)

  const filteredData = useMemo(() => filterByTimeframe(data, timeframe), [data, timeframe])

  // Merge trendline data if enabled
  const chartData = useMemo(() => {
    if (!config.trendline || !config.series[0]) return filteredData
    const trendData = computeTrendline(
      filteredData as Array<{ date: string; [key: string]: unknown }>,
      config.series[0].dataKey
    )
    return filteredData.map((d, i) => ({ ...d, trend: trendData[i]?.trend }))
  }, [filteredData, config.trendline, config.series])

  if (!chartData.length) {
    return (
      <div
        className={`bg-zinc-900 border border-zinc-800 rounded-xl p-4 ${
          config.size === 'large'
            ? 'col-span-full'
            : config.size === 'medium'
              ? 'col-span-full sm:col-span-2'
              : ''
        }`}
        data-testid={`chart-${config.id}`}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-inter font-medium text-zinc-300">{config.title}</h3>
          <TimeframeToggle selected={timeframe} onChange={setTimeframe} />
        </div>
        <div className="h-64 flex items-center justify-center">
          <p className="text-zinc-600 text-sm font-inter">Data unavailable</p>
        </div>
      </div>
    )
  }

  // Determine date range for era shading
  const firstDate = chartData[0]?.date ?? ''
  const lastDate = chartData[chartData.length - 1]?.date ?? ''

  // Era shading using date strings directly as x1/x2 (XAxis dataKey="date")
  const eraElements = config.eraShading ? (
    <>
      {firstDate <= BIDEN_END && lastDate >= BIDEN_START && (
        <ReferenceArea
          x1={firstDate > BIDEN_START ? firstDate : BIDEN_START}
          x2={lastDate < BIDEN_END ? lastDate : BIDEN_END}
          fill="rgba(59, 130, 246, 0.07)"
          strokeOpacity={0}
        />
      )}
      {lastDate >= TRUMP2_START && (
        <ReferenceArea
          x1={firstDate > TRUMP2_START ? firstDate : TRUMP2_START}
          x2={lastDate}
          fill="rgba(239, 68, 68, 0.07)"
          strokeOpacity={0}
        />
      )}
      {firstDate <= '2021-01' && lastDate >= '2021-01' && (
        <ReferenceLine
          x="2021-01"
          stroke="#6B7280"
          strokeDasharray="3 3"
          label={{ value: 'Jan 2021', position: 'top', fontSize: 10, fill: '#6B7280' }}
        />
      )}
      {firstDate <= '2025-01' && lastDate >= '2025-01' && (
        <ReferenceLine
          x="2025-01"
          stroke="#6B7280"
          strokeDasharray="3 3"
          label={{ value: 'Jan 2025', position: 'top', fontSize: 10, fill: '#6B7280' }}
        />
      )}
    </>
  ) : null

  const renderSeries = () => {
    return config.series.map(s => {
      if (config.chartType === 'area') {
        return (
          <Area
            key={s.dataKey}
            type={s.type ?? 'monotone'}
            dataKey={s.dataKey}
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.1}
            strokeWidth={2}
            name={s.label}
            dot={false}
          />
        )
      } else if (config.chartType === 'bar') {
        return (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            fill={s.color}
            name={s.label}
          />
        )
      } else {
        return (
          <Line
            key={s.dataKey}
            type={s.type ?? 'monotone'}
            dataKey={s.dataKey}
            stroke={s.color}
            strokeWidth={2}
            name={s.label}
            dot={false}
          />
        )
      }
    })
  }

  // Add trendline if enabled
  const trendlineElement = config.trendline ? (
    <Line
      key="trend"
      type="linear"
      dataKey="trend"
      stroke="#9CA3AF"
      strokeWidth={1}
      strokeDasharray="6 3"
      name="Trend"
      dot={false}
    />
  ) : null

  // Common axis/tooltip/grid elements
  const commonElements = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
      <XAxis
        dataKey="date"
        tickFormatter={formatDateLabel}
        tick={{ fontSize: 11, fill: '#6B7280' }}
        interval="preserveStartEnd"
        stroke="#27272A"
      />
      <YAxis
        tick={{ fontSize: 11, fill: '#6B7280' }}
        width={45}
        stroke="#27272A"
        domain={config.yAxisDomain ?? ['auto', 'auto']}
        tickFormatter={config.formatValue}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: '#18181B',
          border: '1px solid #3F3F46',
          borderRadius: '8px',
          fontSize: 12,
        }}
        labelFormatter={(label: unknown) =>
          typeof label === 'string' ? formatDateLabel(label) : String(label)
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter={(value: any) =>
          typeof value === 'number' && config.formatValue
            ? config.formatValue(value)
            : String(value ?? '')
        }
      />
      <Legend wrapperStyle={{ fontSize: 11, color: '#A1A1AA' }} />
      {eraElements}
      {renderSeries()}
      {trendlineElement}
    </>
  )

  const ChartComponent =
    config.chartType === 'area' ? AreaChart
    : config.chartType === 'bar' ? BarChart
    : LineChart

  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 rounded-xl p-4 ${
        config.size === 'large'
          ? 'col-span-full'
          : config.size === 'medium'
            ? 'col-span-full sm:col-span-2'
            : ''
      }`}
      data-testid={`chart-${config.id}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-inter font-medium text-zinc-300">{config.title}</h3>
        <TimeframeToggle selected={timeframe} onChange={setTimeframe} />
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={chartData}>
            {commonElements}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
