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

// Political era boundaries (use full date prefix for correct string comparison with any format)
const TRUMP1_START = '2017-01'
const TRUMP1_END = '2021-01'
const BIDEN_START = '2021-01'
const BIDEN_END = '2025-01'
const TRUMP2_START = '2025-01'

// Find the closest data point date at or after a boundary
function findClosestDate(dates: string[], boundary: string, direction: 'atOrAfter' | 'atOrBefore'): string | null {
  if (direction === 'atOrAfter') {
    return dates.find(d => d >= boundary) ?? null
  }
  // atOrBefore: last date that is <= boundary
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] <= boundary + '\uffff') return dates[i]
  }
  return null
}

interface EraChartProps {
  config: ChartConfig
  data: Array<{ date: string; [key: string]: unknown }>
  nationalData?: Array<{ date: string; [key: string]: unknown }>
}

function filterByTimeframe(
  data: Array<{ date: string }>,
  tf: Timeframe
): Array<{ date: string }> {
  if (tf === 'Jan 2025') {
    return data.filter(d => d.date >= '2025-01')
  }
  const now = new Date()
  const yearsBack = tf === '3Y' ? 3 : tf === '5Y' ? 5 : 10
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

export function EraChart({ config, data, nationalData }: EraChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(config.defaultTimeframe)
  const [showNational, setShowNational] = useState(false)

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

  // Merge national data into chartData when showNational is enabled
  const mergedData = useMemo((): Array<{ date: string; [key: string]: unknown }> => {
    if (!showNational || !nationalData?.length) return chartData
    const nationalMap = new Map(nationalData.map(d => [d.date, d]))
    return chartData.map(d => {
      const nd = nationalMap.get(d.date as string)
      if (!nd) return d
      const merged: { date: string; [key: string]: unknown } = { ...d }
      for (const key of Object.keys(nd)) {
        if (key !== 'date') merged[`national_${key}`] = nd[key]
      }
      return merged
    })
  }, [chartData, showNational, nationalData])

  // Normalize to percentage change from first visible data point
  const displayData = useMemo((): Array<{ date: string; [key: string]: unknown }> => {
    if (!config.normalizeToBaseline || !mergedData.length) return mergedData
    const first = mergedData[0]
    return mergedData.map(d => {
      const normalized: { date: string; [key: string]: unknown } = { date: d.date }
      for (const key of Object.keys(d)) {
        if (key === 'date') continue
        const val = d[key]
        const baseVal = first[key]
        if (typeof val === 'number' && typeof baseVal === 'number' && baseVal !== 0) {
          normalized[key] = ((val - baseVal) / baseVal) * 100
        } else {
          normalized[key] = val
        }
      }
      return normalized
    })
  }, [mergedData, config.normalizeToBaseline])

  if (!displayData.length) {
    return (
      <div
        className={`bg-zinc-900 border border-zinc-800 rounded-xl p-4 ${
          config.size === 'large'
            ? 'col-span-full'
            : config.size === 'medium'
              ? 'sm:col-span-1'
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
  const firstDate = displayData[0]?.date ?? ''
  const lastDate = displayData[displayData.length - 1]?.date ?? ''

  // Build era shading using actual data point dates (handles both monthly and weekly formats)
  const allDates = displayData.map(d => d.date)

  const eraElements = config.eraShading ? (
    <>
      {/* Trump I: Jan 2017 – Jan 2021 (red) */}
      {firstDate < TRUMP1_END + '\uffff' && lastDate >= TRUMP1_START && (() => {
        const x1 = findClosestDate(allDates, TRUMP1_START, 'atOrAfter') ?? allDates[0]
        const x2 = findClosestDate(allDates, TRUMP1_END, 'atOrBefore') ?? allDates[allDates.length - 1]
        return x1 && x2 ? (
          <ReferenceArea x1={x1} x2={x2} fill="rgba(239, 68, 68, 0.15)" strokeOpacity={0} />
        ) : null
      })()}
      {/* Biden: Jan 2021 – Jan 2025 (blue) */}
      {firstDate < BIDEN_END + '\uffff' && lastDate >= BIDEN_START && (() => {
        const x1 = findClosestDate(allDates, BIDEN_START, 'atOrAfter') ?? allDates[0]
        const x2 = findClosestDate(allDates, BIDEN_END, 'atOrBefore') ?? allDates[allDates.length - 1]
        return x1 && x2 ? (
          <ReferenceArea x1={x1} x2={x2} fill="rgba(59, 130, 246, 0.15)" strokeOpacity={0} />
        ) : null
      })()}
      {/* Trump II: Jan 2025 – present (red) */}
      {lastDate >= TRUMP2_START && (() => {
        const x1 = findClosestDate(allDates, TRUMP2_START, 'atOrAfter')
        return x1 ? (
          <ReferenceArea x1={x1} x2={allDates[allDates.length - 1]} fill="rgba(239, 68, 68, 0.15)" strokeOpacity={0} />
        ) : null
      })()}
      {/* Reference lines at transitions */}
      {(() => {
        const jan2021 = findClosestDate(allDates, '2021-01', 'atOrAfter')
        return jan2021 && firstDate <= '2021-01\uffff' && lastDate >= '2021-01' ? (
          <ReferenceLine x={jan2021} stroke="#6B7280" strokeDasharray="3 3"
            label={{ value: 'Jan 2021', position: 'top', fontSize: 10, fill: '#6B7280' }} />
        ) : null
      })()}
      {(() => {
        const jan2025 = findClosestDate(allDates, '2025-01', 'atOrAfter')
        return jan2025 && firstDate <= '2025-01\uffff' && lastDate >= '2025-01' ? (
          <ReferenceLine x={jan2025} stroke="#6B7280" strokeDasharray="3 3"
            label={{ value: 'Jan 2025', position: 'top', fontSize: 10, fill: '#6B7280' }} />
        ) : null
      })()}
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

  // National overlay lines (dotted) when showNational is enabled
  const nationalLines = showNational ? config.series.map(s => (
    <Line
      key={`national_${s.dataKey}`}
      type={s.type ?? 'monotone'}
      dataKey={`national_${s.dataKey}`}
      stroke={s.color}
      strokeWidth={1}
      strokeDasharray="6 3"
      strokeOpacity={0.5}
      name={`${s.label} (National)`}
      dot={false}
    />
  )) : null

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
      {nationalLines}
      {trendlineElement}
    </>
  )

  const ChartComponent =
    config.chartType === 'area' ? AreaChart
    : config.chartType === 'bar' ? BarChart
    : LineChart

  const hasNationalData = (nationalData?.length ?? 0) > 0

  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 rounded-xl p-4 ${
        config.size === 'large'
          ? 'col-span-full'
          : config.size === 'medium'
            ? 'sm:col-span-1'
            : ''
      }`}
      data-testid={`chart-${config.id}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-inter font-medium text-zinc-300">{config.title}</h3>
        <div className="flex items-center gap-3">
          {config.showNationalToggle && hasNationalData && (
            <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showNational}
                onChange={e => setShowNational(e.target.checked)}
                className="rounded border-zinc-600"
              />
              Show national
            </label>
          )}
          <TimeframeToggle selected={timeframe} onChange={setTimeframe} />
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={displayData}>
            {commonElements}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
      {(config.sourceLabel || config.geoLevel) && (
        <div className="mt-2 pt-2 border-t border-zinc-800 text-xs text-zinc-500">
          {config.sourceUrl ? (
            <a href={config.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-300">
              {config.sourceLabel}
            </a>
          ) : config.sourceLabel}
          {config.geoLevel && <span> · {config.geoLevel}</span>}
        </div>
      )}
    </div>
  )
}
