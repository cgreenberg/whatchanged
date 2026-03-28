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
const OBAMA_START = '2009-01'
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

// Tooltip always shows full "Mon YYYY" regardless of timeframe
function formatTooltipLabel(dateStr: string): string {
  const [yearStr, monthStr] = dateStr.split('-')
  const month = parseInt(monthStr, 10)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[month - 1]} ${yearStr}`
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
  const [showTooltip, setShowTooltip] = useState(false)

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
    const localDates = new Set(chartData.map(d => d.date as string))

    const merged = chartData.map(d => {
      const nd = nationalMap.get(d.date as string)
      if (!nd) return d
      const entry: { date: string; [key: string]: unknown } = { ...d }
      for (const key of Object.keys(nd)) {
        if (key !== 'date') entry[`national_${key}`] = nd[key]
      }
      return entry
    })

    // Append national-only data points beyond local range (not before it)
    const lastLocalDate = chartData[chartData.length - 1]?.date as string
    if (lastLocalDate) {
      for (const nd of nationalData) {
        if (nd.date > lastLocalDate) {
          const entry: { date: string; [key: string]: unknown } = { date: nd.date }
          for (const key of Object.keys(nd)) {
            if (key !== 'date') entry[`national_${key}`] = nd[key]
          }
          merged.push(entry)
        }
      }
    }

    return merged
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
          <h3 className="text-sm font-inter font-medium text-zinc-300 relative">
            {config.title}
            {config.description && (
              <span className="relative inline-block ml-1">
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 cursor-help"
                  onClick={() => setShowTooltip(prev => !prev)}
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  aria-label="More info"
                >&#9432;</button>
                {showTooltip && (
                  <span className="absolute left-1/2 -translate-x-1/2 top-6 z-50 w-56 px-3 py-2 text-xs font-normal text-zinc-200 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg">
                    {config.description}
                  </span>
                )}
              </span>
            )}
          </h3>
          <TimeframeToggle selected={timeframe} onChange={setTimeframe} />
        </div>
        <div className="h-64 flex items-center justify-center">
          <p className="text-zinc-600 text-sm font-inter">Data unavailable</p>
        </div>
      </div>
    )
  }

  // Local data range (for stable tick computation — unaffected by national overlay extension)
  const localFirstDate = (chartData[0]?.date ?? '') as string
  const localLastDate = (chartData[chartData.length - 1]?.date ?? '') as string

  // Full display range (for era shading — needs to cover national extension too)
  const firstDate = (displayData[0]?.date ?? '') as string
  const lastDate = (displayData[displayData.length - 1]?.date ?? '') as string

  // Build era shading using actual data point dates (handles both monthly and weekly formats)
  const allDates = displayData.map(d => d.date as string)

  // Compute era boundary data points (used for both ReferenceArea and ReferenceLine)
  // Rendered as direct JSX children of ChartComponent (not array/fragment — Recharts v3 compatibility)
  const ox1 = config.eraShading ? (firstDate < TRUMP1_START ? allDates[0] : null) : null
  const ox2 = config.eraShading ? findDateAtOrAfter(allDates, TRUMP1_START) : null
  const showObama = !!(ox1 && ox2 && ox1 < ox2)

  const t1x1 = config.eraShading ? (firstDate >= TRUMP1_START && firstDate < BIDEN_START ? allDates[0] : findDateAtOrAfter(allDates, TRUMP1_START)) : null
  const t1x2 = config.eraShading ? findDateAtOrAfter(allDates, BIDEN_START) : null
  const showTrump1 = !!(t1x1 && t1x2 && t1x1 < t1x2)  // strict < to skip zero-width

  const bx1 = config.eraShading ? (firstDate >= BIDEN_START && firstDate < TRUMP2_START ? allDates[0] : findDateAtOrAfter(allDates, BIDEN_START)) : null
  const bx2 = config.eraShading ? findDateAtOrAfter(allDates, TRUMP2_START) : null
  const showBiden = !!(bx1 && bx2 && bx1 < bx2)  // strict <
  const showBidenFull = !!(bx1 && !bx2 && firstDate < TRUMP2_START && lastDate < TRUMP2_START)

  const t2x1 = config.eraShading ? findDateAtOrAfter(allDates, TRUMP2_START) : null
  const showTrump2 = !!t2x1

  const jan2017Line = config.eraShading ? findDateAtOrAfter(allDates, TRUMP1_START) : null
  const jan2021Line = config.eraShading ? findDateAtOrAfter(allDates, BIDEN_START) : null
  const jan2025Line = config.eraShading ? findDateAtOrAfter(allDates, TRUMP2_START) : null

  const renderSeries = () => {
    return config.series.map(s => {
      if (config.chartType === 'area') {
        return (
          <Area
            key={`${s.dataKey}-${timeframe}`}
            type={s.type ?? 'monotone'}
            dataKey={s.dataKey}
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.1}
            strokeWidth={2}
            name={s.label}
            dot={false}
            animationDuration={600}
            animationEasing="ease-out"
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
            key={`${s.dataKey}-${timeframe}`}
            type={s.type ?? 'monotone'}
            dataKey={s.dataKey}
            stroke={s.color}
            strokeWidth={2}
            name={s.label}
            dot={false}
            animationDuration={600}
            animationEasing="ease-out"
          />
        )
      }
    })
  }

  // National overlay lines (dotted) when showNational is enabled
  const nationalLines = showNational ? config.series.map(s => (
    <Line
      key={`national_${s.dataKey}-${timeframe}`}
      type={s.type ?? 'monotone'}
      dataKey={`national_${s.dataKey}`}
      stroke={s.color}
      strokeWidth={1}
      strokeDasharray="6 3"
      strokeOpacity={0.5}
      name={`${s.label} (National)`}
      dot={false}
      animationDuration={600}
      animationEasing="ease-out"
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
  // Use local data range so ticks stay stable when toggling national overlay
  const rangeMonths = computeDateRangeMonths(localFirstDate, localLastDate)
  const computedTicks = generateTicks(localFirstDate, localLastDate)
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
        <h3 className="text-sm font-inter font-medium text-zinc-300 relative">
            {config.title}
            {config.description && (
              <span className="relative inline-block ml-1">
                <button
                  type="button"
                  className="text-zinc-500 hover:text-zinc-300 cursor-help"
                  onClick={() => setShowTooltip(prev => !prev)}
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  aria-label="More info"
                >&#9432;</button>
                {showTooltip && (
                  <span className="absolute left-1/2 -translate-x-1/2 top-6 z-50 w-56 px-3 py-2 text-xs font-normal text-zinc-200 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg">
                    {config.description}
                  </span>
                )}
              </span>
            )}
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
      <div className="h-64">
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
                typeof label === 'string' ? formatTooltipLabel(label.slice(0, 7)) : String(label)
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any) =>
                typeof value === 'number' && config.formatValue
                  ? config.formatValue(value)
                  : String(value ?? '')
              }
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#A1A1AA' }} />
            {showObama && <ReferenceArea x1={ox1!} x2={ox2!} fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} ifOverflow="visible" />}
            {showTrump1 && <ReferenceArea x1={t1x1!} x2={t1x2!} fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} ifOverflow="visible" />}
            {showBiden && <ReferenceArea x1={bx1!} x2={bx2!} fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} ifOverflow="visible" />}
            {showBidenFull && <ReferenceArea x1={bx1!} x2={allDates[allDates.length - 1]} fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} ifOverflow="visible" />}
            {showTrump2 && <ReferenceArea x1={t2x1!} x2={allDates[allDates.length - 1]} fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} ifOverflow="visible" />}
            {jan2017Line && firstDate < TRUMP1_START && <ReferenceLine x={jan2017Line} stroke="#6B7280" strokeDasharray="3 3" label={{ value: 'Jan 2017', position: 'top', fontSize: 10, fill: '#6B7280' }} />}
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
