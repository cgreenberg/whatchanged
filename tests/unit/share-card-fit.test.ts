/**
 * @jest-environment node
 */
// Share card (1080×1080) text fit: every text slot stays within its line budget for the worst cases,
// and every quadrant's rendered content (estimated from the actual element tree, DM Mono being
// monospaced) fits inside the quadrant — so a long footnote or sublabel shrinks the sparkline
// instead of overlapping the heading or slipping under the footer.
import fs from 'fs'
import path from 'path'
import type { EconomicSnapshot } from '@/types'
import austin from '../fixtures/snapshots/78701.json'
import zipCounty from '@/lib/data/zip-county.json'
import { blsGasData } from '../mocks/bls-gas-data'

jest.mock('@/lib/api/snapshot', () => ({ fetchSnapshot: jest.fn() }))
jest.mock('@/lib/share-card/fonts', () => ({ loadShareFonts: async () => [] }))
jest.mock('@/lib/api/national', () => ({ getCachedNationalData: jest.fn() }))
const mockRendered: unknown[] = []
jest.mock('next/og', () => ({
  ImageResponse: class extends Response {
    constructor(el: unknown) {
      mockRendered.push(el)
      super('png')
    }
  },
}))

import { fetchSnapshot } from '@/lib/api/snapshot'
import {
  generateShareCard, shareGasStandInNote, electricityVsLabel, cpiShareLabel, groceriesBasisNote, shelterBasisNote,
  electricityGeoLine, electricityBasisNote, shelterPillSub,
  GAS_SUBLABEL, GROCERIES_SUBLABEL, SHELTER_SUBLABEL, RENT_SUBLABEL, ELECTRICITY_SUBLABEL,
  shareSeasonalNote,
} from '@/lib/share-card/generate'
import { ELECTRICITY_STATES } from '@/lib/api/eia-electricity'
import { STATE_FIPS_MAP } from '@/lib/mappings/state-fips'
import { electricityPlace } from '@/lib/hero-cards'
import {
  monoLines, monoLineHeight, monoCharsPerLine, sparklineBudget, CELL_CONTENT_H, CELL_TEXT_WIDTH, CARD_SIZE, ROW_H, FS, BIG_UNIT_SCALE,
} from '@/lib/share-card/layout'
import { sparklineGeometry } from '@/lib/share-card/sparklines'
import { fmtSignedDollars, fmtSignedPct } from '@/lib/format'
import { fmtRentDollars } from '@/lib/compute/dollar-translations'
import { BLS_CPI_AREAS } from '@/lib/mappings/county-metro-cpi'
import { CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES, STATE_LEVEL_CODES, PAD_DUOAREA } from '@/lib/mappings/eia-gas'
import { describeDuoarea, toGasPriceData, type GasSeriesData } from '@/lib/api/eia'
import { gasShortGeo, dataThroughLabel, type HeroCardModel } from '@/lib/hero-cards'
import { BLS_GAS_PUBLISHED_AREAS } from '@/lib/mappings/bls-gas'
import { describeBlsGasArea } from '@/lib/api/bls-gas'
import type { CpiData } from '@/types'

const mockFetch = fetchSnapshot as jest.MockedFunction<typeof fetchSnapshot>
const snap = (): EconomicSnapshot => JSON.parse(JSON.stringify(austin))

type Loc = { countyFips: string; countyName: string; stateAbbr: string; cityName?: string }
const hiAkCounties: Loc[] = [
  ...new Map(
    Object.values(zipCounty as Record<string, Loc>)
      .filter((v) => v.stateAbbr === 'HI' || v.stateAbbr === 'AK')
      .map((v) => [v.countyFips, v] as const),
  ).values(),
]

/** Advance width (px) of `text` in a bundled TTF (cmap format 4 + hmtx; no kerning). */
function ttfMeasure(file: string) {
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
  return (text: string, size: number, letterSpacing = 0) => [...text].reduce((w, ch) => {
    const g = glyph(ch.codePointAt(0)!)
    if (!g) throw new Error(`${file} has no glyph for "${ch}"`)
    return w + (b.readUInt16BE(tables.hmtx + 4 * Math.min(g, nHMetrics - 1)) / upm) * size + letterSpacing
  }, 0)
}

