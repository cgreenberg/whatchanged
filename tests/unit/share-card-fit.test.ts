/**
 * @jest-environment node
 */
// Share card (1080×1080) text fit: one quadrant template for Gas, Groceries, Rent/Shelter and Electricity —
// title, big number + one pill, chart, source line — with fixed slot heights, so all four charts are the same
// height. Every text slot is checked against the worst real strings (DM Mono is monospaced; Bebas / Barlow are
// measured from the bundled TTFs), and the shared footnote zone can never squeeze the charts below MIN_CHART_H.
import type { EconomicSnapshot, RentData } from '@/types'
import austin from '../fixtures/snapshots/78701.json'
import zipCounty from '@/lib/data/zip-county.json'
import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import akGas from '@/lib/data/ak-gas.json'
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
  generateShareCard, shareGasStandInNote, shareSeasonalNote, sharePillForGas, shelterPillSub, cityFontSize, dateBoxWidth, pctTick,
  SHARE_OUTLIER_NOTE, MARK_SCALE, QUADRANT_TITLES,
} from '@/lib/share-card/generate'
import { latestDataLabel, dataRangeEnd, cardMonthLabel, RANGE_NONE, RENT_ADJUSTMENT_TAG, shortSourceDate } from '@/lib/share-card/labels'
import { rentChartSeries, expandSeries } from '@/lib/share-card/rent-series'
import { ttfMeasure } from '@/lib/share-card/measure'
import { shareChartGeometry, MIN_TICK_GAP } from '@/lib/share-card/sparklines'
import { ELECTRICITY_STATES } from '@/lib/api/eia-electricity'
import { STATE_FIPS_MAP } from '@/lib/mappings/state-fips'
import {
  electricityPlace, imageCountyName, buildRentCard, gasCardArea, cpiCardArea, type HeroCardModel,
} from '@/lib/hero-cards'
import {
  monoLines, monoCharsPerLine, fitSourceLine, footnoteZoneHeight, chartHeight, rowHeight, CELL_TEXT_WIDTH, CARD_SIZE,
  HEADER_H, FOOTER_H, SIDE_PAD, FS, BIG_UNIT_SCALE, MIN_CHART_H, FOOTNOTE_W, CELL_PAD, QUADRANT_TEXT_H, TITLE_TAG_GAP,
} from '@/lib/share-card/layout'
import { fmtSignedDollars, fmtSignedPct } from '@/lib/format'
import { lookupCountyRent, lookupMetroRent } from '@/lib/rent'
import { BLS_CPI_AREAS } from '@/lib/mappings/county-metro-cpi'
import { CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES, STATE_LEVEL_CODES, PAD_DUOAREA } from '@/lib/mappings/eia-gas'
import { describeDuoarea, toGasPriceData, type GasSeriesData } from '@/lib/api/eia'
import { BLS_GAS_PUBLISHED_AREAS } from '@/lib/mappings/bls-gas'
import { describeBlsGasArea } from '@/lib/api/bls-gas'
import type { CpiData } from '@/types'

const mockFetch = fetchSnapshot as jest.MockedFunction<typeof fetchSnapshot>
const snap = (): EconomicSnapshot => JSON.parse(JSON.stringify(austin))
const bebas = ttfMeasure('BebasNeue-Regular.ttf')
const barlow = ttfMeasure('BarlowCondensed-SemiBold.ttf')
const dmMono = ttfMeasure('DMMono-Regular.ttf')

type Loc = { countyFips: string; countyName: string; stateAbbr: string; cityName?: string }
const hiAkCounties: Loc[] = [
  ...new Map(
    Object.values(zipCounty as Record<string, Loc>)
      .filter((v) => v.stateAbbr === 'HI' || v.stateAbbr === 'AK')
      .map((v) => [v.countyFips, v] as const),
  ).values(),
]
const worstStandInNote = hiAkCounties.map((c) => shareGasStandInNote(c))
  .reduce((a, b) => (monoLines(b, FS.footnote, FOOTNOTE_W) > monoLines(a, FS.footnote, FOOTNOTE_W) || b.length > a.length ? b : a))
