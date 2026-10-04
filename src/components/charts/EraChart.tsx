'use client'
import { useState, useMemo, type ReactNode } from 'react'
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
import {
  ERAS, ERA_FILL, eraSpans, firstOnOrAfter, onOrAfter, filterByTimeframe, normalizeEachSeries, firstDateOf, lastDateOf,
  splitPreliminary, PRELIM_SUFFIX, GAP_SUFFIX, findGaps, withGapConnectors, dotDates, type Row,
} from '@/lib/charts/chart-data'
import { fmtMonthYear, fmtDay, monthsBetween, DATE_UNAVAILABLE } from '@/lib/format'
import type { Provenance } from '@/lib/provenance'
import { ProvenanceLine } from '@/components/ProvenanceLine'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Tick dates snapped to Jan/Jul boundaries
function generateTicks(firstDate: string, lastDate: string): string[] {
  const rangeMonths = monthsBetween(firstDate, lastDate)
  const [startYear, startMonth] = firstDate.split('-').map(Number)
  const [endYear, endMonth] = lastDate.split('-').map(Number)
  const ticks: string[] = []
  if (rangeMonths < 6) {
    for (let y = startYear; y <= endYear; y++) {
      const mStart = y === startYear ? startMonth : 1
      const mEnd = y === endYear ? endMonth : 12
      for (let m = mStart; m <= mEnd; m++) ticks.push(`${y}-${String(m).padStart(2, '0')}`)
    }
  } else if (rangeMonths <= 72) {
    for (let y = startYear; y <= endYear + 1; y++) ticks.push(`${y}-01`, `${y}-07`)
  } else {
    for (let y = startYear; y <= endYear + 1; y++) ticks.push(`${y}-01`)
  }
  return ticks.filter(t => t >= firstDate.slice(0, 7) && t <= lastDate.slice(0, 7))
}

function formatTickLabel(dateStr: string, rangeMonths: number): string {
  const [yearStr, monthStr] = dateStr.split('-')
  const month = parseInt(monthStr, 10)
  if (rangeMonths <= 36) return `${MONTHS[month - 1]} '${yearStr.slice(2)}`
  if (rangeMonths <= 72) return month === 1 ? `'${yearStr.slice(2)}` : MONTHS[month - 1]
  return `'${yearStr.slice(2)}`
}

function formatTooltipLabel(dateStr: string): string {
  return dateStr.length > 7 ? fmtDay(dateStr) : fmtMonthYear(dateStr)
}

function fmtPoint(d?: string): string {
  return d ? (d.length > 7 ? fmtDay(d) : fmtMonthYear(d)) : DATE_UNAVAILABLE
}

function snapTicksToData(computedTicks: string[], dataDates: string[]): string[] {
  return computedTicks
    .map(tick => dataDates.find(d => d.startsWith(tick) || d >= tick) ?? dataDates[dataDates.length - 1])
    .filter((v, i, arr) => arr.indexOf(v) === i)
}

interface EraChartProps {
  config: ChartConfig
  data: Row[]
  nationalData?: Row[]
  /** Source/geography/adjustment for the footer; window and as-of are derived from the visible data. */
  provenance: Omit<Provenance, 'window' | 'asOf'> & { asOf?: string }
  stale?: boolean
  /** Optional block shown above the chart (e.g. the Housing graph's tabs and headline %). */
  headline?: ReactNode
  /** Weekly gas: the "Jan 2025" view starts at the baseline week (last reading ≤ Jan 20). */
  weeklyGasBaseline?: boolean
  /** Appended to the provenance geography as "(dashed: …)" only while the national line is shown. */
  nationalLabel?: string
  /** One-line explanation shown above the provenance footer. */
  note?: string
}

