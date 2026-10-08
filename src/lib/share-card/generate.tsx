import React from 'react'
import { ImageResponse } from 'next/og'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { fmtSignedDollars, fmtSignedPct, fmtMonthShort, monthsBetween } from '@/lib/format'
import { electricityCenterOf, gasBaselineIndex, monthlyBaselineIndex, ELECTRICITY_CENTER_LAG } from '@/lib/baseline'
import {
  buildHeroCards, imageSourcesLine, usesNationalFallback, OUTLIER_MARK, isGasStandIn, standInPlace, GAS_STANDIN_MARK,
  imageCountyName, gasLevelText, isMonthlyGas, type HeroCardModel,
} from '@/lib/hero-cards'
import { hasSeasonalCaveat, seasonalCaveatPoints, seasonalCaveatDollars, type SeasonalCaveat } from '@/lib/rent-range'
import { rentCodedQualifier } from '@/lib/compute/dollar-translations'
import { loadShareFonts } from '@/lib/share-card/fonts'
import { buildShareChart, chartUnavailable } from '@/lib/share-card/sparklines'
import { rentChartSeries } from '@/lib/share-card/rent-series'
import { fontMeasure } from '@/lib/share-card/measure'
import { latestDataLabel, QUADRANT_TITLES, rangeEnd, RANGE_START, shortSourceDate } from '@/lib/share-card/labels'
export { QUADRANT_TITLES }
import {
  BIG_UNIT_SCALE, CARD_SIZE, CELL_PADDING, FOOTER_H, FOOTNOTE_PAD_Y, FS, HEADER_H, SIDE_PAD, SLOT,
  chartHeight, fitSourceLine, footnoteZoneHeight, rowHeight,
} from '@/lib/share-card/layout'

// ── Design Tokens ─────────────────────────────────────────────────
const BG = '#111316' // data-desk charcoal (src/lib/theme.ts)
const BORDER = 'rgba(255,255,255,0.10)'
const TEXT_PRIMARY = '#F1EFEA'
const TEXT_SECONDARY = '#B3B8C0'
const TEXT_TERTIARY = '#8C929B'
// Metric accents match the site (src/lib/theme.ts METRIC_COLORS); AMBER is also the brand accent
const AMBER = '#F2A93B'
const GAS = AMBER
const GROCERIES = '#F07D62'
const BLUE = '#5EA8F2'
const GREEN = '#3EC4A6'

/** Share image cache: shorter when any source is missing or stale so it self-heals. */
export const SHARE_CACHE_OK = 'public, max-age=3600, s-maxage=86400'
export const SHARE_CACHE_DEGRADED = 'public, max-age=60, s-maxage=300'


// ── Header geometry ───────────────────────────────────────────────
const CITY_SIZES = [76, 68, 60, 52] as const
const DATE_LINE_FS = 20
const DATE_LINE_LS = 0.04 * DATE_LINE_FS
const DATE_SUB_FS = 16
const DATE_ARROW_W = 30
const DATE_BOX_PAD_X = 14
/** Caveat marks after a big number are drawn at this fraction of FS.big. */
export const MARK_SCALE = 0.45

/** Width (px) of the header date box for these two lines. */
export function dateBoxWidth(end: string, sub: string | null): number {
  const mono = fontMeasure('DMMono-Regular.ttf', 0.6)
  const line1 = mono(RANGE_START, DATE_LINE_FS, DATE_LINE_LS) + DATE_ARROW_W + mono(end, DATE_LINE_FS, DATE_LINE_LS)
  return Math.ceil(Math.max(line1, sub ? mono(sub, DATE_SUB_FS) : 0) + 2 * DATE_BOX_PAD_X + 2)
}

/** Largest header font (Bebas Neue) at which the place name fits beside the date box; null = none (ellipsis at the smallest). */
export function cityFontSize(text: string, width: number): number | null {
  const bebas = fontMeasure('BebasNeue-Regular.ttf', 0.45)
  return CITY_SIZES.find((s) => bebas(text, s) <= width) ?? null
}
export const CITY_MIN_FS = CITY_SIZES[CITY_SIZES.length - 1]