// ── Text-slot budgets ────────────────────────────────────────────────────────────

describe('monoLines', () => {
  test('wraps at spaces with DM Mono advance 0.6em', () => {
    // 475px / (24 × 0.6) = 32 chars per line
    expect(monoLines('x'.repeat(32), 24)).toBe(1)
    expect(monoLines('x'.repeat(33), 24)).toBe(2)
    expect(monoLines("(CPI: rents + owners' equiv. rent)", 24)).toBe(2) // the old sublabel wrapped
    expect(monoLines('aaaa bbbb', 10, 10 * 0.6 * 5)).toBe(2)
    expect(monoLines('', 24)).toBe(0)
    expect(monoLines(null, 24)).toBe(0)
  })
})

describe('share-card text slots stay within their line budgets', () => {
  test('quadrant sublabels fit one line', () => {
    for (const s of [GAS_SUBLABEL, GROCERIES_SUBLABEL, SHELTER_SUBLABEL, RENT_SUBLABEL, ELECTRICITY_SUBLABEL]) {
      expect([s, monoLines(s, FS.sublabel)]).toEqual([s, 1])
    }
  })

  test('HI/AK gas stand-in footnote fits two lines for every HI/AK county', () => {
    expect(hiAkCounties.length).toBeGreaterThan(30)
    const notes = hiAkCounties.map((c) => shareGasStandInNote(c))
    const worst = notes.reduce((a, b) => (b.length > a.length ? b : a))
    expect(worst).toContain('Prince of Wales-Hyder area')
    for (const n of notes) {
      expect([n, monoLines(n, FS.note) <= 2]).toEqual([n, true])
      expect(n).not.toContain('C.A.') // reads as California
      expect(n).not.toMatch(/\.[;,]/) // no "Bor.;" punctuation stacking
      expect(n).toContain('trend may differ') // same change caveat as the website / OG
    }
  })

  test('gas geography line (+ BLS "thru" month) fits one line for every gas tier', () => {
    const thru = " · thru Sep '26"
    const eia = [
      'NUS', 'R5XCA', ...Object.values(PAD_DUOAREA),
      ...Object.values(STATE_LEVEL_CODES).map((c) => c.duoarea),
    ].map((d) => describeDuoarea(d).geoLevel!)
    const cities = [...Object.values(CPI_TO_EIA_CITY), ...Object.values(COUNTY_EIA_CITY_OVERRIDES)].map((c) => c.label)
    const geos = [...eia, ...cities].map((g) => g.replace('excl. California', 'excl. CA'))
    geos.push('National avg (local data unavailable)')
    // BLS monthly tiers use the card's short geo tag + the month the figure runs through
    const dummy = { current: 3, baseline: 3, change: 0, baselineDate: '2025-01', latestDate: '2026-09', regionName: '', series: [] } as unknown as GasSeriesData
    const bls = [...BLS_GAS_PUBLISHED_AREAS].filter((a) => /^S/.test(a)).flatMap((a) =>
      (a === 'S49F' || a === 'S49G' ? [false, true] : [false]).map((standIn) => `${gasShortGeo(toGasPriceData(describeBlsGasArea(a, { standIn }), dummy))}${thru}`),
    )
    expect(bls).toContain("Honolulu-area price* · thru Sep '26")
    expect([...geos, ...bls].filter((g) => monoLines(g, FS.extra) > 1)).toEqual([
      // too long with the month: the card moves "thru Sep '26" to the baseline row (see test below)
      "Minneapolis-St. Paul metro · thru Sep '26",
      "Riverside-San Bernardino metro · thru Sep '26",
    ])
    expect(bls.map((g) => g.replace(thru, '')).filter((g) => monoLines(g, FS.extra) > 1)).toEqual([])
    expect(monoLines("since Jan 2025, thru Sep '26", FS.meta)).toBe(1)
  })

  // Every state EIA publishes (50 + DC), at the widest realistic price (59.9¢) and a 4-digit kWh
  const elecStates = ELECTRICITY_STATES.map((st) => ({
    state: st, stateName: Object.values(STATE_FIPS_MAP).find((v) => v.abbr === st)!.name, current: 59.9, latestPeriod: '2026-12',
  }))

  test('electricity geography line ("Maine · 29.3¢/kWh (12 mo to Jul \'26)") fits one line for every state', () => {
    const lines = elecStates.map((e) => electricityGeoLine(e))
    expect(lines).toContain("DC · 59.9¢/kWh (12 mo to Dec '26)")
    expect(lines).toContain("Maine · 59.9¢/kWh (12 mo to Dec '26)")
    expect(lines).toContain("MA · 59.9¢/kWh (12 mo to Dec '26)")
    for (const l of lines) expect([l, monoLines(l, FS.extra)]).toEqual([l, 1])
  })

  test('electricity $/mo basis fits one line for every state (4-digit kWh)', () => {
    for (const e of elecStates) {
      const n = electricityBasisNote(1999.6, electricityPlace(e, 'short'))
      expect([n, monoLines(n, FS.note)]).toEqual([n, 1])
    }
  })

  test('electricity big number (% change) + $/mo pill fit one row at the widest values', () => {
    const bebas = ttfMeasure('BebasNeue-Regular.ttf')
    const barlow = ttfMeasure('BarlowCondensed-SemiBold.ttf')
    for (const pct of [fmtSignedPct(99.9), fmtSignedPct(-49.9)]) {
      for (const pill of [`≈ ${fmtSignedDollars(999, 0)}/mo`, `≈ ${fmtSignedDollars(-999, 0)}/mo`]) {
        const row = bebas(pct, FS.big) + barlow(pill, 40) + 2 * 20 + 2 * 1.5 + 12
        expect([pct, pill, row <= CELL_TEXT_WIDTH]).toEqual([pct, pill, true])
      }
    }
  })

  test('header CPI label fits one line beside the date badge for every CPI area and tier', () => {
    // Widest data-through badge: a span across a year end ("DEC 2026–JAN 2027")
    const card = (asOfPeriod: string) => ({ status: 'ok', asOfPeriod }) as HeroCardModel
    const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)
    const badges = [...months.map((lo) => dataThroughLabel([card(lo), card('2027-01')])!), ...months.map((hi) => dataThroughLabel([card(hi)])!)]
    expect(badges).toContain('DEC 2026–JAN 2027')
    // DM Mono 22px + 0.06em letter spacing, 2×16 padding + 2×1 border; the badge is as wide as its widest line
    const mono = ttfMeasure('DMMono-Regular.ttf')
    const badgeW = Math.max(...[...badges, 'JAN 20, 2025'].map((t) => mono(t, 22, 0.06 * 22))) + 2 * 16 + 2
    expect(badgeW).toBeGreaterThan(270)
    const headerWidth = CARD_SIZE - 80 - Math.ceil(badgeW)
    const base = snap().cpi.data!
    // Each area at its own tier (S… metro = 1, 0110–0490 division = 2, 0100–0400 region = 3, 0000 = 4)
    const tierOf = (code: string) => (/^S/.test(code) ? 1 : code === '0000' ? 4 : /^0[1-4]00$/.test(code) ? 3 : 2)
    const labels = Object.values(BLS_CPI_AREAS).map((a) =>
      cpiShareLabel({ ...base, areaCode: a.code, metro: a.name, tier: tierOf(a.code) } as CpiData)!,
    )
    expect(labels).toContain('CPI: Miami-Fort Lauderdale-West Palm Beach (metro)')
    expect(labels).toContain('CPI: East South Central (Census division)')
    labels.push(cpiShareLabel({ ...base, fallback: 'national' } as CpiData)!)
    for (const l of labels) expect([l, monoLines(l, 20, headerWidth)]).toEqual([l, 1])
  })

  test('shelter big number + "$/yr" pill fit one row; a coded rent qualifies the amount on the pill\'s second line', () => {
    const bebas = ttfMeasure('BebasNeue-Regular.ttf')
    const barlow = ttfMeasure('BarlowCondensed-SemiBold.ttf')
    // Widest realistic: shelter ±19.9%, a top-coded $3,500+ rent × 12 × a ±19.9% rent index ≈ ±$8,358/yr
    for (const pct of [fmtSignedPct(19.9), fmtSignedPct(-19.9)]) {
      for (const coded of [undefined, 'top', 'bottom'] as const) {
        for (const d of [8358, -8358]) {
          const pill = `≈ ${fmtSignedDollars(d, 0)}/yr`
          const sub = shelterPillSub({ basis: 'zip', rentCoded: coded }, d)
          // two-line pill: the wider of Barlow 40 text / Barlow 24 sub + 2×18 padding + 2×1.5 border + 12 margin
          const row = bebas(pct, FS.big) + Math.max(barlow(pill, 40), barlow(sub, 24)) + 2 * 18 + 2 * 1.5 + 12
          expect([pct, pill, sub, row <= CELL_TEXT_WIDTH]).toEqual([pct, pill, sub, true])
        }
      }
    }
    // Magnitude wording, sign-aware: a coded base bounds the SIZE of the amount (a decrease is money saved)
    expect(shelterPillSub({ basis: 'zip', rentCoded: 'top' }, 1234)).toBe('or more in rent')
    expect(shelterPillSub({ basis: 'zip', rentCoded: 'top' }, -420)).toBe('or more saved in rent')
    expect(shelterPillSub({ basis: 'zip', rentCoded: 'bottom' }, 12)).toBe('or less in rent')
    expect(shelterPillSub({ basis: 'zip', rentCoded: 'bottom' }, -12)).toBe('or less saved in rent')
    expect(shelterPillSub({ basis: 'county' }, -420)).toBe('in rent')
    expect(shelterPillSub({ basis: 'county', rentCoded: 'top' }, 1234)).toBe('in rent')
    // Website card face: the same qualifier after the amount
    expect(fmtRentDollars(1234, 'top')).toBe('≈ +$1,234/yr or more')
    expect(fmtRentDollars(-420, 'top')).toBe('≈ −$420/yr or more saved')
    expect(fmtRentDollars(12, 'bottom')).toBe('≈ +$12/yr or less')
    expect(fmtRentDollars(-12, 'bottom')).toBe('≈ −$12/yr or less saved')
    expect(fmtRentDollars(0, 'top')).toBe('≈ $0/yr')
    expect(fmtRentDollars(1234)).toBe('≈ +$1,234/yr')
  })

  test('gas big number (the $ change, smaller "/gal") + two-line "$ / now" pill fit one row at the widest realistic values', () => {
    const bebas = ttfMeasure('BebasNeue-Regular.ttf')
    const barlow = ttfMeasure('BarlowCondensed-SemiBold.ttf')
    for (const change of [4.44, -4.44]) {
      const big = bebas(fmtSignedDollars(change), FS.big) + bebas('/gal', Math.round(FS.big * BIG_UNIT_SCALE))
      // two-line pill ("$9.99" over "now"): wider of Barlow 40 / Barlow 24 + 2×18 padding + 2×1.5 border + 12 margin
      const row = big + Math.max(barlow('$9.99', 40), barlow('now', 24)) + 2 * 18 + 2 * 1.5 + 12
      expect([change, row <= CELL_TEXT_WIDTH]).toEqual([change, true])
    }
  })

  test('no real string combination reaches the 60px sparkline floor', () => {
    const oneLineGeo = 'x'.repeat(monoCharsPerLine(FS.extra)) // any gas geography (each fits one line, above)
    const gasRows: Array<[string, (string | null)?]> = [["since Jan 2025, thru Sep '26"], [`Natl (BLS Sep '26): ${fmtSignedDollars(-4.44)}`]]
    const worstNote = hiAkCounties.map((c) => shareGasStandInNote(c)).reduce((a, b) => (monoLines(b, FS.note) > monoLines(a, FS.note) ? b : a))
    const budgets = {
      gas: sparklineBudget({ sublabel: GAS_SUBLABEL, extra: oneLineGeo, metaRows: gasRows }, 0),
      // a stand-in gives the sublabel's line to its footnote
      gasStandIn: sparklineBudget({ sublabel: '', extra: oneLineGeo, metaRows: gasRows, note: worstNote }, 0),
      groceries: sparklineBudget({ sublabel: GROCERIES_SUBLABEL, metaRows: [['since Dec 2024', 'Natl: +10.0%']], note: groceriesBasisNote() }, 0),
      shelter: sparklineBudget({ sublabel: SHELTER_SUBLABEL, metaRows: [['since Dec 2024', 'Natl: +10.0%']], note: shelterBasisNote(12345) }, 0),
      electricity: sparklineBudget({
        sublabel: ELECTRICITY_SUBLABEL, extra: electricityGeoLine(elecStates.find((e) => e.state === 'MA')!),
        metaRows: [[electricityVsLabel(), 'Natl: +10.0%']], note: electricityBasisNote(1999, 'Massachusetts'),
      }, 0),
    }
    for (const [k, h] of Object.entries(budgets)) expect([k, h > 60]).toEqual([k, true])
    expect(monoLines(shelterBasisNote(12345), FS.meta)).toBeGreaterThan(0)
    expect(monoLines(shelterBasisNote(12345), FS.note)).toBe(1)
    // The electricity meta row ("vs Aug'24–Jul'25" + "Natl: −10.0%") leaves at least a 2-character gap
    expect(`${electricityVsLabel()}  Natl: −10.0%`.length).toBeLessThanOrEqual(monoCharsPerLine(FS.meta))
    // Borrowed rent bases name their source and still fit one line
    for (const c of [{ basis: 'nearest-zip', donorZip: '35464' }, { basis: 'po-donor', donorZip: '10025' }, { basis: 'county' }, { basis: 'state' }]) {
      expect([c.basis, monoLines(shelterBasisNote(12345, c), FS.note)]).toEqual([c.basis, 1])
    }
    expect(monoLines(groceriesBasisNote(), FS.note)).toBe(1)
    // the short stand-in gas plot drops the mid y-label so max/mid/min never touch; taller plots keep it
    expect(sparklineGeometry([1, 2], { height: budgets.gasStandIn }).showMid).toBe(false)
    expect(sparklineGeometry([1, 2], { height: budgets.gas }).showMid).toBe(true)
  })

  test('sparkline keeps a usable height in the worst case (HI/AK stand-in, wrapped geography)', () => {
    const worst = sparklineBudget({
      sublabel: '',
      extra: "Anchorage-area price* · thru Sep '26",
      metaRows: [['since Jan 2025'], ["Natl (BLS Sep '26): +$0.99"]],
      note: shareGasStandInNote({ countyFips: '02198', countyName: 'Prince of Wales-Hyder Census Area' }),
    })
    expect(worst).toBeGreaterThanOrEqual(80)
    // a longer footnote shrinks the sparkline by exactly its extra line
    const three = sparklineBudget({ sublabel: '', metaRows: [['a']], note: 'x '.repeat(60) })
    const two = sparklineBudget({ sublabel: '', metaRows: [['a']], note: 'x '.repeat(30) })
    expect(two - three).toBeGreaterThanOrEqual(Math.floor(monoLineHeight(FS.note)) - 1)
  })
})