// Widest seasonal footnote: 4-digit $/mo bias, two-digit points, ‡ (with the outlier)
const worstSeasonalNote = shareSeasonalNote({ gap: -12.5, month: 12 }, { pct: 22.2, curRent: 14561, asOf: '2026-12' }, '‡')!
// …and with the "direction uncertain" tail (the gap as large as the change)
const worstSeasonalNoteUncertain = shareSeasonalNote({ gap: -19.9, month: 12 }, { pct: 19.9, curRent: 14561, asOf: '2026-12' }, '‡')!

/** Width of a big-number row: Bebas number (+ small marks / unit) + the pill (Barlow, padding, border, margin). */
function bigRowWidth(big: string, opts: { mark?: string; unit?: string; pill?: string; sub?: string | null } = {}): number {
  let w = bebas(big, FS.big)
  if (opts.mark) w += 2 + bebas(opts.mark, Math.round(FS.big * MARK_SCALE))
  if (opts.unit) w += bebas(opts.unit, Math.round(FS.big * BIG_UNIT_SCALE))
  if (opts.pill) w += Math.max(barlow(opts.pill, FS.pill), opts.sub ? barlow(opts.sub, FS.pillSub) : 0) + 2 * 14 + 2 * 1.5 + 14
  return w
}

// ── Text-slot budgets ────────────────────────────────────────────────────────────

describe('monoLines', () => {
  test('wraps at spaces with DM Mono advance 0.6em', () => {
    // 475px / (24 × 0.6) = 32 chars per line
    expect(monoLines('x'.repeat(32), 24)).toBe(1)
    expect(monoLines('x'.repeat(33), 24)).toBe(2)
    expect(monoLines('aaaa bbbb', 10, 10 * 0.6 * 5)).toBe(2)
    expect(monoLines('', 24)).toBe(0)
    expect(monoLines(null, 24)).toBe(0)
  })
})