function ChartHeader({
  config, timeframe, setTimeframe, showNationalToggle, showNational, setShowNational, stale,
}: {
  config: ChartConfig
  timeframe: Timeframe
  setTimeframe: (t: Timeframe) => void
  showNationalToggle: boolean
  showNational: boolean
  setShowNational: (v: boolean) => void
  stale?: boolean
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
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
        {stale && (
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-300 border border-amber-300/40 rounded px-1.5 py-0.5" data-testid="stale-badge">
            Stale
          </span>
        )}
      </h3>
      <div className="flex items-center gap-3">
        {showNationalToggle && (
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
  )
}

export function EraChart({ config, data, nationalData, provenance, stale, headline, weeklyGasBaseline, nationalLabel, note }: EraChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(config.defaultTimeframe)
  const [showNational, setShowNational] = useState(false)
  const mainKey = config.series[0]?.dataKey ?? ''

  const filteredData = useMemo(
    () => filterByTimeframe(data, timeframe, weeklyGasBaseline, mainKey),
    [data, timeframe, weeklyGasBaseline, mainKey]
  )

  const chartData = useMemo((): Row[] => {
    if (!config.trendline || !config.series[0]) return filteredData
    const trendData = computeTrendline(filteredData, config.series[0].dataKey)
    return filteredData.map((d, i) => ({ ...d, trend: trendData[i]?.trend }))
  }, [filteredData, config.trendline, config.series])

  // Merge national data when enabled (keys prefixed national_) on the local dates only, so both lines
  // cover the same months (the national line never runs past the latest local month).
  const mergedData = useMemo((): Row[] => {
    if (!showNational || !nationalData?.length || !chartData.length) return chartData
    const nationalMap = new Map(nationalData.map(d => [d.date, d]))
    return chartData.map(d => {
      const nd = nationalMap.get(d.date)
      if (!nd) return d
      const entry: Row = { ...d }
      for (const key of Object.keys(nd)) {
        if (key !== 'date' && key !== 'preliminary') entry[`national_${key}`] = nd[key]
      }
      return entry
    })
  }, [chartData, showNational, nationalData])

  // % change view: each series (local and national) from its own first visible value.
  // Preliminary points (e.g. the latest LAUS month) move to their own dashed series afterwards.
  const { rows: splitData, hasPreliminary } = useMemo(
    () => splitPreliminary(config.normalizeToBaseline ? normalizeEachSeries(mergedData) : mergedData, mainKey),
    [mergedData, config.normalizeToBaseline, mainKey]
  )

  // Months the source did not publish inside the visible window (e.g. Phoenix food-at-home):
  // drawn as a faint dashed connector, with isolated points and the latest point dotted.
  const prelimKey = `${mainKey}${PRELIM_SUFFIX}`
  const gaps = useMemo(() => (config.chartType === 'bar' ? [] : findGaps(splitData, mainKey, [prelimKey])), [splitData, mainKey, prelimKey, config.chartType])
  // The national overlay marks its own missing months the same way (e.g. Oct 2025 in the BLS series)
  const natKey = `national_${mainKey}`
  const natGaps = useMemo(() => (config.chartType === 'bar' || !showNational ? [] : findGaps(splitData, natKey)), [splitData, natKey, config.chartType, showNational])
  const displayData = useMemo(
    () => withGapConnectors(withGapConnectors(splitData, mainKey, gaps, [prelimKey]), natKey, natGaps),
    [splitData, mainKey, gaps, prelimKey, natKey, natGaps],
  )
  const dotted = useMemo(() => dotDates(splitData, mainKey, !hasPreliminary), [splitData, mainKey, hasPreliminary])
  const sourceShort = provenance.source.split(' ')[0]
  const gapRange = (g: { from: string; to: string }) => g.from === g.to ? fmtPoint(g.from) : `${fmtPoint(g.from)}–${fmtPoint(g.to)}`
  // National-only gaps (the U.S. series missing a month the local one has) are named too; shared ones are not repeated
  const natOnlyGaps = natGaps.filter(n => !gaps.some(g => g.from === n.from && g.to === n.to))
  const gapNote = gaps.length || natOnlyGaps.length
    ? [
        gaps.length ? `No ${sourceShort} data for ${gaps.map(gapRange).join(', ')}` : '',
        natOnlyGaps.length ? `${gaps.length ? 'U.S. line: no' : 'No'} U.S. data for ${natOnlyGaps.map(gapRange).join(', ')}` : '',
      ].filter(Boolean).join('; ')
    : null

  const hasLocal = displayData.some(d => typeof d[mainKey] === 'number' || typeof d[`${mainKey}${PRELIM_SUFFIX}`] === 'number')
  const hasNationalData = (nationalData?.length ?? 0) > 0
  const sizeClass = config.size === 'large' ? 'col-span-full' : config.size === 'medium' ? 'sm:col-span-1' : ''

  const firstDate = firstDateOf(chartData, mainKey)
  const lastDate = lastDateOf(chartData, mainKey)
  const windowText = config.normalizeToBaseline
    ? `% change since ${fmtPoint(firstDate)}`
    : `${fmtPoint(firstDate)} – ${fmtPoint(lastDate)}`
  const nationalShown = showNational && hasNationalData && !!config.showNationalToggle
  const fullProvenance: Provenance = {
    ...provenance,
    geography: nationalShown && nationalLabel ? `${provenance.geography} (dashed: ${nationalLabel})` : provenance.geography,
    window: hasLocal ? windowText : 'no data in this window',
    asOf: provenance.asOf ?? fmtPoint(lastDateOf(data, mainKey)),
  }

  const header = (
    <ChartHeader
      config={config}
      timeframe={timeframe}
      setTimeframe={setTimeframe}
      showNationalToggle={!!config.showNationalToggle && hasNationalData}
      showNational={showNational}
      setShowNational={setShowNational}
      stale={stale}
    />
  )

  if (!hasLocal) {
    return (
      <div className={`bg-zinc-900 border border-zinc-800 rounded-xl p-4 ${sizeClass}`} data-testid={`chart-${config.id}`}>
        {header}
        {headline}
        <div className="h-64 flex items-center justify-center">
          <p className="text-zinc-600 text-sm font-inter">Data unavailable</p>
        </div>
        {note && <p className="text-[11px] text-zinc-400 mt-2" data-testid="chart-note">{note}</p>}
        <ProvenanceLine provenance={fullProvenance} className="mt-2 pt-2 border-t border-zinc-800" />
      </div>
    )
  }

  const allDates = displayData.map(d => d.date)
  const localFirst = chartData[0].date
  const localLast = chartData[chartData.length - 1].date
  const spans = config.eraShading ? eraSpans(allDates) : []
  const lines = config.eraShading
    ? ERAS.filter(e => e.label && !onOrAfter(allDates[0], e.start))
      .map(e => ({ key: e.key, label: e.label!, x: firstOnOrAfter(allDates, e.start) }))
      .filter(l => l.x && l.x !== allDates[0])
    : []

  const ChartComponent = config.chartType === 'area' ? AreaChart : config.chartType === 'bar' ? BarChart : LineChart
  const rangeMonths = monthsBetween(localFirst, localLast)
  const snappedTicks = snapTicksToData(generateTicks(localFirst, localLast), allDates)

  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-xl p-4 ${sizeClass}`} data-testid={`chart-${config.id}`}>
      {header}
      {headline}
      {config.normalizeToBaseline && (
        <p className="text-[11px] text-zinc-500 mb-1" data-testid="chart-window">{windowText}</p>
      )}
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
              contentStyle={{ backgroundColor: '#18181B', border: '1px solid #3F3F46', borderRadius: '8px', fontSize: 12 }}
              labelFormatter={(label: unknown) => (typeof label === 'string' ? formatTooltipLabel(label) : String(label))}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any) =>
                typeof value === 'number' && config.formatValue ? config.formatValue(value) : String(value ?? '')
              }
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#A1A1AA' }} />
            {/* Era shading must precede the series (z-order) */}
            {spans.map(s => (
              <ReferenceArea key={s.key} x1={s.x1} x2={s.x2} fill={ERA_FILL[s.color]} strokeOpacity={0} ifOverflow="visible" />
            ))}
            {lines.map(l => (
              <ReferenceLine key={l.key} x={l.x!} stroke="#6B7280" strokeDasharray="3 3" label={{ value: l.label, position: 'top', fontSize: 10, fill: '#6B7280' }} />
            ))}
            {config.series.map((s, si) => {
              // Dots only where the line alone would hide a point: isolated points and the latest one
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const dot = si !== 0 ? false : (p: any) => dotted.has(p?.payload?.date) && typeof p.cx === 'number' && typeof p.cy === 'number'
                ? <circle key={`dt-${p.index}`} cx={p.cx} cy={p.cy} r={3} fill={s.color} stroke="#18181B" strokeWidth={1} data-testid="point-dot" />
                : <g key={`dt-${p?.index}`} />
              return config.chartType === 'area' ? (
                <Area key={`${s.dataKey}-${timeframe}`} type={s.type ?? 'monotone'} dataKey={s.dataKey} stroke={s.color} fill={s.color}
                  fillOpacity={0.1} strokeWidth={2} name={s.label} dot={dot} animationDuration={600} animationEasing="ease-out" />
              ) : config.chartType === 'bar' ? (
                <Bar key={s.dataKey} dataKey={s.dataKey} fill={s.color} name={s.label} />
              ) : (
                <Line key={`${s.dataKey}-${timeframe}`} type={s.type ?? 'monotone'} dataKey={s.dataKey} stroke={s.color}
                  strokeWidth={2} name={s.label} dot={dot} animationDuration={600} animationEasing="ease-out" />
              )
            })}
            {gaps.map((g, i) => (
              <Line key={`gap-${i}-${timeframe}`} type="linear" dataKey={`${mainKey}${GAP_SUFFIX}${i}`} stroke={config.series[0]?.color}
                strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="2 4" dot={false} activeDot={false} connectNulls
                isAnimationActive={false} legendType="none" tooltipType="none" className="gap-connector" />
            ))}
            {natGaps.map((g, i) => (
              <Line key={`natgap-${i}-${timeframe}`} type="linear" dataKey={`${natKey}${GAP_SUFFIX}${i}`} stroke={config.series[0]?.color}
                strokeOpacity={0.3} strokeWidth={1} strokeDasharray="1 4" dot={false} activeDot={false} connectNulls
                isAnimationActive={false} legendType="none" tooltipType="none" className="national-gap-connector" />
            ))}
            {hasPreliminary && config.series[0] && (() => {
              const s = config.series[0]
              const pk = `${s.dataKey}${PRELIM_SUFFIX}`
              // Hollow dot only on the preliminary points (the dashed segment starts at the last final point)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const dot = (p: any) => p?.payload?.preliminary === true && typeof p.cx === 'number' && typeof p.cy === 'number'
                ? <circle key={`pd-${p.index}`} cx={p.cx} cy={p.cy} r={3.5} fill="#18181B" stroke={s.color} strokeWidth={1.5} data-testid="preliminary-dot" />
                : <g key={`pd-${p?.index}`} />
              return config.chartType === 'area' ? (
                <Area key={`${pk}-${timeframe}`} type="linear" dataKey={pk} stroke={s.color} strokeDasharray="4 3" fill={s.color}
                  fillOpacity={0.04} strokeWidth={2} name={`${s.label} (preliminary)`} dot={dot} isAnimationActive={false} connectNulls />
              ) : (
                <Line key={`${pk}-${timeframe}`} type="linear" dataKey={pk} stroke={s.color} strokeDasharray="4 3"
                  strokeWidth={2} name={`${s.label} (preliminary)`} dot={dot} isAnimationActive={false} connectNulls />
              )
            })()}
            {showNational && config.series.map(s => (
              <Line key={`national_${s.dataKey}-${timeframe}`} type={s.type ?? 'monotone'} dataKey={`national_${s.dataKey}`}
                stroke={s.color} strokeWidth={1} strokeDasharray="6 3" strokeOpacity={0.5} name={`${s.label} (${nationalLabel ?? 'U.S.'})`}
                dot={false} animationDuration={600} animationEasing="ease-out" />
            ))}
            {config.trendline && (
              <Line key="trend" type="linear" dataKey="trend" stroke="#9CA3AF" strokeWidth={1} strokeDasharray="6 3" name="Trend" dot={false} />
            )}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
      {gapNote && <p className="text-[11px] text-zinc-500 mt-1" data-testid="chart-gap-note">{gapNote}</p>}
      {note && <p className="text-[11px] text-zinc-400 mt-2" data-testid="chart-note">{note}</p>}
      <ProvenanceLine provenance={fullProvenance} className="mt-2 pt-2 border-t border-zinc-800" />
    </div>
  )
}
