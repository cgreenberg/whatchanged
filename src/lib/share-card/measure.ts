// Text widths from the bundled share-card fonts (public/fonts): TrueType cmap format 4 + hmtx advances, no kerning
// (Satori applies none for these fonts at these sizes). Used to fit the place name in the share-card header and by
// tests/unit/share-card-fit.test.ts to prove every big-number row fits its quadrant.
import fs from 'fs'
import path from 'path'

export type Measure = (text: string, size: number, letterSpacing?: number) => number

const cache = new Map<string, Measure | null>()

function parse(file: string): Measure {
  const b = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', file))
  const tables: Record<string, number> = {}
  for (let i = 0; i < b.readUInt16BE(4); i++) tables[b.toString('latin1', 12 + 16 * i, 16 + 16 * i)] = b.readUInt32BE(20 + 16 * i)
  const upm = b.readUInt16BE(tables.head + 18)
  const nHMetrics = b.readUInt16BE(tables.hhea + 34)
  const cmap = tables.cmap
  let sub = -1
  for (let i = 0; i < b.readUInt16BE(cmap + 2) && sub < 0; i++) {
    const off = cmap + b.readUInt32BE(cmap + 8 + 8 * i)
    if (b.readUInt16BE(off) === 4) sub = off
  }
  if (sub < 0) throw new Error(`${file}: no cmap format 4`)
  const segX2 = b.readUInt16BE(sub + 6)
  const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2
  const glyph = (cp: number): number => {
    for (let i = 0; i < segX2 / 2; i++) {
      if (cp > b.readUInt16BE(ends + 2 * i)) continue
      const start = b.readUInt16BE(starts + 2 * i)
      if (cp < start) return 0
      const delta = b.readInt16BE(deltas + 2 * i), ro = b.readUInt16BE(ranges + 2 * i)
      if (!ro) return (cp + delta) & 0xffff
      const g = b.readUInt16BE(ranges + 2 * i + ro + 2 * (cp - start))
      return g ? (g + delta) & 0xffff : 0
    }
    return 0
  }
  return (text, size, letterSpacing = 0) => [...text].reduce((w, ch) => {
    const g = glyph(ch.codePointAt(0)!)
    if (!g) throw new Error(`${file} has no glyph for "${ch}"`)
    return w + (b.readUInt16BE(tables.hmtx + 4 * Math.min(g, nHMetrics - 1)) / upm) * size + letterSpacing
  }, 0)
}

/** Strict measure (throws on a missing glyph); for tests. */
export function ttfMeasure(file: string): Measure {
  return parse(file)
}

/**
 * Lenient measure for rendering: a missing glyph or unreadable font falls back to `fallbackEm` per character, so a
 * font problem never breaks the image (it can only make the fit conservative).
 */
export function fontMeasure(file: string, fallbackEm: number): Measure {
  if (!cache.has(file)) {
    try {
      cache.set(file, parse(file))
    } catch {
      cache.set(file, null)
    }
  }
  const m = cache.get(file)
  return (text, size, letterSpacing = 0) => {
    if (m) {
      try {
        return m(text, size, letterSpacing)
      } catch {
        // fall through
      }
    }
    return [...text].length * (size * fallbackEm + letterSpacing)
  }
}