describe('share-card text slots fit the template', () => {
  test('quadrant titles name the metric (rent: new listings) and fit one line, rent with its "seas. adj." tag', () => {
    expect(Object.values(QUADRANT_TITLES)).toEqual(['GAS', 'GROCERIES', 'RENT (NEW LISTINGS)', 'SHELTER (CPI)', 'ELECTRICITY'])
    for (const t of Object.values(QUADRANT_TITLES)) {
      expect([t, barlow(t, FS.title, 0.1 * FS.title) <= CELL_TEXT_WIDTH]).toEqual([t, true])
    }
    expect(RENT_ADJUSTMENT_TAG).toBe('seas. adj.')
    const rentRow = barlow(QUADRANT_TITLES.rent, FS.title, 0.1 * FS.title) + TITLE_TAG_GAP + dmMono(RENT_ADJUSTMENT_TAG, FS.titleTag)
    expect(rentRow).toBeLessThanOrEqual(CELL_TEXT_WIDTH)
  })

  test('every place name fits the header beside the widest date box (Bebas 76 → 52)', () => {
    const box = dateBoxWidth('SEP 2026', "latest data Dec '26–Jan '27")
    expect(box).toBeLessThan(360)
    const w = CARD_SIZE - 2 * SIDE_PAD - box - 24
    const places = [...new Set(Object.values(zipCounty as Record<string, Loc>).map((v) => `${(v.cityName || v.countyName).toUpperCase()}, ${v.stateAbbr}`))]
    expect(places).toContain('KING AND QUEEN COURT HOUSE, VA')
    expect(places.filter((p) => cityFontSize(p, w) === null)).toEqual([])
    expect(cityFontSize('ANCHORAGE, AK', w)).toBe(76)
    expect(cityFontSize('KING AND QUEEN COURT HOUSE, VA', w)).toBeLessThan(76)
  })

  test('header range end = the most recent data month shown, never the month the image is made', () => {
    const card = (asOfPeriod: string, status = 'ok') => ({ status, asOfPeriod }) as HeroCardModel
    // weekly gas into early October, CPI / rent through August, electricity through July → OCT
    expect(dataRangeEnd([card('2026-10-05'), card('2026-08'), card('2026-08'), card('2026-07')])).toBe('OCT 2026')
    // every quadrant monthly through August → AUG (even when the image is made in October)
    expect(dataRangeEnd([card('2026-08'), card('2026-08'), card('2026-07'), card('2026-08')])).toBe('AUG 2026')
    // a card without a number never moves the end; across a year end
    expect(dataRangeEnd([card('2026-12'), card('2027-01-04'), card('2027-03', 'unavailable')])).toBe('JAN 2027')
    expect(dataRangeEnd([card('2026-09', 'unavailable')])).toBeNull()
    expect(RANGE_NONE).toBe('SINCE JAN 20, 2025')
    // no dated card: one line, no arrow, still inside the date box
    expect(dateBoxWidth(null, null)).toBeGreaterThan(0)
    expect(dateBoxWidth(null, null)).toBeLessThan(dateBoxWidth('SEP 2026', null))
    // each quadrant's own month (OG stat line)
    expect(cardMonthLabel(card('2026-10-05'))).toBe("latest Oct '26")
    expect(cardMonthLabel(card('2026-07'))).toBe("latest Jul '26")
    expect(cardMonthLabel(card('2026-07', 'unavailable'))).toBeNull()
  })

  test('header date labels: the data months', () => {
    const card = (asOfPeriod: string) => ({ status: 'ok', asOfPeriod }) as HeroCardModel
    expect(latestDataLabel([card('2026-07'), card('2026-08'), card('2026-08')])).toBe("latest data Jul–Aug '26")
    expect(latestDataLabel([card('2026-08')])).toBe("latest data Aug '26")
    expect(latestDataLabel([card('2026-12'), card('2027-01')])).toBe("latest data Dec '26–Jan '27")
    expect(latestDataLabel([{ status: 'unavailable', asOfPeriod: '2026-01' } as HeroCardModel])).toBeNull()
    expect(shortSourceDate('Anchorage metro · BLS · Aug 2026')).toBe("Anchorage metro · BLS · Aug '26")
    expect(shortSourceDate('Texas state avg · EIA · Sep 29, 2026')).toBe("Texas state avg · EIA · Sep '26")
    expect(shortSourceDate('Puerto Rico · EIA')).toBe('Puerto Rico · EIA')
  })

  // Every state EIA publishes (50 + DC)
  const elecStates = ELECTRICITY_STATES.map((st) => ({ state: st, stateName: Object.values(STATE_FIPS_MAP).find((v) => v.abbr === st)!.name }))

  test('source lines ("{area} · {source} · {Mon \'YY}") fit one line for every real area', () => {
    const date = " · Sep '26"
    const dummy = { current: 3, baseline: 3, change: 0, baselineDate: '2025-01', latestDate: '2026-09', regionName: '', series: [] } as unknown as GasSeriesData
    const eia = ['NUS', 'R5XCA', ...Object.values(PAD_DUOAREA), ...Object.values(STATE_LEVEL_CODES).map((c) => c.duoarea)]
      .map((d) => `${gasCardArea(toGasPriceData(describeDuoarea(d), dummy), 'TX')} · EIA${date}`)
    const cities = [...Object.values(CPI_TO_EIA_CITY), ...Object.values(COUNTY_EIA_CITY_OVERRIDES)].map((c) => `${c.label} · EIA${date}`)
    const bls = [...BLS_GAS_PUBLISHED_AREAS].filter((a) => /^S/.test(a)).flatMap((a) =>
      (a === 'S49F' || a === 'S49G' ? [false, true] : [false]).map((standIn) =>
        `${gasCardArea(toGasPriceData(describeBlsGasArea(a, { standIn }), dummy))} · BLS${date}`),
    )
    expect(bls).toContain("Honolulu-area* · BLS · Sep '26")
    const ak = akGas as unknown as { communities: Record<string, { stations?: number }>; regions: Record<string, unknown> }
    const dcra = [
      ...Object.entries(ak.communities).map(([p, c]) => `${p} survey (nearest) · DCRA${c.stations === 1 ? ', 1 station' : ''}${date}`),
      ...Object.keys(ak.regions).map((r) => `${r} AK region avg · DCRA${date}`),
    ]
    const tierOf = (code: string) => (/^S/.test(code) ? 1 : code === '0000' ? 4 : /^0[1-4]00$/.test(code) ? 3 : 2)
    const base = snap().cpi.data!
    const cpi = [
      ...Object.values(BLS_CPI_AREAS).map((a) => cpiCardArea({ ...base, areaCode: a.code, metro: a.name, tier: tierOf(a.code) } as CpiData)),
      cpiCardArea({ ...base, fallback: 'national' } as CpiData),
    ].map((a) => `${a} · BLS · Aug '26`)
    expect(cpi).toContain("U.S. avg (local n/a) · BLS · Aug '26")
    const rentCounties = Object.values((countyRent as unknown as { counties: Record<string, { name: string }> }).counties)
      .map((r) => `${imageCountyName(r.name)} · Zillow · Aug '26`)
    const metroCounties = Object.keys((metroRent as unknown as { counties: Record<string, string> }).counties)
    const rentMetros = [...new Set(metroCounties.map((f) => {
      const r = lookupMetroRent(f).data
      if (!r) return null
      // same choice as the share card: the card's tag, or its first city when the tag would need "…"
      const tag = buildRentCard({ rent: r } as EconomicSnapshot)!.geoTag!
      const full = `${tag} · Zillow · Aug '26`
      return fitSourceLine(full).text.includes('…') ? `${tag.replace(/ metro$/, '').split(/-+|\//)[0]} metro · Zillow · Aug '26` : full
    }).filter((x): x is string => !!x))]
    expect(rentMetros.length).toBeGreaterThan(50)
    const elec = elecStates.map((e) => `${electricityPlace(e, 'short')} · EIA · Jul '26`)
    const all = [...eia, ...cities, ...bls, ...dcra, ...cpi, ...rentCounties, ...rentMetros, ...elec]
    for (const line of all) {
      const f = fitSourceLine(line)
      expect([line, monoLines(f.text, f.fontSize)]).toEqual([line, 1])
      // the source and month always survive
      expect([line, f.text.endsWith(line.split(' · ').slice(1).join(' · '))]).toEqual([line, true])
    }
    // Only Alaska survey places ever need the "…" (everything else fits at 20/18/16px)
    expect(all.filter((l) => fitSourceLine(l).text.includes('…') && !/DCRA/.test(l))).toEqual([])
    const long = fitSourceLine('A Very Long Imaginary Place Name That Never Fits Anywhere · Zillow · Aug \'26')
    expect(long.fontSize).toBe(16)
    expect(long.text).toMatch(/…· Zillow · Aug '26$|… · Zillow · Aug '26$/)
    expect([...long.text].length).toBeLessThanOrEqual(monoCharsPerLine(16))
  })

  test('big number + pill fit one row at the widest realistic values', () => {
    const rows: Array<[string, number]> = []
    for (const s of [1, -1]) {
      // gas: change "+$4.44" + small "/gal" + "now $9.99"
      rows.push(['gas', bigRowWidth(fmtSignedDollars(4.44 * s), { unit: '/gal', pill: 'now $9.99' })])
      // monthly / survey gas: the price over its month (Alaska survey prices run to $19.99)
      for (const g of [{ current: 9.99, latestDate: '2026-08', source: 'bls' }, { current: 19.99, latestDate: '2026-07', source: 'dcra' }]) {
        const pill = sharePillForGas(g)
        expect(pill.sub).toMatch(/^(Aug avg|Jul survey)$/)
        rows.push([`gas ${g.source}`, bigRowWidth(fmtSignedDollars(4.44 * s), { unit: '/gal', pill: pill.text, sub: pill.sub })])
      }
      // groceries ±49.9% on $6,000/yr
      rows.push(['groceries', bigRowWidth(fmtSignedPct(49.9 * s), { pill: `≈ ${fmtSignedDollars(2994 * s, 0)}/yr` })])
      // rent: seasonal † on the %, 4-digit $/mo; outlier † + seasonal ‡ (no pill)
      rows.push(['rent', bigRowWidth(fmtSignedPct(49.9 * s), { mark: '†', pill: `≈ ${fmtSignedDollars(4999 * s, 0)}/mo` })])
      rows.push(['rent outlier', bigRowWidth(fmtSignedPct(49.9 * s), { mark: '†‡' })])
      // shelter ±19.9% with a top-coded rent ($8,358/yr, "or more saved in rent")
      rows.push(['shelter', bigRowWidth(fmtSignedPct(19.9 * s), { pill: `≈ ${fmtSignedDollars(8358 * s, 0)}/yr`, sub: shelterPillSub({ basis: 'zip', rentCoded: 'top' }, 8358 * s) })])
      // electricity ±99.9%, $999/mo
      rows.push(['electricity', bigRowWidth(fmtSignedPct(99.9 * s), { pill: `≈ ${fmtSignedDollars(999 * s, 0)}/mo` })])
    }
    for (const [k, w] of rows) expect([k, Math.round(w), w <= CELL_TEXT_WIDTH]).toEqual([k, Math.round(w), true])
  })

  test('shelter pill qualifier: only for a coded rent, sign-aware', () => {
    expect(shelterPillSub({ basis: 'zip', rentCoded: 'top' }, 1234)).toBe('or more in rent')
    expect(shelterPillSub({ basis: 'zip', rentCoded: 'top' }, -420)).toBe('or more saved in rent')
    expect(shelterPillSub({ basis: 'zip', rentCoded: 'bottom' }, 12)).toBe('or less in rent')
    expect(shelterPillSub({ basis: 'county', rentCoded: 'top' }, 1234)).toBeNull()
    expect(shelterPillSub({ basis: 'zip' }, 1234)).toBeNull()
  })

  test('footnotes: HI/AK stand-in, outlier and seasonal caveat — wording and line counts', () => {
    expect(hiAkCounties.length).toBeGreaterThan(30)
    for (const c of hiAkCounties) {
      const n = shareGasStandInNote(c)
      expect([n, monoLines(n, FS.footnote, FOOTNOTE_W) <= 2]).toEqual([n, true])
      expect(n).not.toContain('C.A.') // reads as California
      expect(n).not.toMatch(/\.[;,]/)
      expect(n).toContain('trend may differ')
    }
    expect(monoLines(SHARE_OUTLIER_NOTE, FS.footnote, FOOTNOTE_W)).toBe(1)
    expect(worstSeasonalNote).toMatch(/^‡ Seasonal pattern uncertain: Dec rent may be ~12\.5 pts too low \(≈ \$[\d,]+\/mo\); own pattern \+34\.7%\.$/)
    expect(monoLines(worstSeasonalNote, FS.footnote, FOOTNOTE_W)).toBeLessThanOrEqual(2)
    expect(monoLines(worstSeasonalNoteUncertain, FS.footnote, FOOTNOTE_W)).toBeLessThanOrEqual(2)
    expect(shareSeasonalNote({ gap: 2.5, month: 8 }, { pct: 7, curRent: 1800, asOf: '2026-08' })).toMatch(/^† Seasonal pattern uncertain: Aug rent may be ~2\.5 pts too high \(≈ \$\d+\/mo\); own pattern \+4\.5%\.$/)
    // signed for falls (round-17 cases): Collier FL −1.5% (gap −2.2) reads "too low", own +0.7%, direction uncertain
    expect(shareSeasonalNote({ gap: -2.2, month: 8 }, { pct: -1.5, curRent: 2567, asOf: '2026-08' })).toMatch(/^† Seasonal pattern uncertain: Aug rent may be ~2\.2 pts too low \(≈ \$\d+\/mo\); own pattern \+0\.7%, direction uncertain\.$/)
    // Sweetwater WY −4.8% (gap +2.1): "too high", own −6.9%, direction clear
    expect(shareSeasonalNote({ gap: 2.1, month: 8 }, { pct: -4.8, curRent: 1141, asOf: '2026-08' })).toMatch(/^† Seasonal pattern uncertain: Aug rent may be ~2\.1 pts too high \(≈ \$\d+\/mo\); own pattern −6\.9%\.$/)
    expect(shareSeasonalNote(undefined, { pct: 7, curRent: 1800, asOf: '2026-08' })).toBeNull()
  })

  test('the footnote zone never squeezes the charts below the minimum (all footnotes at once, worst wording)', () => {
    expect(chartHeight(0)).toBeGreaterThanOrEqual(210)
    const worst = footnoteZoneHeight([worstStandInNote, SHARE_OUTLIER_NOTE, worstSeasonalNoteUncertain])
    expect(worst).toBeGreaterThanOrEqual(footnoteZoneHeight([worstStandInNote, SHARE_OUTLIER_NOTE, worstSeasonalNote]))
    expect(chartHeight(worst)).toBeGreaterThanOrEqual(MIN_CHART_H)
    // layout adds up: header + two rows + footnotes + footer ≤ the card
    for (const f of [0, worst]) expect(HEADER_H + 2 * rowHeight(f) + f + FOOTER_H).toBeLessThanOrEqual(CARD_SIZE)
    expect(rowHeight(0) - 1 - CELL_PAD.top - CELL_PAD.bottom - QUADRANT_TEXT_H).toBe(chartHeight(0))
  })

  test('chart axis: two y ticks (top and bottom of the range) unless the line is flat; % ticks read "0%"/"+7.0%"', () => {
    const g = shareChartGeometry([0, 2, 7], { height: 200, includeZero: true })
    expect(g.ticks.map((t) => t.value)).toEqual([7, 0])
    expect(g.ticks[1].y - g.ticks[0].y).toBeGreaterThanOrEqual(MIN_TICK_GAP)
    // baseline (first) and end points sit on the plotted values; the 0 tick is the baseline point
    expect(g.ys[0]).toBeCloseTo(g.ticks[1].y, 6)
    expect(shareChartGeometry([3, 3], { height: 200 }).ticks).toHaveLength(1)
    expect(pctTick(0)).toBe('0%')
    expect(pctTick(7)).toBe('+7.0%')
    expect(pctTick(-1.84)).toBe('−1.8%')
  })
})