/**
 * Monthly x-axis on real time: each point's position is its month offset over the span, so a run of missing months
 * (e.g. a BLS publication gap) is shown as a gap, not squeezed into one step.
 */
export function monthlyAxis(series: Array<{ date: string }>): { xFractions: number[]; gapAfter: number[]; gapLabels: string[] } {
  if (series.length < 2) return { xFractions: series.map(() => 0), gapAfter: [], gapLabels: [] }
  const first = series[0].date
  const span = monthsBetween(first, series[series.length - 1].date) || 1
  const xFractions = series.map((p) => monthsBetween(first, p.date) / span)
  // > 2 months between points (bimonthly areas publish every other month: not a gap)
  const gapAfter = series.slice(0, -1).flatMap((p, i) => (monthsBetween(p.date, series[i + 1].date) > 2 ? [i] : []))
  // "no data Feb–Jul" (missing months between the two points; years shown when they differ)
  const gapLabels = gapAfter.map((i) => {
    const from = addMonths(series[i].date, 1)
    const to = addMonths(series[i + 1].date, -1)
    const mon = (d: string) => fmtMonthShort(d).split(' ')[0]
    if (from === to) return `no data ${mon(from)}`
    return from.slice(0, 4) === to.slice(0, 4)
      ? `no data ${mon(from)}–${mon(to)}`
      : `no data ${fmtMonthShort(from)}–${fmtMonthShort(to)}`
  })
  return { xFractions, gapAfter, gapLabels }
}

/** Gas pill: "now $3.21" (weekly), else the price over its month ("$4.78" / "Aug avg", "$5.10" / "Jul survey"). */
export function sharePillForGas(g: { current: number; latestDate?: string | null; source?: string; frequency?: string }): { text: string; sub?: string } {
  const kind = g.source === 'dcra' ? 'survey' : isMonthlyGas(g as Parameters<typeof isMonthlyGas>[0]) ? 'monthly' : 'weekly'
  const full = gasLevelText(g.current, kind, g.latestDate)
  const m = /^(.*) (\$\d+\.\d\d)$/.exec(full)
  return !m || full.startsWith('now ') ? { text: full } : { text: m[2], sub: m[1] }
}

/** Electricity chart tick for an average plotted at its window's center month: "12 mo to Jul '26" (the window's end). */
export function elecWindowTick(center: string | undefined): string {
  return center ? `12 mo to ${fmtMonthShort(addMonths(center, ELECTRICITY_CENTER_LAG))}` : ''
}