// ── Rendered tree: quadrant content never exceeds the quadrant ────────────────────

type El = { type: unknown; props: { style?: Record<string, unknown>; children?: unknown } }
const isEl = (n: unknown): n is El => !!n && typeof n === 'object' && 'props' in (n as object)
const kids = (n: El): unknown[] => [n.props.children].flat(Infinity).filter((c) => c != null && c !== false && c !== true && c !== '')
function textOf(n: unknown): string {
  if (n == null || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  return isEl(n) ? textOf(n.props.children) : ''
}
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) || 0 : 0)
function padding(style: Record<string, unknown>) {
  const p = typeof style.padding === 'string' ? style.padding.split(/\s+/).map(num) : [num(style.padding)]
  const [t, r = t, b = t, l = r] = p
  return { t: num(style.paddingTop) || t, r: num(style.paddingRight) || r, b: num(style.paddingBottom) || b, l: num(style.paddingLeft) || l }
}
function lineHeight(style: Record<string, unknown>): number {
  const fs = num(style.fontSize) || 16
  if (typeof style.lineHeight === 'number') return style.lineHeight * fs
  return style.fontFamily === 'DM Mono' ? monoLineHeight(fs) : 1.2 * fs // Barlow / Bebas: (asc − desc) = 1.2em
}
/** Outer height (incl. vertical margins) of an element laid out at this width. */
function boxHeight(n: unknown, width: number): number {
  if (!isEl(n)) return 0
  const style = n.props.style ?? {}
  if (style.position === 'absolute') return 0
  const m = num(style.marginTop) + num(style.marginBottom)
  if (typeof style.height === 'number') return style.height + m
  if (n.type === 'span') {
    const fs = num(style.fontSize) || 16
    const lines = style.fontFamily === 'DM Mono' ? monoLines(textOf(n), fs, width) : 1
    return lines * lineHeight(style) + m
  }
  const p = padding(style)
  const inner = width - p.l - p.r
  const children = kids(n).filter(isEl)
  let h: number
  if (style.flexDirection === 'column') {
    h = children.reduce((s, c) => s + boxHeight(c, inner), 0)
  } else if (children.length > 1 && children.every((c) => c.type === 'span')) {
    // a row of text spans (meta row): they share the line, so wrap the joined text
    const st = children[0].props.style ?? {}
    h = monoLines(children.map(textOf).join(' '), num(st.fontSize), inner) * lineHeight(st)
  } else {
    h = Math.max(0, ...children.map((c) => boxHeight(c, inner)))
  }
  return h + p.t + p.b + m
}
/** The four quadrants: relative, overflow-hidden cells. */
function quadrants(n: unknown, out: El[] = []): El[] {
  if (!isEl(n)) return out
  const s = n.props.style ?? {}
  if (s.position === 'relative' && s.overflow === 'hidden') out.push(n)
  else kids(n).forEach((c) => quadrants(c, out))
  return out
}
function quadrantOverflow(q: El): { label: string; content: number; available: number } {
  const s = q.props.style ?? {}
  const p = padding(s)
  const width = CARD_SIZE / 2 - p.l - p.r - (s.borderRight ? 1 : 0)
  const content = kids(q).reduce<number>((h, c) => h + boxHeight(c, width), 0)
  const label = textOf(q).slice(0, 40)
  return { label, content, available: ROW_H - 1 - p.t - p.b }
}

