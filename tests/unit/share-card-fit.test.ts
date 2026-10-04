/**
 * @jest-environment node
 */
// Share card (1080×1080) text fit: every text slot stays within its line budget for the worst cases,
// and every quadrant's rendered content (estimated from the actual element tree, DM Mono being
// monospaced) fits inside the quadrant — so a long footnote or sublabel shrinks the sparkline
// instead of overlapping the heading or slipping under the footer.
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
  generateShareCard, shareGasStandInNote, cpiShareLabel,
  GAS_SUBLABEL, GROCERIES_SUBLABEL, SHELTER_SUBLABEL, RENT_SUBLABEL, TARIFF_SUBLABEL,
} from '@/lib/share-card/generate'
import {
  monoLines, monoLineHeight, sparklineBudget, CELL_CONTENT_H, CELL_TEXT_WIDTH, CARD_SIZE, ROW_H, FS,
} from '@/lib/share-card/layout'
import { BLS_CPI_AREAS } from '@/lib/mappings/county-metro-cpi'
import { CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES, STATE_LEVEL_CODES, PAD_DUOAREA } from '@/lib/mappings/eia-gas'
import { describeDuoarea, toGasPriceData, type GasSeriesData } from '@/lib/api/eia'
import { gasShortGeo } from '@/lib/hero-cards'
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
    for (const s of [GAS_SUBLABEL, GROCERIES_SUBLABEL, SHELTER_SUBLABEL, RENT_SUBLABEL, TARIFF_SUBLABEL]) {
      expect([s, monoLines(s, FS.sublabel)]).toEqual([s, 1])
    }
  })

  test('HI/AK gas stand-in footnote fits two lines for every HI/AK county', () => {
    expect(hiAkCounties.length).toBeGreaterThan(30)
    const notes = hiAkCounties.map((c) => shareGasStandInNote(c))
    const worst = notes.reduce((a, b) => (b.length > a.length ? b : a))
    expect(worst).toContain('Prince of Wales-Hyder C.A.')
    for (const n of notes) expect([n, monoLines(n, FS.note) <= 2]).toEqual([n, true])
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

  test('header CPI label fits one line beside the date badge for every CPI area and tier', () => {
    // 1080 − 2×40 padding − date badge (~208px: "JAN 20, 2025" 22px + 0.06em spacing + 2×16 padding)
    const headerWidth = CARD_SIZE - 80 - 220
    const base = snap().cpi.data!
    const labels = Object.values(BLS_CPI_AREAS).flatMap((a) =>
      [1, 2, 3, 4].map((tier) => cpiShareLabel({ ...base, areaCode: a.code, metro: a.name, tier } as CpiData)!),
    )
    labels.push(cpiShareLabel({ ...base, fallback: 'national' } as CpiData)!)
    for (const l of labels) expect([l, monoLines(l, 20, headerWidth)]).toEqual([l, 1])
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
