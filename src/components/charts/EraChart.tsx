'use client'
import { useId, useRef, useState, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend,
  ReferenceArea, ReferenceLine,
  CartesianGrid,
  ZIndexLayer, DefaultZIndexes,
  useXAxisScale, useYAxisScale, usePlotArea,
} from 'recharts'
import type { ChartConfig, Timeframe } from '@/lib/charts/chart-config'
import { TimeframeToggle } from './TimeframeToggle'
import { computeTrendline } from '@/lib/charts/trendline'
import {
  ERAS, firstOnOrAfter, onOrAfter, filterByTimeframe, normalizeEachSeries, firstDateOf, lastDateOf,
  splitPreliminary, PRELIM_SUFFIX, GAP_SUFFIX, findGaps, withGapConnectors, dotDates, type Row,
} from '@/lib/charts/chart-data'
import { fmtMonthYear, fmtDay, fmtSignedPct, monthsBetween, DATE_UNAVAILABLE } from '@/lib/format'
import { BASELINE_MONTH_LABEL, BASELINE_DAY_LABEL, BASELINE_DATE } from '@/lib/baseline'
import { DESK } from '@/lib/theme'
import type { Provenance } from '@/lib/provenance'
import { ProvenanceLine } from '@/components/ProvenanceLine'
import { SourceTrace } from '@/components/SourceTrace'
import type { TraceStep } from '@/lib/resolution/types'

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

/** % axis ticks: signed, no trailing ".0" ("+7%", "0%", "−2.5%"); tooltips keep the full format. */
function fmtPctTick(v: number): string {
  const a = Math.abs(v)
  const n = Number.isInteger(Math.round(a * 10) / 10) ? a.toFixed(0) : a.toFixed(1)
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${n}%`
}

/** Short month for the end-of-line label: "Aug '26" (weekly points keep their day in the tooltip). */
function fmtTick(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  const mon = MONTHS[parseInt(m, 10) - 1]
  return d ? `${mon} ${parseInt(d, 10)}` : `${mon} '${y.slice(2)}`
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
  /** One short line shown above the provenance footer (longer explanations go in `info`). */
  note?: string
  /** Lines shown in the graph's ⓘ disclosure after the description (e.g. the Housing graph's CPI-vs-Zillow note). */
  info?: string[]
  /** Ladder trace for "Where does this come from?" under the graph. */
  trace?: TraceStep[]
}

/** "+3.1% since Jan 2025 · detail" above a graph: the same % as the matching card. */
export function ChartHeadline({ pct, detail, caveat, testId = 'chart-headline' }: {
  pct: number; detail?: string; caveat?: string | null; testId?: string
}) {
  return (
    <div className="mb-2" data-testid={testId}>
      <p className="text-[13px] leading-snug text-ink-2">
        <span
          className="tnum font-display font-semibold text-[28px] leading-none tracking-tight mr-2 align-[-2px]"
          style={{ color: 'var(--chart-accent, #F1EFEA)' }}
          data-testid={`${testId}-pct`}
        >
          {fmtSignedPct(pct)}
        </span>
        <span className="text-ink-2">since {BASELINE_MONTH_LABEL}</span>
        {detail && <span className="text-ink-3"> · {detail}</span>}
      </p>
      {caveat && <p className="text-[11px] text-caution/90 mt-0.5" data-testid="flag-note">{caveat}</p>}
    </div>
  )
}

/**
 * Graph title row. The ⓘ is a disclosure like the hero cards' (button with aria-expanded /
 * aria-controls; Escape closes): it opens a panel under the header with the description and `info`.
 */
