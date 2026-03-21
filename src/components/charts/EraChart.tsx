'use client'
import React, { useState, useMemo } from 'react'
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

// Era boundaries at month level — works for both monthly ('2025-01') and weekly ('2025-01-06') data
// Monthly: '2025-01' >= '2025-01' → Trump II. Clean.
// Weekly: '2025-01-06' >= '2025-01' → Trump II. Jan 1-19 technically Biden but ~clean enough.
const TRUMP1_START = '2017-01'
const BIDEN_START = '2021-01'
const TRUMP2_START = '2025-01'

// Find first data point date >= boundary
function findDateAtOrAfter(dates: string[], boundary: string): string | null {
  return dates.find(d => d >= boundary) ?? null
}

// Compute the date range in months between two date strings
function computeDateRangeMonths(firstDate: string, lastDate: string): number {
  const [y1, m1] = firstDate.split('-').map(Number)
  const [y2, m2] = lastDate.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1)
}

// Generate tick dates snapped to Jan/Jul boundaries
function generateTicks(firstDate: string, lastDate: string): string[] {
  const rangeMonths = computeDateRangeMonths(firstDate, lastDate)
  const [startYear, startMonth] = firstDate.split('-').map(Number)
  const [endYear, endMonth] = lastDate.split('-').map(Number)

  const ticks: string[] = []

  if (rangeMonths < 6) {
    // Monthly ticks
    for (let y = startYear; y <= endYear; y++) {
      const mStart = y === startYear ? startMonth : 1
      const mEnd = y === endYear ? endMonth : 12
      for (let m = mStart; m <= mEnd; m++) {
        ticks.push(`${y}-${String(m).padStart(2, '0')}`)
      }
    }
  } else if (rangeMonths <= 36) {
    // 6-month ticks (Jan + Jul)
    for (let y = startYear; y <= endYear + 1; y++) {
      ticks.push(`${y}-01`)
      ticks.push(`${y}-07`)
    }
  } else if (rangeMonths <= 72) {
    // 6-month ticks (Jan + Jul)
    for (let y = startYear; y <= endYear + 1; y++) {
      ticks.push(`${y}-01`)
      ticks.push(`${y}-07`)
    }
  } else {
    // Yearly ticks (Jan only)
    for (let y = startYear; y <= endYear + 1; y++) {
      ticks.push(`${y}-01`)
    }
  }

  // Filter to only ticks within the data range
  return ticks.filter(t => t >= firstDate.slice(0, 7) && t <= lastDate.slice(0, 7))
}

// Format tick label based on range
function formatTickLabel(dateStr: string, rangeMonths: number): string {
  const [yearStr, monthStr] = dateStr.split('-')
  const month = parseInt(monthStr, 10)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  if (rangeMonths < 6) {
    return `${months[month - 1]} '${yearStr.slice(2)}`
  } else if (rangeMonths <= 36) {
    return `${months[month - 1]} '${yearStr.slice(2)}`
  } else if (rangeMonths <= 72) {
    // Jan shows year, Jul shows "Jul"
    return month === 1 ? `'${yearStr.slice(2)}` : months[month - 1]
  } else {
    return `'${yearStr.slice(2)}`
  }
}

