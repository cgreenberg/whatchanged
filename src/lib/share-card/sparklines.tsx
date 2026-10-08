import React from 'react'
import { CHART_PLOT_W, CHART_X_AXIS_H, CHART_Y_AXIS_W, FS } from '@/lib/share-card/layout'

// ── Share-card quadrant chart ─────────────────────────────────────
// One chart template for all four quadrants: drawn in real pixels (no non-uniform SVG scaling, so dots stay round
// and lines keep their width), a dashed baseline reference, a dot on the baseline point and on the latest point,
// two y ticks (the plotted range's top and bottom) and two x ticks (first and last month).

const AXIS_TEXT = '#8C929B'
const AXIS_TEXT_STRONG = '#B3B8C0'
const GRID = 'rgba(255,255,255,0.10)'
const SURFACE = '#111316'

/** Vertical inset (px) inside the plot so the dots and the line never touch its edges. */
const INSET_Y = 10
/** Horizontal inset (px): room for the end dots. */
const INSET_L = 8
const INSET_R = 10
/** Minimum centre-to-centre gap (px) between the two y ticks; a flatter line keeps only the top tick. */
export const MIN_TICK_GAP = 26

export interface ShareChartOpts {
  /** Total height in px (plot + x-axis row). */
  height: number
  /** % charts always include 0 (the baseline) in the range. */
  includeZero?: boolean
  /** Value of the dashed reference line (the baseline: 0 for % charts, the first price for gas). */
  baseline?: number
  /** x position of each value as a 0..1 fraction of the time span (default: evenly spaced). */
  xFractions?: number[]
  /** Indices i where values[i] → values[i+1] spans missing months: drawn dashed, not as data. */
  gapAfter?: number[]
  /** Text for each gap in `gapAfter` (e.g. "no data Feb–Jul"). */
  gapLabels?: string[]
  /** Tick text for a value ("+7.0%", "$4.78"). */
  fmtTick: (v: number) => string
  xLeft: string
  xRight: string
}

/** Pixel geometry of a quadrant chart (exported for tests). */
export function shareChartGeometry(values: number[], opts: Pick<ShareChartOpts, 'height' | 'includeZero' | 'xFractions'>) {
  const lo = Math.min(...values, ...(opts.includeZero ? [0] : []))
  const hi = Math.max(...values, ...(opts.includeZero ? [0] : []))
  const plotH = opts.height - CHART_X_AXIS_H
  const span = plotH - 2 * INSET_Y
  const range = hi - lo
  // A flat line sits mid-plot
  const toY = (v: number) => (range > 0 ? INSET_Y + ((hi - v) / range) * span : plotH / 2)
  const toX = (f: number) => INSET_L + f * (CHART_PLOT_W - INSET_L - INSET_R)
  const xs = values.map((_, i) => toX(opts.xFractions?.[i] ?? (values.length > 1 ? i / (values.length - 1) : 0)))
  const ys = values.map(toY)
  const ticks = range > 0 && toY(lo) - toY(hi) >= MIN_TICK_GAP
    ? [{ value: hi, y: toY(hi) }, { value: lo, y: toY(lo) }]
    : [{ value: hi, y: toY(hi) }]
  return { lo, hi, plotH, toY, xs, ys, ticks }
}