async function renderedQuadrants(s: EconomicSnapshot) {
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const qs = quadrants(mockRendered[mockRendered.length - 1])
  expect(qs).toHaveLength(4)
  return qs.map(quadrantOverflow)
}

describe('share-card quadrants: rendered content fits inside each quadrant', () => {
  const expectFits = (rows: Array<{ label: string; content: number; available: number }>) => {
    for (const r of rows) expect([r.label, r.content <= r.available + 0.5]).toEqual([r.label, true])
  }

  test('layout constants match the card', () => {
    expect(CELL_TEXT_WIDTH).toBe(475)
    expect(CELL_CONTENT_H).toBe(405)
  })

  test('EIA gas + Zillow rent (Austin)', async () => {
    expectFits(await renderedQuadrants(snap()))
  })

  test('rent seasonal-pattern caveat: † on the % and a footnote, still fits (also with the outlier note, worst case)', async () => {
    const s = snap()
    // widest realistic footnote: 4-digit $/mo bias on a top rent, and the outlier note above it
    s.rent = { ...s.rent!, pct: 22.2, curRent: 14561, monthlyChange: 2646, saCaveat: { gap: -12.5, month: 12 } }
    const note = shareSeasonalNote(s.rent.saCaveat, s.rent, '‡')!
    expect(note).toMatch(/^‡ Seasonal pattern uncertain: the Dec reading may understate the change by ~12\.5 pts \(≈ \$[\d,]+\/mo\)$/)
    expect(monoLines(note, 19, CELL_TEXT_WIDTH)).toBeLessThanOrEqual(3)
    expectFits(await renderedQuadrants(s))
    // under the outlier note only the short form fits
    expect(shareSeasonalNote(s.rent.saCaveat, s.rent, '‡', true)).toBe('‡ Seasonal pattern uncertain')
    expectFits(await renderedQuadrants({ ...s, rent: { ...s.rent, flagged: true } as EconomicSnapshot['rent'] }))
    const plain = snap()
    plain.rent = { ...plain.rent!, saCaveat: { gap: 2.5, month: 8 } }
    expect(shareSeasonalNote(plain.rent.saCaveat, plain.rent)).toMatch(/^† Seasonal pattern uncertain: the Aug reading may overstate the change by ~2\.5 pts/)
    expect(shareSeasonalNote(undefined, plain.rent)).toBeNull()
  })

  test('electricity quadrant: statewide price, adjusted %, $/mo pill and its basis', async () => {
    const s = snap()
    await renderedQuadrants(s)
    const t = textOf(mockRendered[mockRendered.length - 1])
    const e = s.electricity.data!
    expect(t).toContain('ELECTRICITY')
    expect(t).toContain(electricityGeoLine(e))
    expect(t).toContain(fmtSignedPct(e.change))
    expect(t).toContain(`≈ ${fmtSignedDollars(s.dollarImpact!.electricity!, 0)}/mo`)
    expect(t).toContain(electricityBasisNote(e.usageKwh!, 'Texas'))
    expect(t).not.toMatch(/tariff|yale/i)
  })

  test('territory (no EIA electricity): N/A quadrant, still fits', async () => {
    const s = snap()
    s.electricity = { ...s.electricity, data: null }
    s.dollarImpact = { ...s.dollarImpact!, electricity: null }
    expectFits(await renderedQuadrants(s))
    expect(textOf(mockRendered[mockRendered.length - 1])).toContain('N/A')
  })

  test('CPI shelter fallback (no county rent) + EIA national fallback geography', async () => {
    const s = snap()
    s.rent = null
    s.gas.data = { ...s.gas.data!, isNationalFallback: true, geoLevel: 'National avg' }
    expectFits(await renderedQuadrants(s))
  })

  test('long BLS metro name: the as-of month moves to the baseline row, geography stays one line', async () => {
    const s = snap()
    s.gas.data = { ...blsGasData('S49F'), blsArea: 'S49C', areaName: 'Riverside-San Bernardino', geoLevel: 'Riverside-San Bernardino metro avg' }
    s.location = { ...s.location, stateAbbr: 'CA', countyFips: '06071', countyName: 'San Bernardino County' }
    expectFits(await renderedQuadrants(s))
    const t = textOf(mockRendered[mockRendered.length - 1])
    expect(t).toContain('Riverside-San Bernardino metro')
    expect(t).not.toContain('Riverside-San Bernardino metro · thru')
    expect(t).toMatch(/since Jan 2025, thru [A-Z][a-z]{2} '\d{2}/)
  })

  test('every HI/AK county as a gas stand-in, with the CPI shelter fallback', async () => {
    const hi = blsGasData('S49F', { standIn: true })
    const ak = blsGasData('S49G', { standIn: true })
    for (const c of hiAkCounties) {
      const s = snap()
      s.location = { ...s.location, stateAbbr: c.stateAbbr, countyFips: c.countyFips, countyName: c.countyName, cityName: c.cityName ?? s.location.cityName }
      s.gas.data = c.stateAbbr === 'HI' ? hi : ak
      s.rent = null
      const rows = await renderedQuadrants(s)
      expect(textOf(mockRendered[mockRendered.length - 1])).toContain('No gas series for')
      expectFits(rows)
    }
  }, 60000)
})
