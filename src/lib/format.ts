// Shared display formatting for cards, charts, share card, OG image and page metadata.
// Signs use a true minus sign (U+2212) so negative amounts never render as "$-0.12".

export const MINUS = '−'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Round, then drop negative zero so "-0.00" never appears. */
function roundTo(v: number, decimals: number): number {
  const r = Number(v.toFixed(decimals))
  return Object.is(r, -0) ? 0 : r
}

/** "+$0.12" / "−$0.12" / "$0.00". Whole dollars get thousands separators. */
export function fmtSignedDollars(v: number, decimals = 2): string {
  const r = roundTo(v, decimals)
  const body = Math.abs(r).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  if (r > 0) return `+$${body}`
  if (r < 0) return `${MINUS}$${body}`
  return `$${body}`
}

/** "$1,234" (unsigned; negatives get a true minus sign). */
export function fmtDollars(v: number, decimals = 0): string {
  const r = roundTo(v, decimals)
  const body = Math.abs(r).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return r < 0 ? `${MINUS}$${body}` : `$${body}`
}

/** "+3.1%" / "−2.3%" / "0.0%". */
export function fmtSignedPct(v: number, digits = 1): string {
  const r = roundTo(v, digits)
  if (r > 0) return `+${r.toFixed(digits)}%`
  if (r < 0) return `${MINUS}${Math.abs(r).toFixed(digits)}%`
  return `${(0).toFixed(digits)}%`
}

/** "+0.6 pts" / "−0.3 pts". */
export function fmtSignedPts(v: number, digits = 1): string {
  const r = roundTo(v, digits)
  const body = Math.abs(r).toFixed(digits)
  return `${r > 0 ? '+' : r < 0 ? MINUS : ''}${body} pts`
}

/** Direction of a change after display rounding (so "+0.0%" never shows an arrow). */
export function directionOf(v: number, digits = 1): 'up' | 'down' | 'neutral' {
  const r = roundTo(v, digits)
  return r > 0 ? 'up' : r < 0 ? 'down' : 'neutral'
}

export const DATE_UNAVAILABLE = 'date unavailable'

/** "YYYY-MM" or "YYYY-MM-DD" → "Aug 2026"; anything else → "date unavailable". Never uses today's date. */
export function fmtMonthYear(d: string | null | undefined): string {
  if (!d) return DATE_UNAVAILABLE
  const m = /^(\d{4})-(\d{2})/.exec(d)
  if (!m) return DATE_UNAVAILABLE
  const mi = parseInt(m[2], 10)
  if (mi < 1 || mi > 12) return DATE_UNAVAILABLE
  return `${MONTHS[mi - 1]} ${m[1]}`
}

/** "YYYY-MM-DD" → "Sep 28, 2026"; "YYYY-MM" → "Aug 2026"; else "date unavailable". */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return DATE_UNAVAILABLE
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return fmtMonthYear(d)
  const mi = parseInt(m[2], 10)
  if (mi < 1 || mi > 12) return DATE_UNAVAILABLE
  return `${MONTHS[mi - 1]} ${parseInt(m[3], 10)}, ${m[1]}`
}

/** "Aug '26" for chart axes / sparkline labels. */
export function fmtMonthShort(d: string | null | undefined): string {
  if (!d) return ''
  const m = /^(\d{4})-(\d{2})/.exec(d)
  if (!m) return ''
  return `${MONTHS[parseInt(m[2], 10) - 1] ?? ''} '${m[1].slice(2)}`
}

/** Months between two YYYY-MM[-DD] strings (b − a). */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

export { isNum as isFiniteNumber }