/** Line chart for a share-card quadrant (null with fewer than two points). */
export function buildShareChart(values: number[], color: string, id: string, opts: ShareChartOpts): React.ReactElement | null {
  if (values.length < 2 || values.some((v) => !Number.isFinite(v))) return null
  const geo = shareChartGeometry(values, opts)
  const { plotH, xs, ys, ticks, toY } = geo
  const pts = xs.map((x, i) => ({ x, y: ys[i] }))

  // Solid runs between gaps; each gap is a faint dashed connector with its label
  const gaps = new Set(opts.gapAfter ?? [])
  const runs: Array<typeof pts> = [[pts[0]]]
  for (let i = 1; i < pts.length; i++) {
    if (gaps.has(i - 1)) runs.push([])
    runs[runs.length - 1].push(pts[i])
  }
  const gapSegments = (opts.gapAfter ?? []).map((i, k) => ({ i, label: opts.gapLabels?.[k] }))
    .filter(({ i }) => i >= 0 && i < pts.length - 1)
    .map(({ i, label }) => ({ a: pts[i], b: pts[i + 1], label }))
  const floor = plotH - INSET_Y / 2
  const area = [...pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`), `${pts[pts.length - 1].x.toFixed(1)},${floor}`, `${pts[0].x.toFixed(1)},${floor}`].join(' ')
  const first = pts[0]
  const last = pts[pts.length - 1]
  const baseY = toY(opts.baseline ?? values[0])

  const tick = (text: string, y: number) => (
    <span
      key={`t${y}`}
      style={{
        position: 'absolute', left: 0, top: y - 12, height: 24, display: 'flex', alignItems: 'center',
        fontFamily: 'DM Mono', fontSize: FS.axis, color: AXIS_TEXT,
      }}
    >
      {text}
    </span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: opts.height }}>
      <div style={{ display: 'flex', position: 'relative', width: CHART_Y_AXIS_W, height: plotH, flexShrink: 0 }}>
        {ticks.map((t) => tick(opts.fmtTick(t.value), t.y))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', width: CHART_PLOT_W }}>
        <div style={{ display: 'flex', position: 'relative', width: CHART_PLOT_W, height: plotH }}>
          <svg width={CHART_PLOT_W} height={plotH} viewBox={`0 0 ${CHART_PLOT_W} ${plotH}`} style={{ display: 'flex' }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.26" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Tick gridlines, then the dashed baseline reference */}
            {ticks.map((t) => (
              <line key={`g${t.y}`} x1="0" y1={t.y} x2={CHART_PLOT_W} y2={t.y} stroke={GRID} strokeWidth="1" />
            ))}
            <line x1="0" y1={baseY} x2={CHART_PLOT_W} y2={baseY} stroke="rgba(255,255,255,0.28)" strokeWidth="1.2" strokeDasharray="5,5" />
            <polygon points={area} fill={`url(#${id})`} />
            {runs.filter((r) => r.length >= 2).map((r, i) => (
              <polyline
                key={`r${i}`}
                points={r.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {gapSegments.map(({ a, b }, i) => (
              <line key={`gap${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeOpacity="0.45" strokeWidth="2" strokeDasharray="4,4" />
            ))}
            {/* Baseline and latest points, each with a surface ring */}
            <circle cx={first.x} cy={first.y} r="6" fill={color} stroke={SURFACE} strokeWidth="2" />
            <circle cx={last.x} cy={last.y} r="7" fill={color} stroke={SURFACE} strokeWidth="2" />
          </svg>
          {gapSegments.filter((g) => g.label).map(({ a, b, label }, i) => (
            <span
              key={`gl${i}`}
              style={{
                position: 'absolute', display: 'flex', justifyContent: 'center',
                left: a.x - 30, width: b.x - a.x + 60, top: Math.max(0, Math.min(a.y, b.y) - 24),
                fontFamily: 'DM Mono', fontSize: 15, color: AXIS_TEXT, whiteSpace: 'nowrap',
              }}
            >
              {label}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', height: CHART_X_AXIS_H, paddingTop: 4 }}>
          <span style={{ display: 'flex', fontFamily: 'DM Mono', fontSize: FS.axis, color: AXIS_TEXT_STRONG }}>{opts.xLeft}</span>
          <span style={{ display: 'flex', fontFamily: 'DM Mono', fontSize: FS.axis, color: AXIS_TEXT }}>{opts.xRight}</span>
        </div>
      </div>
    </div>
  )
}

/** Same footprint as a chart when a quadrant has no series to plot. */
export function chartUnavailable(height: number, text = 'Chart unavailable'): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height,
        border: `1px dashed ${GRID}`, borderRadius: 4,
      }}
    >
      <span style={{ display: 'flex', fontFamily: 'DM Mono', fontSize: FS.axis, color: AXIS_TEXT }}>{text}</span>
    </div>
  )
}