// For each computed tick date, find the closest actual data point date
function snapTicksToData(computedTicks: string[], dataDates: string[]): string[] {
  return computedTicks.map(tick => {
    // Find first data date that starts with the tick's YYYY-MM, or the closest one after
    const match = dataDates.find(d => d.startsWith(tick) || d >= tick)
    return match ?? dataDates[dataDates.length - 1]
  }).filter((v, i, arr) => arr.indexOf(v) === i) // dedupe
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
          <h3 className="text-sm font-inter font-medium text-zinc-300" title={config.description}>
            {config.title}
            {config.description && <span className="ml-1 text-zinc-500 cursor-help" title={config.description}>&#9432;</span>}
          </h3>
          <TimeframeToggle selected={timeframe} onChange={setTimeframe} />
        </div>
        <div className="h-64 flex items-center justify-center">
          <p className="text-zinc-600 text-sm font-inter">Data unavailable</p>
        </div>
      </div>
    )
  }

  // Determine date range for era shading
  const firstDate = (displayData[0]?.date ?? '') as string
  const lastDate = (displayData[displayData.length - 1]?.date ?? '') as string

  // Build era shading using actual data point dates (handles both monthly and weekly formats)
  const allDates = displayData.map(d => d.date as string)

  // Compute era boundary data points (used for both ReferenceArea and ReferenceLine)
  // Rendered as direct JSX children of ChartComponent (not array/fragment — Recharts v3 compatibility)
  const t1x1 = config.eraShading ? (firstDate >= TRUMP1_START && firstDate < BIDEN_START ? allDates[0] : findDateAtOrAfter(allDates, TRUMP1_START)) : null
  const t1x2 = config.eraShading ? findDateAtOrAfter(allDates, BIDEN_START) : null
  const showTrump1 = !!(t1x1 && t1x2 && t1x1 < t1x2)  // strict < to skip zero-width

  const bx1 = config.eraShading ? (firstDate >= BIDEN_START && firstDate < TRUMP2_START ? allDates[0] : findDateAtOrAfter(allDates, BIDEN_START)) : null
  const bx2 = config.eraShading ? findDateAtOrAfter(allDates, TRUMP2_START) : null
  const showBiden = !!(bx1 && bx2 && bx1 < bx2)  // strict <
  const showBidenFull = !!(bx1 && !bx2 && firstDate < TRUMP2_START && lastDate < TRUMP2_START)

  const t2x1 = config.eraShading ? findDateAtOrAfter(allDates, TRUMP2_START) : null
  const showTrump2 = !!t2x1

  const jan2021Line = config.eraShading ? findDateAtOrAfter(allDates, BIDEN_START) : null
  const jan2025Line = config.eraShading ? findDateAtOrAfter(allDates, TRUMP2_START) : null

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
            isAnimationActive={false}
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
            isAnimationActive={false}
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
      isAnimationActive={false}
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

  // Bug 4 fix: Custom tick system snapped to Jan/Jul boundaries
  const rangeMonths = computeDateRangeMonths(firstDate, lastDate)
  const computedTicks = generateTicks(firstDate, lastDate)
  const snappedTicks = snapTicksToData(computedTicks, allDates)

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
        <h3 className="text-sm font-inter font-medium text-zinc-300" title={config.description}>
            {config.title}
            {config.description && <span className="ml-1 text-zinc-500 cursor-help" title={config.description}>&#9432;</span>}
          </h3>
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
      <div className="h-64 animate-reveal-left" style={{ clipPath: 'inset(0 0 0 0)' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={displayData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
            <XAxis
              dataKey="date"
              ticks={snappedTicks}
              tickFormatter={(d: string) => formatTickLabel(d.slice(0, 7), rangeMonths)}
              tick={{ fontSize: 11, fill: '#6B7280' }}
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
              animationDuration={0}
              contentStyle={{
                backgroundColor: '#18181B',
                border: '1px solid #3F3F46',
                borderRadius: '8px',
                fontSize: 12,
              }}
              labelFormatter={(label: unknown) =>
                typeof label === 'string' ? formatTickLabel(label.slice(0, 7), rangeMonths) : String(label)
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any) =>
                typeof value === 'number' && config.formatValue
                  ? config.formatValue(value)
                  : String(value ?? '')
              }
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#A1A1AA' }} />
            {showTrump1 && <ReferenceArea x1={t1x1!} x2={t1x2!} fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} ifOverflow="visible" />}
            {showBiden && <ReferenceArea x1={bx1!} x2={bx2!} fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} ifOverflow="visible" />}
            {showBidenFull && <ReferenceArea x1={bx1!} x2={allDates[allDates.length - 1]} fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} ifOverflow="visible" />}
            {showTrump2 && <ReferenceArea x1={t2x1!} x2={allDates[allDates.length - 1]} fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} ifOverflow="visible" />}
            {jan2021Line && firstDate < BIDEN_START && <ReferenceLine x={jan2021Line} stroke="#6B7280" strokeDasharray="3 3" label={{ value: 'Jan 2021', position: 'top', fontSize: 10, fill: '#6B7280' }} />}
            {jan2025Line && firstDate < TRUMP2_START && <ReferenceLine x={jan2025Line} stroke="#6B7280" strokeDasharray="3 3" label={{ value: 'Jan 2025', position: 'top', fontSize: 10, fill: '#6B7280' }} />}
            {renderSeries()}
            {nationalLines}
            {trendlineElement}
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