// ── Rent chart series ─────────────────────────────────────────────────────────────

describe('rent chart: the Rent card\'s own Zillow series', () => {
  test('county series runs Jan 2025 → as-of and ends on the card\'s %', () => {
    const r = lookupCountyRent('02020').data!
    const s = rentChartSeries(r)!
    expect(s[0].date).toBe(r.baseMonth)
    expect(s[s.length - 1].date).toBe(r.asOf)
    expect(Math.abs((s[s.length - 1].value / s[0].value - 1) * 100 - r.pct)).toBeLessThanOrEqual(0.15)
  })

  test('metro rung uses the metro series', () => {
    const fips = Object.keys((metroRent as unknown as { counties: Record<string, string> }).counties).find((f) => lookupMetroRent(f).data)!
    const r = lookupMetroRent(fips).data!
    expect(r.level).toBe('metro')
    const s = rentChartSeries(r)!
    expect(s).not.toBeNull()
    expect(Math.abs((s[s.length - 1].value / s[0].value - 1) * 100 - r.pct)).toBeLessThanOrEqual(0.15)
  })

  test('no chart when the series disagrees with the card or is missing', () => {
    const r = lookupCountyRent('02020').data!
    expect(rentChartSeries({ ...r, pct: r.pct + 3 })).toBeNull()
    expect(rentChartSeries({ ...r, asOf: '2031-01' })).toBeNull()
    expect(rentChartSeries({ ...r, countyFips: '99999' } as RentData)).toBeNull()
    expect(rentChartSeries(null)).toBeNull()
    expect(expandSeries({ start: '2025-01', v: [100, null, 102] }, '2025-01', '2025-03')).toEqual([
      { date: '2025-01', value: 100 }, { date: '2025-03', value: 102 },
    ])
  })
})

