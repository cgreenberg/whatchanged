// Sparkline dot geometry for the national OG image (kept out of the route file: Next route
// modules may only export route handlers/config).

export const DOT_PAD = 10 // inset so edge dots aren't clipped

type Point = { value: number }

/** Dot x position; a 0/1-point series sits mid-panel (never NaN/Infinity). */
export function computeDotX(series: Point[], index: number, width: number): number {
  if (series.length <= 1) return width / 2
  const usableWidth = width - 2 * DOT_PAD
  const idx = Math.min(series.length - 1, Math.max(0, index < 0 ? series.length + index : index))
  return DOT_PAD + (idx / (series.length - 1)) * usableWidth
}

/** Dot y position; empty series or non-finite values sit mid-panel. */
export function computeDotY(series: Point[], index: number, height: number): number {
  if (series.length === 0) return height / 2
  const values = series.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const usableH = height - 2 * DOT_PAD
  const idx = Math.min(series.length - 1, Math.max(0, index < 0 ? series.length + index : index))
  const y = DOT_PAD + usableH - ((series[idx].value - min) / range) * usableH
  return Number.isFinite(y) ? y : height / 2
}
