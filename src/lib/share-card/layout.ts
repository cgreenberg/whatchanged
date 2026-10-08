/**
 * Share-card (1080×1080) layout: one fixed template for all four quadrants.
 *
 * Each quadrant stacks fixed-height slots — title, big number + pill, chart, source line — so every chart gets the
 * same height. The only variable-height block is the shared footnote zone above the footer (outlier, HI/AK gas
 * stand-in, rent seasonal caveat); it takes its height from both grid rows equally, so the four charts shrink together
 * and stay identical. DM Mono is monospaced (advance 0.6em; line height 1.302em from the font's ascender 992 /
 * descender −310 per 1000 units), so wrapped line counts are predictable (tests/unit/share-card-fit.test.ts).
 */

export const CARD_SIZE = 1080
export const HEADER_H = 140
export const FOOTER_H = 60
/** Horizontal padding of the header, footnote zone and footer. */
export const SIDE_PAD = 40
/** Quadrant padding. */
export const CELL_PAD = { top: 18, right: 28, bottom: 12, left: 36 } as const
export const CELL_PADDING = `${CELL_PAD.top}px ${CELL_PAD.right}px ${CELL_PAD.bottom}px ${CELL_PAD.left}px`
/** Text width inside a quadrant (left quadrants also have a 1px right border). */
export const CELL_TEXT_WIDTH = CARD_SIZE / 2 - CELL_PAD.left - CELL_PAD.right - 1

/** Font sizes used by the quadrant slots in generate.tsx. */
export const FS = { title: 34, titleTag: 20, big: 96, pill: 34, pillSub: 20, source: 20, footnote: 17, axis: 18 } as const
/** Gap (px) between a quadrant title and its small tag ("RENT (NEW LISTINGS)  seas. adj."). */
export const TITLE_TAG_GAP = 14
/** A unit after a big number ("/gal") is drawn at this fraction of FS.big. */
export const BIG_UNIT_SCALE = 0.55
/** Fixed slot heights and gaps (px), top to bottom. */
export const SLOT = { title: 36, titleGap: 8, big: 96, bigGap: 14, sourceGap: 10, source: 26 } as const
/** Height of everything in a quadrant except the chart. */
export const QUADRANT_TEXT_H = SLOT.title + SLOT.titleGap + SLOT.big + SLOT.bigGap + SLOT.sourceGap + SLOT.source

/** Chart internals: y-label column width and x-label row height (px). */
export const CHART_Y_AXIS_W = 74
export const CHART_X_AXIS_H = 26
/** Plot width (px) of every chart. */
export const CHART_PLOT_W = CELL_TEXT_WIDTH - CHART_Y_AXIS_W
/** No combination of footnotes may push the charts below this height. */
export const MIN_CHART_H = 150

/** Footnote zone: DM Mono 17px across the card, with this vertical padding. */
export const FOOTNOTE_W = CARD_SIZE - 2 * SIDE_PAD
export const FOOTNOTE_PAD_Y = 8

const MONO_ADVANCE = 0.6
const MONO_LINE = 1.302

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

/** Height (px) of the shared footnote zone: 0 without notes. */
export function footnoteZoneHeight(notes: string[]): number {
  if (!notes.length) return 0
  const lines = notes.reduce((n, t) => n + monoLines(t, FS.footnote, FOOTNOTE_W), 0)
  return Math.ceil(lines * monoLineHeight(FS.footnote) + 2 * FOOTNOTE_PAD_Y)
}

/** Height of each grid row (incl. its 1px divider) once the footnote zone has taken its share. */
export function rowHeight(footnoteH: number): number {
  return Math.floor((CARD_SIZE - HEADER_H - FOOTER_H - footnoteH) / 2)
}

/** Chart height in every quadrant (they are all the same). */
export function chartHeight(footnoteH: number): number {
  return rowHeight(footnoteH) - 1 - CELL_PAD.top - CELL_PAD.bottom - QUADRANT_TEXT_H
}

/**
 * A quadrant's source line ("Anchorage metro · BLS · Aug '26") on one line: DM Mono 20px, else 18px or 16px; a line
 * still too long at 16px keeps its source and month and shortens the place with "…".
 */
export function fitSourceLine(text: string, width: number = CELL_TEXT_WIDTH): { text: string; fontSize: number } {
  for (const fontSize of [FS.source, 18, 16]) {
    if ([...text].length <= monoCharsPerLine(fontSize, width)) return { text, fontSize }
  }
  const max = monoCharsPerLine(16, width)
  const parts = text.split(' · ')
  const tail = parts.length > 1 ? ` · ${parts.slice(1).join(' · ')}` : ''
  const room = Math.max(1, max - [...tail].length - 1)
  const head = [...parts[0]].slice(0, room).join('').trimEnd()
  return { text: `${head}…${tail}`, fontSize: 16 }
}
