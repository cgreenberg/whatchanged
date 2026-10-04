/**
 * Share-card (1080×1080) text-fit and height budget.
 *
 * Satori has no "fill the remaining height" for the sparklines (they need a pixel height to place
 * their axis labels), so each quadrant's sparkline gets whatever the quadrant's text leaves over.
 * The text is measured here: DM Mono is monospaced (advance 0.6em; line height 1.302em from the
 * font's ascender 992 / descender −310 per 1000 units), so its wrapped line count is predictable.
 * A longer footnote or sublabel therefore shrinks the sparkline instead of pushing text out of the
 * cell (overflow: hidden) or under the footer.
 */

export const CARD_SIZE = 1080
export const HEADER_H = 160
export const FOOTER_H = 60
/** Quadrant padding: the bottom is small because the budget below keeps content inside the cell. */
export const CELL_PAD = { top: 16, right: 28, bottom: 8, left: 36 } as const
export const CELL_PADDING = `${CELL_PAD.top}px ${CELL_PAD.right}px ${CELL_PAD.bottom}px ${CELL_PAD.left}px`
/** Quadrant height (each grid row), incl. the 1px divider. */
export const ROW_H = (CARD_SIZE - HEADER_H - FOOTER_H) / 2
/** Text width inside a quadrant (left quadrants also have a 1px right border). */
export const CELL_TEXT_WIDTH = CARD_SIZE / 2 - CELL_PAD.left - CELL_PAD.right - 1
/** Content height inside a quadrant (row minus divider and padding). */
export const CELL_CONTENT_H = ROW_H - 1 - CELL_PAD.top - CELL_PAD.bottom

/** Font sizes / spacing used by the quadrant blocks in generate.tsx. */
export const FS = { label: 40, sublabel: 24, extra: 20, meta: 26, note: 17, big: 96 } as const
export const GAP = { labelBottom: 12, sparkBottom: 8, metaTop: 6, noteTop: 4 } as const

const MONO_ADVANCE = 0.6
const MONO_LINE = 1.302
const BARLOW_LINE = 1.2
/** Rounding slack so a budget that is exactly full never tips Satori into shrinking text. */
const SLACK = 2

/** Line height (px) of DM Mono at this size (Satori's line-height: normal). */
export const monoLineHeight = (fontSize: number) => fontSize * MONO_LINE

/** Characters of DM Mono that fit on one line of this width. */
export const monoCharsPerLine = (fontSize: number, width: number = CELL_TEXT_WIDTH) =>
  Math.max(1, Math.floor(width / (fontSize * MONO_ADVANCE)))

/**
 * Lines DM Mono text wraps to at this width: greedy wrap at spaces (an upper bound — Satori may
 * also break after hyphens, which can only keep or reduce the count). Empty text → 0.
 */
export function monoLines(text: string | null | undefined, fontSize: number, width: number = CELL_TEXT_WIDTH): number {
  const t = (text ?? '').trim()
  if (!t) return 0
  const max = monoCharsPerLine(fontSize, width)
  let lines = 1
  let used = 0
  for (const word of t.split(/\s+/)) {
    const len = [...word].length
    if (used === 0) {
      lines += Math.ceil(len / max) - 1
      used = len % max || max
    } else if (used + 1 + len <= max) {
      used += 1 + len
    } else {
      lines += Math.ceil(len / max)
      used = len % max || max
    }
  }
  return lines
}

/** Height of a quadrant heading block: label (Barlow 40) + optional sublabel (24) + extra line (20). */
export function sectionLabelHeight(sublabel?: string | null, extra?: string | null): number {
  return FS.label * BARLOW_LINE
    + monoLines(sublabel, FS.sublabel) * monoLineHeight(FS.sublabel)
    + monoLines(extra, FS.extra) * monoLineHeight(FS.extra)
    + GAP.labelBottom
}

/** Height of a meta row ("since Jan 2025 … Natl: +x.x%"): both spans share one line when they fit. */
export function metaRowHeight(left: string, right?: string | null): number {
  const text = right ? `${left} ${right}` : left
  return GAP.metaTop + monoLines(text, FS.meta) * monoLineHeight(FS.meta)
}

/** Height of the small amber footnote under a quadrant. */
export function noteHeight(note: string | null | undefined): number {
  const n = monoLines(note, FS.note)
  return n ? GAP.noteTop + n * monoLineHeight(FS.note) : 0
}

/**
 * Sparkline height for a quadrant laid out as: heading → sparkline → big number + pill → meta rows
 * → optional footnote. Whatever the text doesn't use goes to the sparkline (never below `min`).
 */
export function sparklineBudget(parts: {
  sublabel?: string | null
  extra?: string | null
  metaRows: Array<[string, (string | null)?]>
  note?: string | null
}, min = 60): number {
  const text = sectionLabelHeight(parts.sublabel, parts.extra)
    + FS.big
    + parts.metaRows.reduce((h, [l, r]) => h + metaRowHeight(l, r), 0)
    + noteHeight(parts.note)
  return Math.max(min, Math.floor(CELL_CONTENT_H - text - GAP.sparkBottom - SLACK))
}