// ── Rendered tree: every quadrant uses the template and fits ───────────────────────

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
function quadrants(n: unknown, out: El[] = []): El[] {
  if (!isEl(n)) return out
  const s = n.props.style ?? {}
  if (s.position === 'relative' && s.overflow === 'hidden') out.push(n)
  else kids(n).forEach((c) => quadrants(c, out))
  return out
}
/** In-flow slots of a quadrant (the accent strip is absolute): title, big row, chart, source. */
function slots(q: El) {
  return kids(q).filter(isEl).filter((c) => c.props.style?.position !== 'absolute')
}

async function render(s: EconomicSnapshot) {
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const tree = mockRendered[mockRendered.length - 1]
  const qs = quadrants(tree)
  expect(qs).toHaveLength(4)
  return { tree, qs, text: textOf(tree) }
}

function expectTemplate(qs: El[]) {
  const chartHs = new Set<number>()
  for (const q of qs) {
    const st = q.props.style!
    const sl = slots(q)
    expect(sl).toHaveLength(4)
    const used = sl.reduce((h, c) => h + num(c.props.style!.height) + num(c.props.style!.marginTop) + num(c.props.style!.marginBottom), 0)
    expect([textOf(q).slice(0, 20), used + CELL_PAD.top + CELL_PAD.bottom <= num(st.height)]).toEqual([textOf(q).slice(0, 20), true])
    chartHs.add(num(sl[2].props.style!.height))
    // source line: one line at its font size
    const src = kids(sl[3]).filter(isEl)[0]
    expect(monoLines(textOf(src), num(src.props.style!.fontSize))).toBe(1)
  }
  expect(chartHs.size).toBe(1)
  expect([...chartHs][0]).toBeGreaterThanOrEqual(MIN_CHART_H)
}

