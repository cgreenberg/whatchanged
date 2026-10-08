// Simple linear regression for trendline overlay
export function computeTrendline(
  data: Array<{ date: string; [key: string]: unknown }>,
  dataKey: string
): Array<{ date: string; trend: number }> {
  // Only real numbers: Number(null) is 0 and Number('') is 0, which would pull the fit toward zero
  const points = data
    .map((d, i) => ({ x: i, v: d[dataKey] }))
    .filter((p): p is { x: number; v: number } => typeof p.v === 'number' && Number.isFinite(p.v))
    .map(p => ({ x: p.x, y: p.v }))

  if (points.length < 2) return []

  const n = points.length
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n

  return data.map((d, i) => ({
    date: d.date,
    trend: slope * i + intercept,
  }))
}
