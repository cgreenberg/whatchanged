import React from 'react';

// LEGACY: kept for any future callers — not currently used by v3 card
export function buildLineSparkline(
  values: number[],
  accentColor: string,
  gradientId: string,
  labels?: { min: string; max: string }
): React.ReactElement | null {
  if (values.length < 2) return null;

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const normalize = (v: number): number =>
    31 - ((v - minVal) / range) * (31 - 5);

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = normalize(v);
    return { x, y };
  });

  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');
  const polygonPoints = [
    ...points.map(p => `${p.x},${p.y}`),
    '100,36',
    '0,36',
  ].join(' ');
  const last = points[points.length - 1];

  const svg = (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accentColor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1="36" x2="100" y2="36" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
      <line x1="0" y1="0" x2="0" y2="36" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
      <polygon points={polygonPoints} fill={`url(#${gradientId})`} />
      <polyline points={polylinePoints} fill="none" stroke={accentColor} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="2" fill={accentColor} />
    </svg>
  );

  if (!labels) {
    return <div style={{ display: 'flex', width: '100%', height: '100px' }}>{svg}</div>;
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: 'DM Mono',
    fontSize: 10,
    color: 'rgba(232,228,220,0.3)',
    position: 'absolute',
    left: '3px',
  };

  return (
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100px' }}>
      {svg}
      <span style={{ ...labelStyle, top: '0px' }}>{labels.max}</span>
      <span style={{ ...labelStyle, bottom: '0px' }}>{labels.min}</span>
    </div>
  );
}

// ── V3 Sparklines ────────────────────────────────────────────────

const SECONDARY = 'rgba(168,159,147,1)'  // --text-secondary
const TERTIARY = 'rgba(107,101,96,1)'    // --text-tertiary

/** Height of the x-axis label row under the plot (px). */
export const SPARK_X_AXIS_ROW = 28
/** Height of one y-axis label box (px); labels are vertically centred on their value. */
const Y_LABEL_BOX = 24
/** SVG viewBox height; plotted y runs from SPARK_Y_TOP (max) to SPARK_Y_BOTTOM (min). */
const VIEW_H = 50
const SPARK_Y_TOP = 5
const SPARK_Y_BOTTOM = 46
/** Minimum centre-to-centre gap (px) between y-labels; a shorter plot shows only max/min (no mid tick). */
export const MIN_Y_LABEL_GAP = Y_LABEL_BOX + 4

/**
 * Pixel geometry of a V3 sparkline (exported for tests): where each value is
 * plotted, and where the max/mid/min y-labels are centred. Labels live in a
 * column exactly as tall as the plot (not the x-axis row), so a label's centre
 * equals the plotted y of the value it names.
 */
export function sparklineGeometry(values: number[], opts: { bounds?: { min: number; max: number }; height?: number } = {}) {
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const minVal = opts.bounds ? opts.bounds.min : dataMin
  const maxVal = opts.bounds ? opts.bounds.max : dataMax
  const range = maxVal - minVal || 1
  const plotHeight = (opts.height ?? 220) - SPARK_X_AXIS_ROW
  // Map value → SVG y (inverted: higher value = lower y), padded so dots aren't clipped.
  const toY = (v: number): number => SPARK_Y_BOTTOM - ((v - minVal) / range) * (SPARK_Y_BOTTOM - SPARK_Y_TOP)
  const toPx = (svgY: number) => (svgY / VIEW_H) * plotHeight
  return {
    minVal,
    maxVal,
    plotHeight,
    toY,
    /** Plotted y (px from top of the plot) of each value. */
    pointYs: values.map((v) => toPx(toY(v))),
    /** Centre y (px from top of the plot) of the max/mid/min labels. */
    labelYs: { max: toPx(toY(maxVal)), mid: toPx(toY((minVal + maxVal) / 2)), min: toPx(toY(minVal)) },
    /** false when the plot is too short for three labels without them touching (e.g. the HI/AK gas cell). */
    showMid: toPx(toY((minVal + maxVal) / 2)) - toPx(toY(maxVal)) >= MIN_Y_LABEL_GAP,
  }
}

