import React from 'react';

export function buildLineSparkline(
  values: number[],
  accentColor: string,
  gradientId: string
): React.ReactElement | null {
  if (values.length < 2) return null;

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // Map data values to Y range 5–31 (inverted: higher value = lower Y in SVG coords)
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

  return (
    <svg
      viewBox="0 0 100 36"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100px' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accentColor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* X-axis (bottom) */}
      <line x1="0" y1="36" x2="100" y2="36" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
      {/* Y-axis (left) */}
      <line x1="0" y1="0" x2="0" y2="36" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
      <polygon
        points={polygonPoints}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={accentColor}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={last.x}
        cy={last.y}
        r="2"
        fill={accentColor}
      />
    </svg>
  );
}