function addMonths(d: string, n: number): string {
  const [y, m] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

/** Day-based x positions (weekly EIA, monthly BLS and the twice-yearly Alaska survey all on real time). */
function dateFractions(dates: string[]): number[] {
  const t = dates.map((d) => Date.parse(d.length === 7 ? `${d}-01` : d))
  const span = t[t.length - 1] - t[0]
  return t.map((x) => (span > 0 && Number.isFinite(x) ? (x - t[0]) / span : 0))
}

/** % change of each value vs the first (the chart's baseline point). */
const pctFromFirst = (vals: number[]) => (vals[0] ? vals.map((v) => ((v - vals[0]) / vals[0]) * 100) : [])

/** Y tick text: "0%", "+7.0%", "−1.8%". */
export const pctTick = (v: number) => (Math.abs(v) < 0.05 ? '0%' : fmtSignedPct(v))

/**
 * Footnote for the rent seasonal-pattern caveat (rent-range.ts rentSeasonalCaveat, short form): "† Seasonal pattern
 * uncertain: Aug rent may overstate the change by ~2.5 pts (≈ $95/mo)". `mark` is "†", or "‡" when the
 * value also carries the outlier "†". null when there is no caveat.
 */
export function shareSeasonalNote(
  c: SeasonalCaveat | undefined, rent: { pct: number; curRent: number; asOf: string }, mark = '†',
): string | null {
  if (!hasSeasonalCaveat(c)) return null
  const usd = seasonalCaveatDollars(c, rent.pct, rent.curRent)
  const mon = fmtMonthShort(`${rent.asOf.slice(0, 4)}-${String(c.month).padStart(2, '0')}`).split(' ')[0] // the caveat's (as-of) month
  return `${mark} Seasonal pattern uncertain: ${mon} rent may ${c.gap > 0 ? 'overstate' : 'understate'} the change by ` +
    `~${seasonalCaveatPoints(c)} pts${usd !== null ? ` (≈ $${usd.toLocaleString('en-US')}/mo)` : ''}.`
}

/** Footnote for a flagged (outlier) rent figure. */
export const SHARE_OUTLIER_NOTE = `${OUTLIER_MARK} Unusual rent value: far outside most U.S. counties; treat with caution.`

/** Footnote for a HI/AK gas stand-in ("*" on "Honolulu-area*" in the gas source line). */
export function shareGasStandInNote(location: Parameters<typeof standInPlace>[0]): string {
  return `${GAS_STANDIN_MARK} No gas series for ${standInPlace(location, 'image')} — local prices often higher; trend may differ.`
}

/**
 * Second line of the shelter "$/yr" pill, only for a coded Census rent: the zip's own top-coded median ($3,500+)
 * makes the amount a floor on its size ("or more in rent"; "or more saved in rent" for a decrease), bottom-coded
 * (under $100) a ceiling ("or less in rent"). null otherwise (one-line pill).
 */
export function shelterPillSub(c?: { basis?: string; rentCoded?: 'top' | 'bottom' } | null, dollars?: number | null): string | null {
  const q = rentCodedQualifier(typeof dollars === 'number' ? dollars : 1, c?.basis === 'zip' ? c.rentCoded : undefined)
  return q ? `${q} in rent` : null
}

/** One quadrant of the template. */
export interface QuadrantModel {
  id: keyof typeof QUADRANT_TITLES
  accent: string
  big: string
  /** Caveat marks after the big number ("†", "†‡"), drawn small; their footnotes are above the footer. */
  mark?: string
  unit?: string
  pill?: { text: string; sub?: string | null }
  chart: React.ReactElement | null
  source: string
}

// ── Main Export ───────────────────────────────────────────────────
export async function generateShareCard(zip: string, now: Date = new Date()): Promise<Response> {
  const snapshot = await fetchSnapshot(zip)
  if (!snapshot) {
    return new Response('Zip code not found', { status: 404 })
  }

  const { location } = snapshot
  const place = `${(location.cityName || location.countyName).toUpperCase()}, ${location.stateAbbr}`
  const cpiData = snapshot.cpi.data
  const gasData = snapshot.gas.data

  // Same view-models as the page's hero cards (sanity ranges, rent vs CPI shelter)
  const cards = buildHeroCards(snapshot)
  const card = (id: string): HeroCardModel | undefined => cards.find((c) => c.id === id)
  const ok = (id: string) => card(id)?.status === 'ok'
  const rent = ok('rent') ? snapshot.rent ?? null : null
  const elecData = ok('electricity') ? snapshot.electricity?.data ?? null : null
  const degraded = cards.some((c) => c.status !== 'ok' || c.stale) || usesNationalFallback(snapshot)

  // ── Footnotes (one shared zone above the footer, only when needed) ──
  const rentOutlier = !!rent && card('rent')?.outlier === true
  const seasonalMark = rentOutlier ? '‡' : '†'
  const rentSeasonal = rent ? shareSeasonalNote(rent.saCaveat, rent, seasonalMark) : null
  const gasStandIn = ok('gas') && isGasStandIn(gasData)
  const footnotes = [
    gasStandIn ? shareGasStandInNote(location) : null,
    rentOutlier ? SHARE_OUTLIER_NOTE : null,
    rentSeasonal,
  ].filter((n): n is string => !!n)
  const footH = footnoteZoneHeight(footnotes)
  const rowH = rowHeight(footH)
  const chartH = chartHeight(footH)

  const sourceOf = (id: string) => shortSourceDate(card(id)?.sourceLine ?? '')
  const unavailable = () => chartUnavailable(chartH, 'Data unavailable')

  // ── Gas: $/gal change; chart = price from the baseline week/month ──
  const gasAll = gasData?.series ?? []
  const gasSeries = gasAll.slice(Math.max(0, gasBaselineIndex(gasAll)))
  const gasQ: QuadrantModel = ok('gas') && gasData
    ? {
        id: 'gas', accent: GAS,
        big: fmtSignedDollars(gasData.change), unit: '/gal',
        // Same level wording as the card: "now" only for a weekly reading; a monthly average / survey says its month on
        // the pill's second line ("$4.78" over "Aug avg"), so the row still fits beside a 3-digit change
        pill: sharePillForGas(gasData),
        chart: buildShareChart(gasSeries.map((p) => p.price), GAS, 'grad-gas', {
          height: chartH,
          xFractions: dateFractions(gasSeries.map((p) => p.date)),
          fmtTick: (v) => `$${v.toFixed(2)}`,
          xLeft: fmtMonthShort(gasSeries[0]?.date),
          xRight: fmtMonthShort(gasSeries[gasSeries.length - 1]?.date),
        }),
        source: sourceOf('gas'),
      }
    : { id: 'gas', accent: GAS, big: 'N/A', chart: null, source: sourceOf('gas') }

  // ── Groceries: CPI food at home % since the series' baseline month ──
  const cpiAll = cpiData?.series ?? []
  const grocerySeries = cpiAll
    .slice(Math.max(0, monthlyBaselineIndex(cpiAll, (p) => p.groceries)))
    .filter((p): p is typeof p & { groceries: number } => typeof p.groceries === 'number')
  const groceryAxis = monthlyAxis(grocerySeries)
  const groceriesDollars = ok('groceries') ? snapshot.dollarImpact?.groceries ?? null : null
  const groceriesQ: QuadrantModel = ok('groceries') && cpiData
    ? {
        id: 'groceries', accent: GROCERIES,
        big: fmtSignedPct(cpiData.groceriesChange),
        pill: groceriesDollars != null ? { text: `≈ ${fmtSignedDollars(groceriesDollars, 0)}/yr` } : undefined,
        chart: buildShareChart(pctFromFirst(grocerySeries.map((p) => p.groceries)), GROCERIES, 'grad-groceries', {
          height: chartH, includeZero: true, baseline: 0, fmtTick: pctTick, ...groceryAxis,
          xLeft: fmtMonthShort(grocerySeries[0]?.date), xRight: fmtMonthShort(grocerySeries[grocerySeries.length - 1]?.date),
        }),
        source: sourceOf('groceries'),
      }
    : { id: 'groceries', accent: GROCERIES, big: 'N/A', chart: null, source: sourceOf('groceries') }

  // ── Rent (Zillow, county or metro) or the CPI shelter fallback ──
  let housingQ: QuadrantModel
  if (rent) {
    const series = rentChartSeries(rent)
    const axis = series ? monthlyAxis(series) : null
    const rc = card('rent')!
    // Metro: the card's tag, or just its first city when the full title would need "…" ("Des Moines metro")
    const metroTag = rc.geoTag ?? rent.geoName
    const metroShort = `${metroTag.replace(/ metro$/, '').split(/-+|\//)[0]} metro`
    const area = rent.level !== 'metro'
      ? imageCountyName(rent.geoName)
      : fitSourceLine(`${metroTag} · Zillow · ${fmtMonthShort(rent.asOf)}`).text.includes('…') ? metroShort : metroTag
    housingQ = {
      id: 'rent', accent: BLUE,
      big: fmtSignedPct(rent.pct),
      mark: `${rentOutlier ? OUTLIER_MARK : ''}${rentSeasonal ? seasonalMark : ''}` || undefined,
      // No dollar pill for a flagged (†) value: the % with its caveat only
      pill: rentOutlier ? undefined : { text: `≈ ${fmtSignedDollars(rent.monthlyChange, 0)}/mo` },
      chart: series && axis
        ? buildShareChart(pctFromFirst(series.map((p) => p.value)), BLUE, 'grad-rent', {
            height: chartH, includeZero: true, baseline: 0, fmtTick: pctTick, ...axis,
            xLeft: fmtMonthShort(series[0].date), xRight: fmtMonthShort(series[series.length - 1].date),
          })
        : null,
      source: `${area} · Zillow · ${fmtMonthShort(rent.asOf)}`,
    }
  } else {
    const shelterFrom = cpiAll[Math.max(0, monthlyBaselineIndex(cpiAll, (p) => p.shelter))]?.date ?? ''
    const shelterPairs = cpiAll
      .filter((p) => p.date >= shelterFrom && typeof p.shelter === 'number')
      .map((p) => ({ date: p.date, value: p.shelter as number }))
    const shelterOk = ok('shelter') && !!cpiData && typeof cpiData.shelterChange === 'number'
    const medianRent = snapshot.census.data?.medianRent ?? 0
    // Same rule as the page: a $ only when the card shows one (local rent × the area's rent-of-primary-residence %)
    const shelterDollars = shelterOk && card('shelter')?.inline && medianRent > 0 ? snapshot.dollarImpact?.shelter ?? null : null
    housingQ = shelterOk
      ? {
          id: 'shelter', accent: BLUE,
          big: fmtSignedPct(cpiData!.shelterChange!),
          pill: shelterDollars != null
            ? { text: `≈ ${fmtSignedDollars(shelterDollars, 0)}/yr`, sub: shelterPillSub(snapshot.census.data, shelterDollars) }
            : undefined,
          chart: buildShareChart(pctFromFirst(shelterPairs.map((p) => p.value)), BLUE, 'grad-shelter', {
            height: chartH, includeZero: true, baseline: 0, fmtTick: pctTick, ...monthlyAxis(shelterPairs),
            xLeft: fmtMonthShort(shelterPairs[0]?.date), xRight: fmtMonthShort(shelterPairs[shelterPairs.length - 1]?.date),
          }),
          source: sourceOf('shelter'),
        }
      : { id: card('rent') ? 'rent' : 'shelter', accent: BLUE, big: 'N/A', chart: null, source: sourceOf(card('rent') ? 'rent' : 'shelter') }
  }

  // ── Electricity: % change of the 12-month average price; the chart plots each average at its window's center
  //    month, so the line starts at Jan 2025 = the baseline (12 months centered on Jan 2025). The end ticks name the
  //    12-month windows they plot ("12 mo to Jul '26"), never the center month next to a "Jul '26" source line ──
  const elecAll = elecData?.series ?? []
  const elecFrom = elecData ? elecAll.findIndex((p) => p.date === electricityCenterOf(elecData.baselinePeriod)) : -1
  const elecPairs = (elecFrom >= 0 ? elecAll.slice(elecFrom) : [])
    .filter((p): p is typeof p & { avg12: number } => typeof p.avg12 === 'number')
  const elecDollars = elecData ? snapshot.dollarImpact?.electricity ?? null : null
  const elecQ: QuadrantModel = elecData
    ? {
        id: 'electricity', accent: GREEN,
        big: fmtSignedPct(elecData.change),
        pill: elecDollars != null ? { text: `≈ ${fmtSignedDollars(elecDollars, 0)}/mo` } : undefined,
        chart: buildShareChart(pctFromFirst(elecPairs.map((p) => p.avg12)), GREEN, 'grad-electricity', {
          height: chartH, includeZero: true, baseline: 0, fmtTick: pctTick, ...monthlyAxis(elecPairs),
          xLeft: elecWindowTick(elecPairs[0]?.date), xRight: elecWindowTick(elecPairs[elecPairs.length - 1]?.date),
        }),
        source: sourceOf('electricity'),
      }
    : { id: 'electricity', accent: GREEN, big: 'N/A', chart: null, source: sourceOf('electricity') }

  // ── Header ──
  const end = rangeEnd(now)
  const latest = latestDataLabel(cards)
  const boxW = dateBoxWidth(end, latest)
  const cityW = CARD_SIZE - 2 * SIDE_PAD - boxW - 24
  const cityFs = cityFontSize(place, cityW)

  // ── Quadrant renderer (inline, no named components in the Satori tree) ──
  const quadrant = (q: QuadrantModel, borderRight: boolean) => {
    const src = fitSourceLine(q.source)
    return (
      <div
        key={q.id}
        style={{
          display: 'flex', flexDirection: 'column', width: CARD_SIZE / 2, height: rowH - 1, position: 'relative',
          padding: CELL_PADDING, overflow: 'hidden', ...(borderRight ? { borderRight: `1px solid ${BORDER}` } : {}),
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: q.accent, display: 'flex' }} />
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', height: SLOT.title, marginBottom: SLOT.titleGap }}>
          <span style={{ fontFamily: 'Barlow Condensed', fontWeight: 600, fontSize: FS.title, color: TEXT_SECONDARY, letterSpacing: '0.10em', lineHeight: 1, display: 'flex' }}>
            {QUADRANT_TITLES[q.id]}
          </span>
        </div>
        {/* Big change number + one pill */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', height: SLOT.big, marginBottom: SLOT.bigGap }}>
          <span style={{ fontFamily: 'Bebas Neue', fontSize: FS.big, color: q.big === 'N/A' ? TEXT_TERTIARY : TEXT_PRIMARY, lineHeight: 1, display: 'flex' }}>
            {q.big}
          </span>
          {q.mark ? (
            <div style={{ display: 'flex', alignSelf: 'flex-start', marginTop: 4, marginLeft: 2 }}>
              <span style={{ fontFamily: 'Bebas Neue', fontSize: Math.round(FS.big * MARK_SCALE), color: TEXT_SECONDARY, lineHeight: 1, display: 'flex' }}>
                {q.mark}
              </span>
            </div>
          ) : null}
          {q.unit && q.big !== 'N/A' ? (
            <div style={{ display: 'flex', marginBottom: 6 }}>
              <span style={{ fontFamily: 'Bebas Neue', fontSize: Math.round(FS.big * BIG_UNIT_SCALE), color: TEXT_SECONDARY, lineHeight: 1, display: 'flex' }}>
                {q.unit}
              </span>
            </div>
          ) : null}
          {q.pill ? (
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(241,239,234,0.08)', border: '1.5px solid rgba(241,239,234,0.30)', borderRadius: 4,
                padding: q.pill.sub ? '4px 14px' : '6px 14px', marginLeft: 14, marginBottom: 12, flexShrink: 0,
              }}
            >
              <span style={{ fontFamily: 'Barlow Condensed', fontWeight: 600, fontSize: FS.pill, color: TEXT_PRIMARY, lineHeight: 1.1, display: 'flex' }}>
                {q.pill.text}
              </span>
              {q.pill.sub ? (
                <span style={{ fontFamily: 'Barlow Condensed', fontWeight: 600, fontSize: FS.pillSub, color: TEXT_SECONDARY, lineHeight: 1, display: 'flex' }}>
                  {q.pill.sub}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {/* Chart (same height in every quadrant) */}
        <div style={{ display: 'flex', width: '100%', height: chartH }}>{q.chart ?? unavailable()}</div>
        {/* Source line */}
        <div style={{ display: 'flex', alignItems: 'center', height: SLOT.source, marginTop: SLOT.sourceGap }}>
          <span style={{ fontFamily: 'DM Mono', fontSize: src.fontSize, color: TEXT_TERTIARY, whiteSpace: 'nowrap', display: 'flex' }}>
            {src.text}
          </span>
        </div>
      </div>
    )
  }

  const monoText = (text: string, fontSize: number, color: string, extra: React.CSSProperties = {}) => (
    <span style={{ display: 'flex', fontFamily: 'DM Mono', fontSize, color, ...extra }}>{text}</span>
  )

  // ── JSX ──────────────────────────────────────────────────────────
  const jsx = (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: BG, color: TEXT_PRIMARY, position: 'relative' }}>
      {/* Top accent line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg, ${AMBER} 0%, ${BLUE} 60%, transparent 100%)` }} />

      {/* HEADER */}
      <div
        style={{
          display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          height: HEADER_H, padding: `8px ${SIDE_PAD}px 0 ${SIDE_PAD}px`, borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', width: cityW, overflow: 'hidden' }}>
          {monoText('WHATCHANGED.US · DATA REPORT', 24, AMBER, { letterSpacing: '0.14em' })}
          <span
            style={{
              display: 'flex', fontFamily: 'Bebas Neue', fontSize: cityFs ?? 52, color: TEXT_PRIMARY, lineHeight: 1, marginTop: 6,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: cityW,
            }}
          >
            {place}
          </span>
        </div>
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', width: boxW, flexShrink: 0,
            border: '1px solid rgba(242,169,59,0.35)', borderRadius: 4, padding: `8px ${DATE_BOX_PAD_X}px`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
            {monoText(RANGE_START, DATE_LINE_FS, AMBER, { letterSpacing: DATE_LINE_LS })}
            {/* Drawn arrow: none of the bundled fonts has "→" */}
            <svg width={DATE_ARROW_W} height="14" viewBox="0 0 30 14" style={{ display: 'flex' }}>
              <line x1="6" y1="7" x2="23" y2="7" stroke={AMBER} strokeWidth="2" />
              <polyline points="18,2 24,7 18,12" fill="none" stroke={AMBER} strokeWidth="2" />
            </svg>
            {monoText(end, DATE_LINE_FS, AMBER, { letterSpacing: DATE_LINE_LS })}
          </div>
          {latest ? monoText(latest, DATE_SUB_FS, TEXT_TERTIARY, { marginTop: 4 }) : null}
        </div>
      </div>

      {/* GRID — two rows × two quadrants, every chart the same height */}
      <div style={{ display: 'flex', flexDirection: 'row', height: rowH, borderBottom: `1px solid ${BORDER}` }}>
        {quadrant(gasQ, true)}
        {quadrant(groceriesQ, false)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', height: rowH }}>
        {quadrant(housingQ, true)}
        {quadrant(elecQ, false)}
      </div>

      {/* FOOTNOTES — only when needed */}
      {footnotes.length > 0 ? (
        <div
          style={{
            display: 'flex', flexDirection: 'column', height: footH, padding: `${FOOTNOTE_PAD_Y}px ${SIDE_PAD}px`,
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          {footnotes.map((n) => (
            <span key={n} style={{ display: 'flex', fontFamily: 'DM Mono', fontSize: FS.footnote, color: AMBER }}>{n}</span>
          ))}
        </div>
      ) : null}

      {/* FOOTER */}
      <div
        style={{
          display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          height: FOOTER_H, marginTop: 'auto', padding: `0 ${SIDE_PAD}px`, borderTop: `1px solid ${BORDER}`,
        }}
      >
        {monoText(imageSourcesLine(snapshot, cards), 22, TEXT_TERTIARY)}
        <span style={{ display: 'flex', fontFamily: 'Bebas Neue', fontSize: 32, color: AMBER, letterSpacing: '0.08em' }}>
          WHATCHANGED.US
        </span>
      </div>
    </div>
  )

  return new ImageResponse(jsx, {
    width: CARD_SIZE,
    height: CARD_SIZE,
    fonts: await loadShareFonts(),
    headers: { 'Cache-Control': degraded ? SHARE_CACHE_DEGRADED : SHARE_CACHE_OK },
  })
}