/** Line sparkline with HTML div axis labels. Height ~220px. */
export function buildLineSparklineV3(
  values: number[],
  accentColor: string,
  gradientId: string,
  opts: {
    yMin: string   // e.g. "$1.80"
    yMid: string   // e.g. "$2.60"
    yMax: string   // e.g. "$3.40"
    xLeft: string  // e.g. "Jan '25"
    xMid: string   // e.g. "Jul '25"
    xRight: string // e.g. "Mar '26"
    bounds?: { min: number; max: number }
    /** Total height in px (default 220). */
    height?: number
    /** x position of each value as a 0..1 fraction of the time span (default: evenly spaced). */
    xFractions?: number[]
    /** Indices i where values[i] → values[i+1] spans missing months: drawn dashed, not as data. */
    gapAfter?: number[]
    /** Text for each gap in `gapAfter` (e.g. "no data Feb–Jul"), drawn above its dashed connector. */
    gapLabels?: string[]
  }
): React.ReactElement | null {
  if (values.length < 2) return null;

  const geo = sparklineGeometry(values, opts)
  const { minVal, maxVal, toY, labelYs, plotHeight, showMid } = geo

  const pts = values.map((v, i) => ({
    x: 4 + (opts.xFractions?.[i] ?? i / (values.length - 1)) * 90,
    y: toY(v),
  }));

  // Solid runs between gaps; each gap is a faint dashed connector.
  const gaps = new Set(opts.gapAfter ?? [])
  const runs: Array<typeof pts> = [[pts[0]]]
  for (let i = 1; i < pts.length; i++) {
    if (gaps.has(i - 1)) runs.push([])
    runs[runs.length - 1].push(pts[i])
  }
  const gapSegments = (opts.gapAfter ?? []).map((i, k) => ({ i, label: opts.gapLabels?.[k] }))
    .filter(({ i }) => i >= 0 && i < pts.length - 1)
    .map(({ i, label }) => ({ a: pts[i], b: pts[i + 1], label }))
  const areaPts = [
    ...pts.map(p => `${p.x},${p.y}`),
    '94,46',
    '4,46',
  ].join(' ');
  const last = pts[pts.length - 1];

  // Gridline y-positions for min/mid/max
  const yMax = toY(maxVal);
  const yMid = toY((minVal + maxVal) / 2);

  const labelSz = { fontFamily: 'DM Mono', fontSize: 22, color: TERTIARY }
  const yLabel = (text: string, centerY: number) => (
    <span
      style={{
        ...labelSz,
        display: 'flex',
        alignItems: 'center',
        position: 'absolute',
        left: 0,
        top: centerY - Y_LABEL_BOX / 2,
        height: Y_LABEL_BOX,
        lineHeight: `${Y_LABEL_BOX}px`,
      }}
    >
      {text}
    </span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: opts.height ?? 220 }}>
      {/* Y-axis labels — 72px wide, same height as the plot so each label sits on its value */}
      <div style={{ display: 'flex', position: 'relative', width: 72, paddingRight: 6, height: plotHeight }}>
        {yLabel(opts.yMax, labelYs.max)}
        {showMid && yLabel(opts.yMid, labelYs.mid)}
        {yLabel(opts.yMin, labelYs.min)}
      </div>

      {/* Chart column */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {/* SVG chart — fills available height minus x-axis row */}
        <div style={{ display: 'flex', position: 'relative', height: plotHeight, width: '100%', paddingRight: 8 }}>
          <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity="0.30" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Dashed gridlines */}
            <line x1="0" y1={yMax} x2="100" y2={yMax} stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" strokeDasharray="2,2" />
            {showMid && <line x1="0" y1={yMid} x2="100" y2={yMid} stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" strokeDasharray="2,2" />}
            {/* Zero reference line — only when range spans zero */}
            {minVal < 0 && maxVal > 0 && (
              <line x1="0" y1={toY(0)} x2="94" y2={toY(0)} stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" strokeDasharray="2,2" />
            )}
            {/* Area fill */}
            <polygon points={areaPts} fill={`url(#${gradientId})`} />
            {/* Line (one polyline per run of consecutive months) */}
            {runs.filter(r => r.length >= 2).map((r, i) => (
              <polyline
                key={`run${i}`}
                points={r.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={accentColor}
                strokeWidth="2.0"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {gapSegments.map(({ a, b }, i) => (
              <line key={`gap${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={accentColor} strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="2,2" />
            ))}
            {/* Start reference line */}
            <line x1={pts[0].x} y1={SPARK_Y_TOP} x2={pts[0].x} y2={SPARK_Y_BOTTOM} stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" strokeDasharray="2,2" />
            {/* Terminal dot */}
            <circle cx={pts[0].x} cy={pts[0].y} r="3.0" fill={accentColor} />
            <circle cx={last.x} cy={last.y} r="3.0" fill={accentColor} />
          </svg>
          {/* Gap labels: so a dashed connector can't read as a projection */}
          {gapSegments.filter(g => g.label).map(({ a, b, label }, i) => {
            const midY = (Math.min(a.y, b.y) / VIEW_H) * plotHeight
            return (
              <span
                key={`gl${i}`}
                style={{
                  position: 'absolute',
                  display: 'flex',
                  justifyContent: 'center',
                  left: `${a.x - 6}%`,
                  width: `${b.x - a.x + 12}%`,
                  top: Math.max(0, midY - 22),
                  fontFamily: 'DM Mono',
                  fontSize: 15,
                  color: TERTIARY,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            )
          })}
        </div>

        {/* X-axis labels */}
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', height: SPARK_X_AXIS_ROW, paddingTop: 4 }}>
          <span style={{ ...labelSz, display: 'flex', fontWeight: 700, color: SECONDARY }}>{opts.xLeft}</span>
          <span style={{ ...labelSz, display: 'flex' }}>{opts.xMid}</span>
          <span style={{ ...labelSz, display: 'flex' }}>{opts.xRight}</span>
        </div>
      </div>
    </div>
  )
}