function ChartHeader({
  config, timeframe, setTimeframe, showNationalToggle, showNational, setShowNational, stale, info,
}: {
  config: ChartConfig
  timeframe: Timeframe
  setTimeframe: (t: Timeframe) => void
  showNationalToggle: boolean
  showNational: boolean
  setShowNational: (v: boolean) => void
  stale?: boolean
  info?: string[]
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const lines = [config.description, ...(info ?? [])].filter((l): l is string => !!l && l.trim().length > 0)
  return (
    <div
      className="mb-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <h3 className="font-display font-semibold text-[19px] leading-tight tracking-tight text-ink flex items-center">
        {config.title}
        {lines.length > 0 && (
          <button
            ref={buttonRef}
            type="button"
            className={`ml-1 flex h-7 w-7 items-center justify-center rounded-full font-sans text-sm font-normal leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-2 ${open ? 'text-ink bg-line' : 'text-ink-3 hover:text-ink'}`}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? 'Hide' : 'Show'} details for ${config.title}`}
            onClick={() => setOpen(o => !o)}
            data-testid="chart-info-toggle"
          >
            <span aria-hidden="true">ⓘ</span>
          </button>
        )}
        {stale && (
          <span className="kicker !text-[10px] ml-2 text-caution border border-caution/40 rounded-sm px-1.5 py-0.5" data-testid="stale-badge">
            Stale
          </span>
        )}
      </h3>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <TimeframeToggle selected={timeframe} onChange={setTimeframe} />
        {showNationalToggle && (
          <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer select-none hover:text-ink">
            <input
              type="checkbox"
              checked={showNational}
              onChange={e => setShowNational(e.target.checked)}
              className="h-3.5 w-3.5 rounded-sm"
            />
            Show national
          </label>
        )}
      </div>
      {lines.length > 0 && (
        <div
          id={panelId}
          hidden={!open}
          className="mt-2.5 border-l-2 border-line pl-3 py-0.5 space-y-1.5 text-[12px] leading-snug text-ink-2"
          data-testid="chart-info"
        >
          {lines.map((l, i) => <p key={i} data-testid="chart-info-line">{l}</p>)}
        </div>
      )}
    </div>
  )
}

/** Compact line key (only when a graph has more than one line); the latest values are labeled on the plot. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LineKey({ payload }: { payload?: ReadonlyArray<any> }) {
  const items = (payload ?? []).filter(p => p && p.type !== 'none')
  return (
    <ul className="flex flex-wrap gap-x-3.5 gap-y-1 pt-1 text-[11px] leading-tight text-ink-2">
      {items.map((p, i) => {
        const dash = p.payload?.strokeDasharray as string | undefined
        const op = p.payload?.strokeOpacity as number | undefined
        const w = (p.payload?.strokeWidth as number | undefined) ?? 2
        return (
          <li key={`${p.value}-${i}`} className="recharts-legend-item inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="18" y2="4" stroke={p.color} strokeWidth={Math.max(1.25, w)} strokeDasharray={dash} strokeOpacity={op ?? 1} />
            </svg>
            <span>{p.value}</span>
          </li>
        )
      })}
    </ul>
  )
}

type EndLabel = { key: string; date: string; value: number; color: string; text: string; sub?: string; strong: boolean }

/**
 * Annotation layer drawn in the plot's own coordinates: the baseline marker label and value, and
 * end-of-line labels (latest value + month) for the local and U.S. lines, nudged apart when they collide.
 */
function Annotations({ baselineX, baselineText, baselineValue, ends, accent }: {
  baselineX: string | null
  baselineText: string
  /** below: the line runs above the baseline right after it, so the value label goes under the dot. */
  baselineValue: { date: string; value: number; text: string | null; below?: boolean } | null
  ends: EndLabel[]
  accent: string
}) {
  const xs = useXAxisScale()
  const ys = useYAxisScale()
  const plot = usePlotArea()
  if (!xs || !ys || !plot) return null
  const right = plot.x + plot.width

  // End labels: place at the point's y, then resolve overlaps top-down (min gap 26px)
  const placed = ends
    .map(e => ({ ...e, px: xs(e.date), py: ys(e.value) }))
    .filter((e): e is EndLabel & { px: number; py: number } => typeof e.px === 'number' && typeof e.py === 'number')
    .sort((a, b) => a.py - b.py)
    .map(e => ({ ...e, ly: e.py }))
  const GAP = 26
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].ly - placed[i - 1].ly < GAP) {
      const mid = (placed[i].ly + placed[i - 1].ly) / 2
      placed[i - 1].ly = mid - GAP / 2
      placed[i].ly = mid + GAP / 2
    }
  }
  placed.forEach(e => { e.ly = Math.max(plot.y + 6, Math.min(plot.y + plot.height - 6, e.ly)) })

  const bx = baselineX ? xs(baselineX) : undefined
  const bv = baselineValue ? { x: xs(baselineValue.date), y: ys(baselineValue.value) } : null
  const halo = { paintOrder: 'stroke' as const, stroke: DESK.surface, strokeWidth: 3, strokeLinejoin: 'round' as const }

  return (
    <g className="chart-annotations" pointerEvents="none">
      {typeof bx === 'number' && (
        <text x={bx + (bx - plot.x < 4 ? 0 : -4)} y={plot.y - 8} textAnchor={bx - plot.x < 4 ? 'start' : 'end'}
          fontSize={10} fill={DESK.ink2} style={{ fontFamily: 'var(--nf-mono), monospace', letterSpacing: '0.04em' }} data-testid="baseline-label">
          {baselineText}
        </text>
      )}
      {bv && typeof bv.x === 'number' && typeof bv.y === 'number' && (
        <g>
          <circle cx={bv.x} cy={bv.y} r={3.5} fill={DESK.surface} stroke={accent} strokeWidth={1.5} />
          {baselineValue?.text && (
            <text x={bv.x + 7} y={baselineValue.below ? bv.y + 16 : bv.y - 8} fontSize={11} fontWeight={500} fill={DESK.ink2} style={{ ...halo, fontVariantNumeric: 'tabular-nums' }}>
              {baselineValue.text}
            </text>
          )}
        </g>
      )}
      {placed.map(e => (
        <g key={e.key} data-testid={`end-label-${e.key}`}>
          <circle cx={e.px} cy={e.py} r={e.strong ? 4 : 3} fill={e.color} stroke={DESK.surface} strokeWidth={1.5} />
          {Math.abs(e.ly - e.py) > 3 && (
            <line x1={e.px + 5} y1={e.py} x2={right + 6} y2={e.ly} stroke={e.color} strokeOpacity={0.5} strokeWidth={1} />
          )}
          <text x={right + 8} y={e.ly} dominantBaseline="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <tspan fontSize={e.strong ? 13 : 11.5} fontWeight={e.strong ? 600 : 500} fill={e.strong ? e.color : DESK.ink2}>{e.text}</tspan>
            {e.sub && <tspan x={right + 8} dy={12} fontSize={9.5} fill={DESK.ink3} style={{ fontFamily: 'var(--nf-mono), monospace' }}>{e.sub}</tspan>}
          </text>
        </g>
      ))}
    </g>
  )
}

export function EraChart({ config, data, nationalData, provenance, stale, headline, weeklyGasBaseline, nationalLabel, note, info, trace }: EraChartProps) {
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
  // Only series the national data actually carries get a U.S. line (and a legend entry)
  const nationalKeys = new Set((nationalData ?? []).flatMap(d => Object.keys(d)).filter(k => k !== 'date' && k !== 'preliminary'))
  // 'large' spans the whole charts grid; 'medium' (all four price charts) takes one cell of the 2 × 2 grid
  const sizeClass = config.size === 'large' ? 'col-span-full min-w-0' : 'min-w-0'

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
      info={info}
    />
  )

  const accent = config.series[0]?.color ?? DESK.ink
  const cardClass = `bg-surface border border-line rounded-md p-4 sm:p-5 ${sizeClass}`
  const cardStyle = { ['--chart-accent' as string]: accent } as React.CSSProperties

  if (!hasLocal) {
    return (
      <div className={cardClass} style={cardStyle} data-testid={`chart-${config.id}`}>
        {header}
        {headline}
        <div className="h-64 flex items-center justify-center border border-dashed border-line rounded-sm">
          <p className="text-ink-3 text-sm">Data unavailable</p>
        </div>
        {note && <p className="text-[12px] text-ink-2 mt-2" data-testid="chart-note">{note}</p>}
        <ProvenanceLine provenance={fullProvenance} className="mt-3 pt-2 border-t border-line" />
        <SourceTrace steps={trace} subject={config.title.toLowerCase()} className="mt-1" />
      </div>
    )
  }

  const allDates = displayData.map(d => d.date)
  const localFirst = chartData[0].date
  const localLast = chartData[chartData.length - 1].date
  // Neutral time references instead of party-colored eras: one baseline rule (Jan 20, 2025) with a
  // light gray "since baseline" field, plus faint dotted rules at earlier inaugurations in long views.
  const baselineX = config.eraShading ? firstOnOrAfter(allDates, BASELINE_DATE) : null
  const baselineText = `${baselineX && baselineX.length > 7 ? BASELINE_DAY_LABEL : BASELINE_MONTH_LABEL} baseline`
  const lines = config.eraShading
    ? ERAS.filter(e => e.label && e.start !== BASELINE_DATE && !onOrAfter(allDates[0], e.start))
      .map(e => ({ key: e.key, label: e.label!, x: firstOnOrAfter(allDates, e.start) }))
      .filter(l => l.x && l.x !== allDates[0])
    : []

  // End-of-line labels: latest local value (final or preliminary) and, when shown, the latest U.S. value
  const fmt = (v: number) => (config.formatValue ? config.formatValue(v) : String(v))
  const lastWith = (keys: string[]) => {
    for (let i = displayData.length - 1; i >= 0; i--) {
      for (const k of keys) {
        const v = displayData[i][k]
        if (typeof v === 'number' && Number.isFinite(v)) return { date: displayData[i].date, value: v }
      }
    }
    return null
  }
  const ends: EndLabel[] = []
  const localEnd = lastWith([prelimKey, mainKey])
  if (localEnd) ends.push({ key: 'local', ...localEnd, color: accent, text: fmt(localEnd.value), sub: fmtTick(localEnd.date), strong: true })
  const natEnd = nationalShown && nationalKeys.has(mainKey) ? lastWith([natKey]) : null
  if (natEnd) ends.push({ key: 'national', ...natEnd, color: DESK.ink2, text: fmt(natEnd.value), sub: 'U.S.', strong: false })
  const baseRow = baselineX ? displayData.find(d => d.date === baselineX) : undefined
  const baseVal = baseRow && typeof baseRow[mainKey] === 'number' ? (baseRow[mainKey] as number) : null
  // Which side of the dot the value label goes: away from where the line heads over the next few points
  const baseIdx = baselineX ? displayData.findIndex(d => d.date === baselineX) : -1
  const after = baseIdx >= 0
    ? displayData.slice(baseIdx + 1, baseIdx + 1 + Math.max(3, Math.round(displayData.length * 0.06)))
      .map(d => d[mainKey]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : []
  const below = baseVal != null && after.length > 0 && after.reduce((a, v) => a + v, 0) / after.length > baseVal
  const baselineValue = baselineX && baseVal != null
    ? { date: baselineX, value: baseVal, text: config.normalizeToBaseline ? null : fmt(baseVal), below }
    : null

  const legendCount = config.series.length + (hasPreliminary ? 1 : 0) + (config.trendline ? 1 : 0)
    + (showNational ? config.series.filter(s => nationalKeys.has(s.dataKey)).length : 0)

  const ChartComponent = config.chartType === 'area' ? AreaChart : config.chartType === 'bar' ? BarChart : LineChart
  const rangeMonths = monthsBetween(localFirst, localLast)
  const snappedTicks = snapTicksToData(generateTicks(localFirst, localLast), allDates)
  const tick = { fontSize: 11, fill: DESK.ink3 }

  return (
    <div className={cardClass} style={cardStyle} data-testid={`chart-${config.id}`}>
      {header}
      {headline}
      {config.normalizeToBaseline && (
        <p className="kicker !text-[10px] text-ink-3 mb-1" data-testid="chart-window">{windowText}</p>
      )}
      <div className={legendCount > 1 ? 'h-[19rem]' : 'h-72'}>
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={displayData} margin={{ top: 22, right: 58, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={DESK.grid} />
            <XAxis
              dataKey="date"
              ticks={snappedTicks}
              tickFormatter={(d: string) => formatTickLabel(d.slice(0, 7), rangeMonths)}
              tick={tick}
              tickLine={false}
              tickMargin={8}
              stroke={DESK.line}
            />
            <YAxis
              tick={tick}
              width={46}
              axisLine={false}
              tickLine={false}
              tickMargin={6}
              domain={config.yAxisDomain ?? ['auto', 'auto']}
              tickFormatter={config.normalizeToBaseline ? fmtPctTick : config.formatValue}
            />
            <Tooltip
              animationDuration={0}
              cursor={{ stroke: DESK.ink3, strokeWidth: 1 }}
              contentStyle={{ backgroundColor: DESK.raised, border: `1px solid ${DESK.line}`, borderRadius: 4, fontSize: 12, padding: '6px 10px', fontVariantNumeric: 'tabular-nums' }}
              labelStyle={{ color: DESK.ink2, fontSize: 11, marginBottom: 2 }}
              itemStyle={{ padding: 0 }}
              labelFormatter={(label: unknown) => (typeof label === 'string' ? formatTooltipLabel(label) : String(label))}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any) =>
                typeof value === 'number' && config.formatValue ? config.formatValue(value) : String(value ?? '')
              }
            />
            {legendCount > 1 && (
              <Legend verticalAlign="bottom" align="left" wrapperStyle={{ paddingLeft: 46, paddingTop: 6 }} content={(p) => <LineKey payload={p.payload} />} />
            )}
            {/* Baseline field + rules must precede the series (z-order) */}
            {/* The field only when there is a "before" to contrast with (not in the Jan 2025 view) */}
            {baselineX && baselineX !== allDates[0] && baselineX !== allDates[allDates.length - 1] && (
              <ReferenceArea x1={baselineX} x2={allDates[allDates.length - 1]} fill={DESK.baselineFill} fillOpacity={1} strokeOpacity={0} ifOverflow="visible" />
            )}
            {config.normalizeToBaseline && (
              <ReferenceLine y={0} stroke={DESK.ink3} strokeOpacity={0.55} strokeWidth={1} />
            )}
            {lines.map(l => (
              <ReferenceLine key={l.key} x={l.x!} stroke={DESK.ink3} strokeOpacity={0.6} strokeDasharray="1 3"
                label={{ value: l.label, position: 'insideTopLeft', fontSize: 10, fill: DESK.ink3, offset: 4 }} />
            ))}
            {baselineX && (
              <ReferenceLine x={baselineX} stroke={DESK.baselineRule} strokeWidth={1} strokeOpacity={0.8} ifOverflow="visible" />
            )}
            {config.series.map((s, si) => {
              // Dots only where the line alone would hide a point: isolated points and the latest one
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const dot = si !== 0 ? false : (p: any) => dotted.has(p?.payload?.date) && typeof p.cx === 'number' && typeof p.cy === 'number'
                ? <circle key={`dt-${p.index}`} cx={p.cx} cy={p.cy} r={3} fill={s.color} stroke={DESK.surface} strokeWidth={1} data-testid="point-dot" />
                : <g key={`dt-${p?.index}`} />
              const activeDot = { r: 4, fill: s.color, stroke: DESK.surface, strokeWidth: 2 }
              return config.chartType === 'area' ? (
                <Area key={`${s.dataKey}-${timeframe}`} type={s.type ?? 'monotone'} dataKey={s.dataKey} stroke={s.color} fill={s.color}
                  fillOpacity={0.08} strokeWidth={2.25} name={s.label} dot={dot} activeDot={activeDot} animationDuration={600} animationEasing="ease-out" />
              ) : config.chartType === 'bar' ? (
                <Bar key={s.dataKey} dataKey={s.dataKey} fill={s.color} name={s.label} />
              ) : (
                <Line key={`${s.dataKey}-${timeframe}`} type={s.type ?? 'monotone'} dataKey={s.dataKey} stroke={s.color}
                  strokeWidth={s.strokeWidth ?? 2.25} strokeOpacity={s.strokeOpacity} strokeDasharray={s.strokeDasharray}
                  strokeLinecap="round" strokeLinejoin="round"
                  name={s.label} dot={dot} activeDot={activeDot} animationDuration={600} animationEasing="ease-out" />
              )
            })}
            {gaps.map((g, i) => (
              <Line key={`gap-${i}-${timeframe}`} type="linear" dataKey={`${mainKey}${GAP_SUFFIX}${i}`} stroke={config.series[0]?.color}
                strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="2 4" dot={false} activeDot={false} connectNulls
                isAnimationActive={false} legendType="none" tooltipType="none" className="gap-connector" />
            ))}
            {natGaps.map((g, i) => (
              <Line key={`natgap-${i}-${timeframe}`} type="linear" dataKey={`${natKey}${GAP_SUFFIX}${i}`} stroke={DESK.ink2}
                strokeOpacity={0.35} strokeWidth={1} strokeDasharray="1 4" dot={false} activeDot={false} connectNulls
                isAnimationActive={false} legendType="none" tooltipType="none" className="national-gap-connector" />
            ))}
            {hasPreliminary && config.series[0] && (() => {
              const s = config.series[0]
              const pk = `${s.dataKey}${PRELIM_SUFFIX}`
              // Hollow dot only on the preliminary points (the dashed segment starts at the last final point)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const dot = (p: any) => p?.payload?.preliminary === true && typeof p.cx === 'number' && typeof p.cy === 'number'
                ? <circle key={`pd-${p.index}`} cx={p.cx} cy={p.cy} r={3.5} fill={DESK.surface} stroke={s.color} strokeWidth={1.5} data-testid="preliminary-dot" />
                : <g key={`pd-${p?.index}`} />
              return config.chartType === 'area' ? (
                <Area key={`${pk}-${timeframe}`} type="linear" dataKey={pk} stroke={s.color} strokeDasharray="4 3" fill={s.color}
                  fillOpacity={0.04} strokeWidth={2} name={`${s.label} (preliminary)`} dot={dot} isAnimationActive={false} connectNulls />
              ) : (
                <Line key={`${pk}-${timeframe}`} type="linear" dataKey={pk} stroke={s.color} strokeDasharray="4 3"
                  strokeWidth={2} name={`${s.label} (preliminary)`} dot={dot} isAnimationActive={false} connectNulls />
              )
            })()}
            {/* U.S. comparison: neutral gray dashed, so the local accent stays the one signal */}
            {showNational && config.series.filter(s => nationalKeys.has(s.dataKey)).map(s => (
              <Line key={`national_${s.dataKey}-${timeframe}`} type={s.type ?? 'monotone'} dataKey={`national_${s.dataKey}`}
                stroke={DESK.ink2} strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.85} name={`${s.label} (${nationalLabel ?? 'U.S.'})`}
                dot={false} activeDot={{ r: 3, fill: DESK.ink2, stroke: DESK.surface, strokeWidth: 2 }} animationDuration={600} animationEasing="ease-out" />
            ))}
            {config.trendline && (
              <Line key="trend" type="linear" dataKey="trend" stroke={DESK.ink3} strokeWidth={1} strokeDasharray="6 3" name="Trend" dot={false} />
            )}
            <ZIndexLayer zIndex={DefaultZIndexes.label}>
              <Annotations baselineX={baselineX} baselineText={baselineText} baselineValue={baselineValue} ends={ends} accent={accent} />
            </ZIndexLayer>
          </ChartComponent>
        </ResponsiveContainer>
      </div>
      {gapNote && <p className="text-[11px] text-ink-3 mt-1" data-testid="chart-gap-note">{gapNote}</p>}
      {note && <p className="text-[12px] text-ink-2 mt-2" data-testid="chart-note">{note}</p>}
      <ProvenanceLine provenance={fullProvenance} className="mt-3 pt-2 border-t border-line" />
      <SourceTrace steps={trace} subject={config.title.toLowerCase()} className="mt-1" />
    </div>
  )
}
