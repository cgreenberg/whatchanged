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
  }
): React.ReactElement | null {
  if (values.length < 2) return null;

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const minVal = opts.bounds ? opts.bounds.min : dataMin;
  const maxVal = opts.bounds ? opts.bounds.max : dataMax;
  const range = maxVal - minVal || 1;

  // Map value → SVG y (inverted: higher value = lower y)
  // Y range: 5 (top, max) to 45 (bottom, min) within viewBox 0 0 100 50
  const toY = (v: number): number => 45 - ((v - minVal) / range) * 40;

  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * 100,
    y: toY(v),
  }));

  const linePts = pts.map(p => `${p.x},${p.y}`).join(' ');
  const areaPts = [
    ...pts.map(p => `${p.x},${p.y}`),
    '100,50',
    '0,50',
  ].join(' ');
  const last = pts[pts.length - 1];

  // Gridline y-positions for min/mid/max
  const yMax = toY(maxVal);
  const yMid = toY((minVal + maxVal) / 2);

  const labelSz = { fontFamily: 'DM Mono', fontSize: 22, color: TERTIARY }

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: 220 }}>
      {/* Y-axis labels — 72px wide */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 72, paddingRight: 6, height: '100%' }}>
        <span style={{ ...labelSz, display: 'flex' }}>{opts.yMax}</span>
        <span style={{ ...labelSz, display: 'flex' }}>{opts.yMid}</span>
        <span style={{ ...labelSz, display: 'flex' }}>{opts.yMin}</span>
      </div>

      {/* Chart column */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {/* SVG chart — fills available height minus x-axis row */}
        <div style={{ display: 'flex', flex: 1, width: '100%' }}>
          <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity="0.30" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Dashed gridlines */}
            <line x1="0" y1={yMax} x2="100" y2={yMax} stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" strokeDasharray="2,2" />
            <line x1="0" y1={yMid} x2="100" y2={yMid} stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" strokeDasharray="2,2" />
            {/* Area fill */}
            <polygon points={areaPts} fill={`url(#${gradientId})`} />
            {/* Line */}
            <polyline
              points={linePts}
              fill="none"
              stroke={accentColor}
              strokeWidth="2.0"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Terminal dot */}
            <circle cx={last.x} cy={last.y} r="3.0" fill={accentColor} />
          </svg>
        </div>

        {/* X-axis labels */}
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', height: 28, paddingTop: 4 }}>
          <span style={{ ...labelSz, display: 'flex' }}>{opts.xLeft}</span>
          <span style={{ ...labelSz, display: 'flex' }}>{opts.xMid}</span>
          <span style={{ ...labelSz, display: 'flex' }}>{opts.xRight}</span>
        </div>
      </div>
    </div>
  )
}

/** Bar chart for tariff cell — shows escalating tariff costs since Jan 2025.
 *  Returns null if annualCost is 0 (consistent with buildLineSparklineV3).
 */
export function buildTariffBarChart(
  annualCost: number,
  accentColor: string,
  gradientId: string,
): React.ReactElement | null {
  if (annualCost <= 0) return null

  // 8 bars representing monthly tariff escalation Jan 2025 → Aug 2025+
  const weights = [0.05, 0.12, 0.30, 0.65, 0.85, 0.95, 0.98, 1.0]

  const barW = 9
  const gap = 3.4
  const bars = weights.map((w, i) => {
    const x = i * (barW + gap) + 1
    const h = w * 40
    const y = 45 - h
    const opacity = 0.35 + (i / (weights.length - 1)) * 0.65
    return { x, y, h, opacity }
  })

  const yMaxLabel = annualCost >= 1000
    ? `$${(annualCost / 1000).toFixed(1)}k`
    : `$${Math.round(annualCost)}`
  const yMidLabel = annualCost >= 1000
    ? `$${(annualCost / 2000).toFixed(1)}k`
    : `$${Math.round(annualCost / 2)}`

  const labelSz = { fontFamily: 'DM Mono', fontSize: 22, color: TERTIARY }

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: 220 }}>
      {/* Y-axis labels */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 72, paddingRight: 6, height: '100%' }}>
        <span style={{ ...labelSz, display: 'flex' }}>{yMaxLabel}</span>
        <span style={{ ...labelSz, display: 'flex' }}>{yMidLabel}</span>
        <span style={{ ...labelSz, display: 'flex' }}>$0</span>
      </div>

      {/* Chart column */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ display: 'flex', flex: 1, width: '100%' }}>
          <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity="1" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="0.4" />
              </linearGradient>
            </defs>
            {/* Midline gridline */}
            <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" strokeDasharray="2,2" />
            {/* Bars */}
            {bars.map((b, i) => (
              <rect
                key={i}
                x={b.x}
                y={b.y}
                width={barW}
                height={b.h}
                fill={`url(#${gradientId})`}
                opacity={b.opacity}
                rx="0.5"
              />
            ))}
          </svg>
        </div>
        {/* X-axis labels */}
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', height: 28, paddingTop: 4 }}>
          <span style={{ ...labelSz, display: 'flex' }}>Jan &apos;25</span>
          <span style={{ ...labelSz, display: 'flex' }}>May &apos;25</span>
          <span style={{ ...labelSz, display: 'flex' }}>now</span>
        </div>
      </div>
    </div>
  )
}