describe('share-card quadrants: one template, same chart height, fits', () => {
  test('EIA gas + Zillow rent (Austin): header range, four titles, source lines, no old sublabels', async () => {
    const { qs, text } = await render(snap())
    expectTemplate(qs)
    expect(text).toContain('JAN 20, 2025')
    // ends at the newest data month shown (Austin's weekly gas), from the data — not the month the image is made
    const s = snap()
    const newest = [s.gas.data!.latestDate!, s.cpi.data!.groceriesLatestPeriod, s.rent!.asOf, s.electricity.data!.latestPeriod]
      .filter((d): d is string => !!d).map((d) => d.slice(0, 7)).sort().pop()!
    const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
    expect(text).toContain(`${MON[Number(newest.slice(5)) - 1]} ${newest.slice(0, 4)}`)
    expect(text).toContain('RENT (NEW LISTINGS)')
    expect(text).toContain('seas. adj.')
    expect(text).toMatch(/latest data [A-Z][a-z]{2}(–[A-Z][a-z]{2})? '26/)
    for (const t of ['GAS', 'GROCERIES', 'RENT', 'ELECTRICITY']) expect(text).toContain(t)
    expect(text).toMatch(/now \$\d\.\d\d/)
    expect(text).toMatch(/· Zillow · Aug '26/)
    expect(text).toMatch(/Texas · EIA · [A-Z][a-z]{2} '26/)
    for (const gone of ['regular gasoline', 'Natl', '$/yr on', 'seasonally adj.', "vs Aug'24", 'CPI:', 'Asking rent']) {
      expect([gone, text.includes(gone)]).toEqual([gone, false])
    }
  })

  test('rent seasonal caveat + outlier: small marks on the %, footnotes above the footer, still fits', async () => {
    const s = snap()
    s.rent = { ...s.rent!, pct: 22.2, curRent: 14561, monthlyChange: 2646, saCaveat: { gap: -12.5, month: 8 } }
    let r = await render(s)
    expectTemplate(r.qs)
    expect(r.text).toContain('† Seasonal pattern uncertain')
    expect(r.text).toContain('≈ +$2,646/mo')
    r = await render({ ...s, rent: { ...s.rent, flagged: true } as EconomicSnapshot['rent'] })
    expectTemplate(r.qs)
    expect(r.text).toContain('†‡')
    expect(r.text).toContain(SHARE_OUTLIER_NOTE)
    expect(r.text).toContain('‡ Seasonal pattern uncertain')
    expect(r.text).not.toContain('+$2,646/mo') // no $ pill on a flagged value
  })

  test('rent number with no chart series: "Chart unavailable", never "Data unavailable" under a number', async () => {
    const s = snap()
    s.rent = { ...s.rent!, countyFips: '99999' } // no county shard → no chart series
    const r = await render(s)
    expectTemplate(r.qs)
    const rentQ = r.qs.find((q) => textOf(q).includes('RENT (NEW LISTINGS)'))!
    expect(textOf(rentQ)).toContain('Chart unavailable')
    expect(textOf(rentQ)).not.toContain('Data unavailable')
  })

  test('territory (no EIA electricity): N/A quadrant keeps the template', async () => {
    const s = snap()
    s.electricity = { ...s.electricity, data: null }
    s.dollarImpact = { ...s.dollarImpact!, electricity: null }
    const r = await render(s)
    expectTemplate(r.qs)
    expect(r.text).toContain('N/A')
    expect(r.text).toContain('Data unavailable')
  })

  test('CPI shelter fallback (no county rent) + national gas fallback', async () => {
    const s = snap()
    s.rent = null
    s.gas.data = { ...s.gas.data!, isNationalFallback: true, geoLevel: 'National avg' }
    const r = await render(s)
    expectTemplate(r.qs)
    expect(r.text).toContain('SHELTER (CPI)')
    expect(r.text).toContain('West South Central div. · BLS')
  })

  test('national CPI fallback is labeled on the source line', async () => {
    const s = snap()
    s.rent = null
    s.cpi.data = { ...s.cpi.data!, fallback: 'national', tier: 4, metro: 'National' }
    const r = await render(s)
    expectTemplate(r.qs)
    expect(r.text).toContain('U.S. avg (local n/a) · BLS')
  })

  test('longest place name shrinks the header font instead of overflowing', async () => {
    const s = snap()
    s.location = { ...s.location, cityName: 'King And Queen Court House', stateAbbr: 'VA' }
    const r = await render(s)
    expectTemplate(r.qs)
    expect(r.text).toContain('KING AND QUEEN COURT HOUSE, VA')
  })

  test('every HI/AK county as a gas stand-in (footnote), with the CPI shelter fallback', async () => {
    const hi = blsGasData('S49F', { standIn: true })
    const ak = blsGasData('S49G', { standIn: true })
    for (const c of hiAkCounties) {
      const s = snap()
      s.location = { ...s.location, stateAbbr: c.stateAbbr, countyFips: c.countyFips, countyName: c.countyName, cityName: c.cityName ?? s.location.cityName }
      s.gas.data = c.stateAbbr === 'HI' ? hi : ak
      s.rent = null
      const r = await render(s)
      expect(r.text).toContain('No gas series for')
      expect(r.text).toMatch(/(Honolulu|Anchorage)-area\* · BLS/)
      expectTemplate(r.qs)
    }
  }, 60000)
})
