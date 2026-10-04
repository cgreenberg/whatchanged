import React from 'react'
import { ImageResponse } from 'next/og'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { fmtSignedDollars, fmtSignedPct, fmtDollars, fmtMonthYear, fmtMonthShort, fmtDay, monthsBetween } from '@/lib/format'
import {
  BASELINE_MONTH_LABEL, BASELINE_DAY_LABEL, gasBaselineIndex, gasNationalMatching,
  monthlyBaselineIndex,
} from '@/lib/baseline'
import { buildHeroCards, nationalChangeMatching, tariffIncomeTag, usesNationalFallback, dataThroughLabel, OUTLIER_MARK, isMonthlyGas } from '@/lib/hero-cards'
import { cpiTierOf } from '@/lib/provenance'
import type { CpiData } from '@/types'
import { loadShareFonts } from '@/lib/share-card/fonts'
import { buildLineSparklineV3 } from '@/lib/share-card/sparklines'

// ── Design Tokens ─────────────────────────────────────────────────
const BG = '#0b0c0f'
const BORDER = 'rgba(255,255,255,0.10)'
const TEXT_PRIMARY = '#F0EBE1'
const TEXT_SECONDARY = '#A89F93'
const TEXT_TERTIARY = '#6B6560'
const AMBER = '#F0A500'
const BLUE = '#3D9EFF'
const PURPLE = '#A87EFF'
const RED = '#F04040'

// RGB equivalents for use in rgba() strings
const ACCENT_RGB: Record<string, string> = {
  [AMBER]: '240,165,0',
  [BLUE]: '61,158,255',
  [PURPLE]: '168,126,255',
  [RED]: '240,64,64',
}

// ── Helpers ───────────────────────────────────────────────────────
/** Share image cache: shorter when any source is missing or stale so it self-heals. */
export const SHARE_CACHE_OK = 'public, max-age=3600, s-maxage=86400'
export const SHARE_CACHE_DEGRADED = 'public, max-age=60, s-maxage=300'

/**
 * Monthly sparkline x-axis on real time: each point's position is its month
 * offset over the span, so a run of missing months (e.g. a BLS publication gap)
 * is shown as a gap, not squeezed into one step. Mid label = the month at the
 * time midpoint.
 */
export function monthlyAxis(series: Array<{ date: string }>): { xFractions: number[]; gapAfter: number[]; gapLabels: string[]; xMid: string } {
  if (series.length < 2) return { xFractions: series.map(() => 0), gapAfter: [], gapLabels: [], xMid: '' }
  const first = series[0].date
  const span = monthsBetween(first, series[series.length - 1].date) || 1
  const xFractions = series.map((p) => monthsBetween(first, p.date) / span)
  // > 2 months between points (bimonthly areas publish every other month: not a gap)
  const gapAfter = series.slice(0, -1).flatMap((p, i) => (monthsBetween(p.date, series[i + 1].date) > 2 ? [i] : []))
  const [y, m] = first.split('-').map(Number)
  const mid = new Date(Date.UTC(y, m - 1 + Math.round(span / 2), 1)).toISOString().slice(0, 7)
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
  return { xFractions, gapAfter, gapLabels, xMid: fmtMonthShort(mid) }
}

function addMonths(d: string, n: number): string {
  const [y, m] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

function getMonthLabel(series: Array<{ date: string }>, idx: number): string {
  const d = series[idx]?.date // "2025-01" format
  if (!d) return ''
  const [year, month] = d.split('-')
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${months[parseInt(month, 10) - 1] || ''} '${year.slice(2)}`
}

/** "CPI: Pacific (Census division)" / "CPI: Chicago-Naperville-Elgin (metro)" / "CPI: national". */
export function cpiShareLabel(c: CpiData | null | undefined): string | null {
  if (!c?.metro) return null
  if (c.fallback === 'national') return 'CPI: national (local data unavailable)'
  switch (cpiTierOf(c)) {
    case 1: return `CPI: ${c.metro} (metro)`
    case 2: return `CPI: ${c.metro} (Census division)`
    case 3: return `CPI: ${c.metro} (Census region)`
    case 4: return 'CPI: national'
    default: return `CPI: ${c.metro}`
  }
}

/** "since Dec 2024" — the series' actual baseline month, not always Jan 2025. */
export function sinceLabel(period: string | null | undefined): string {
  return `since ${period ? fmtMonthYear(period) : BASELINE_MONTH_LABEL}`
}

// ── Main Export ───────────────────────────────────────────────────
export async function generateShareCard(zip: string, city?: string, state?: string): Promise<Response> {
  const snapshot = await fetchSnapshot(zip, city, state)
  if (!snapshot) {
    return new Response('Zip code not found', { status: 404 })
  }

  const { location } = snapshot
  const cityName = location.cityName || location.countyName
  const stateAbbr = location.stateAbbr

  // Extract data fields with null guards
  const cpiData = snapshot.cpi.data
  const gasData = snapshot.gas.data

  // Same view-models as the page's hero cards (sanity ranges, rent vs CPI shelter)
  const cards = buildHeroCards(snapshot)
  const card = (id: string) => cards.find((c) => c.id === id)
  const gasOk = card('gas')?.status === 'ok'
  const groceriesOk = card('groceries')?.status === 'ok'
  const rent = card('rent')?.status === 'ok' ? snapshot.rent ?? null : null
  const shelterOk = !rent && card('shelter')?.status === 'ok'
  const tariffOk = card('tariff')?.status === 'ok'
  const degraded = cards.some((c) => c.status !== 'ok' || c.stale) || usesNationalFallback(snapshot)

  // Header badge: span of the cards' latest data months (never today's date)
  const monthYear = dataThroughLabel(cards) ?? fmtMonthYear(undefined).toUpperCase()

  // ── Tariff Estimate ──────────────────────────────────────────────
  const tariffCost = tariffOk ? snapshot.tariff.data!.estimatedCost : 0

  // ── National Comparison (same baseline rules as local) ───────────
  // National over the same months as the local figure (never a later month)
  const natGroceriesChange = nationalChangeMatching(
    cpiData?.nationalSeries, (p) => p.groceries, cpiData?.groceriesBaselinePeriod, cpiData?.groceriesLatestPeriod,
  )?.pct
  const natShelterChange = nationalChangeMatching(
    cpiData?.nationalSeries, (p) => p.shelter, cpiData?.shelterBaselinePeriod, cpiData?.shelterLatestPeriod,
  )?.pct
  // National from the same source over the same period (BLS monthly → same months; EIA weekly → NUS)
  const natGas = gasData?.isNationalFallback ? null : gasNationalMatching(gasData)
  const gasMonthly = isMonthlyGas(gasData)
  // One line in the cell (the sparkline height assumes it): abbreviate the longest EIA name;
  // BLS tiers use the short tag ("Philadelphia metro", "Urban Hawaii", "East North Central div.").
  const gasGeo = gasOk
    ? (gasMonthly ? card('gas')?.geoTag : card('gas')?.provenance.geography?.replace('excl. California', 'excl. CA')) ?? null
    : null
  const rentOutlier = !!rent && card('rent')?.outlier === true
  const incomeTag = tariffOk ? tariffIncomeTag(snapshot) : undefined
  const gasSince = gasMonthly
    ? `since ${gasData?.baselineDate ? fmtMonthYear(gasData.baselineDate) : BASELINE_MONTH_LABEL}`
    : gasData?.baselineDate ? `since ${fmtDay(gasData.baselineDate)}` : `since ${BASELINE_DAY_LABEL}`
  const cpiLabel = cpiShareLabel(cpiData)
  const natGasChange = natGas?.change

  // ── Gas Sparkline Data ───────────────────────────────────────────
  // Start at the baseline week to match the hero number
  const gasAll = gasData?.series ?? []
  const gasSeries = gasAll.slice(Math.max(0, gasBaselineIndex(gasAll)))
  const gasValues = gasSeries.map((p) => p.price)
  const gasMin = gasValues.length ? Math.min(...gasValues) : 0
  const gasMax = gasValues.length ? Math.max(...gasValues) : 0
  const gasMid = (gasMin + gasMax) / 2
  const gasXLeft = getMonthLabel(gasSeries, 0)
  const gasXMid = getMonthLabel(gasSeries, Math.floor(gasSeries.length / 2))
  const gasXRight = getMonthLabel(gasSeries, gasSeries.length - 1)

  // ── Grocery Sparkline Data ───────────────────────────────────────
  // Filter to Jan 2025+ for sparkline (series may start from 2020)
  const cpiAll = cpiData?.series ?? []
  // Months where this area's groceries series has no value are skipped (the
  // CPI series is a union of months across groceries/shelter/energy).
  const grocerySeries = cpiAll
    .slice(Math.max(0, monthlyBaselineIndex(cpiAll, (p) => p.groceries)))
    .filter((p): p is typeof p & { groceries: number } => typeof p.groceries === 'number')
  const groceryRaw = grocerySeries.map((p) => p.groceries)
  const groceryBase = groceryRaw[0] !== undefined && groceryRaw[0] !== 0 ? groceryRaw[0] : 1
  const groceryValues = groceryRaw.map((v) => ((v - groceryBase) / groceryBase) * 100)
  const groceryMin = groceryValues.length ? Math.min(...groceryValues) : 0
  const groceryMax = groceryValues.length ? Math.max(...groceryValues) : 0
  // Use the filtered series for x-axis labels
  const cpiXLeft = getMonthLabel(grocerySeries, 0)
  const groceryAxis = monthlyAxis(grocerySeries)
  const cpiXMid = groceryAxis.xMid
  const cpiXRight = getMonthLabel(grocerySeries, grocerySeries.length - 1)

  // ── Shelter Sparkline Data (filtered for null, date-aligned) ─────
  // Filter to Jan 2025+ AND non-null shelter values for sparkline
  const shelterFrom = cpiAll[Math.max(0, monthlyBaselineIndex(cpiAll, (p) => p.shelter))]?.date ?? ''
  const shelterPairs = cpiAll
    .filter((p) => p.date >= shelterFrom && p.shelter !== null)
    .map((p) => ({ date: p.date, value: p.shelter as number }))
  const shelterBase =
    shelterPairs[0]?.value !== undefined && shelterPairs[0].value !== 0 ? shelterPairs[0].value : 1
  const shelterValues = shelterPairs.map((p) => ((p.value - shelterBase) / shelterBase) * 100)
  const shelterMin = shelterValues.length ? Math.min(...shelterValues) : 0
  const shelterMax = shelterValues.length ? Math.max(...shelterValues) : 0
  const shelterXLeft = getMonthLabel(shelterPairs, 0)
  const shelterAxis = monthlyAxis(shelterPairs)
  const shelterXMid = shelterAxis.xMid
  const shelterXRight = getMonthLabel(shelterPairs, shelterPairs.length - 1)

  // ── Build Sparklines ─────────────────────────────────────────────
  const gasSparkline =
    gasOk && gasValues.length >= 2
      ? buildLineSparklineV3(gasValues, RED, 'grad-gas', {
          yMin: `$${gasMin.toFixed(2)}`,
          yMid: `$${gasMid.toFixed(2)}`,
          yMax: `$${gasMax.toFixed(2)}`,
          xLeft: gasXLeft,
          xMid: gasXMid,
          xRight: gasXRight,
          // Leave room for the meta row (baseline + national) under the number; less with the geography line
          height: gasGeo ? 146 : 170,
        })
      : null

  const groceryRange = groceryValues.length >= 2 ? Math.abs(groceryMax - groceryMin) : 0
  const groceryPadded =
    groceryValues.length >= 2
      ? { min: Math.min(0, groceryMin), max: Math.max(0, groceryMax) + groceryRange * 0.05 }
      : undefined

  const groceryBoundsMin = groceryPadded ? groceryPadded.min : groceryMin
  const groceryBoundsMax = groceryPadded ? groceryPadded.max : groceryMax
  const groceryBoundsMid = (groceryBoundsMin + groceryBoundsMax) / 2

  const grocerySparkline =
    groceriesOk && groceryValues.length >= 2
      ? buildLineSparklineV3(groceryValues, AMBER, 'grad-groceries', {
          yMin: `${groceryBoundsMin.toFixed(1)}%`,
          yMid: `${groceryBoundsMid.toFixed(1)}%`,
          yMax: `${groceryBoundsMax.toFixed(1)}%`,
          xLeft: cpiXLeft,
          xMid: cpiXMid,
          xRight: cpiXRight,
          height: 170,
          bounds: groceryPadded,
          xFractions: groceryAxis.xFractions,
          gapAfter: groceryAxis.gapAfter,
          gapLabels: groceryAxis.gapLabels,
        })
      : null

  const shelterRange = shelterValues.length >= 2 ? Math.abs(shelterMax - shelterMin) : 0
  const shelterPadded =
    shelterValues.length >= 2
      ? { min: Math.min(0, shelterMin), max: Math.max(0, shelterMax) + shelterRange * 0.05 }
      : undefined

  const shelterBoundsMin = shelterPadded ? shelterPadded.min : shelterMin
  const shelterBoundsMax = shelterPadded ? shelterPadded.max : shelterMax
  const shelterBoundsMid = (shelterBoundsMin + shelterBoundsMax) / 2

  const shelterSparkline =
    shelterOk && shelterValues.length >= 2
      ? buildLineSparklineV3(shelterValues, BLUE, 'grad-shelter', {
          yMin: `${shelterBoundsMin.toFixed(1)}%`,
          yMid: `${shelterBoundsMid.toFixed(1)}%`,
          yMax: `${shelterBoundsMax.toFixed(1)}%`,
          xLeft: shelterXLeft,
          xMid: shelterXMid,
          xRight: shelterXRight,
          height: 170,
          bounds: shelterPadded,
          xFractions: shelterAxis.xFractions,
          gapAfter: shelterAxis.gapAfter,
          gapLabels: shelterAxis.gapLabels,
        })
      : null

  const medianIncome = snapshot.tariff.data?.medianIncome ?? 0

  // ── Inline cell helpers (avoid named components in Satori render tree) ──
  const accentStrip = (accent: string) => (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        backgroundColor: accent,
        display: 'flex',
      }}
    />
  )

  const sectionLabel = (label: string, sublabel: string, extra?: string | null) => (
    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12 }}>
      <span
        style={{
          fontFamily: 'Barlow Condensed',
          fontWeight: 600,
          fontSize: 40,
          color: TEXT_SECONDARY,
          display: 'flex',
          letterSpacing: '0.10em',
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: 'DM Mono', fontSize: 24, color: TEXT_TERTIARY, display: 'flex' }}>
        {sublabel}
      </span>
      {extra && (
        <span style={{ fontFamily: 'DM Mono', fontSize: 20, color: TEXT_TERTIARY, display: 'flex' }}>
          {extra}
        </span>
      )}
    </div>
  )

  const bigNumber = (value: string, accent: string) => (
    <span
      style={{
        fontFamily: 'Bebas Neue',
        fontSize: 96,
        color: accent,
        lineHeight: 1,
        display: 'flex',
      }}
    >
      {value}
    </span>
  )

  const changePill = (text: string, accent: string) => {
    const rgb = ACCENT_RGB[accent] ?? '255,255,255'
    return (
      <div
        style={{
          display: 'flex',
          backgroundColor: `rgba(${rgb}, 0.22)`,
          borderWidth: 1.5,
          borderStyle: 'solid',
          borderColor: `rgba(${rgb}, 0.55)`,
          borderRadius: 4,
          padding: '9px 20px',
          alignSelf: 'flex-end',
          marginLeft: 12,
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'Barlow Condensed',
            fontWeight: 600,
            fontSize: 40,
            color: accent,
            display: 'flex',
          }}
        >
          {text}
        </span>
      </div>
    )
  }

  const metaRow = (left: string, right: string | null) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 6,
      }}
    >
      <span style={{ fontFamily: 'DM Mono', fontSize: 26, color: TEXT_SECONDARY, display: 'flex' }}>
        {left}
      </span>
      {right && (
        <span
          style={{
            fontFamily: 'DM Mono',
            fontSize: 26,
            color: TEXT_SECONDARY,
            display: 'flex',
            fontStyle: 'italic',
          }}
        >
          {right}
        </span>
      )}
    </div>
  )

  // ── JSX ──────────────────────────────────────────────────────────
  const jsx = (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: BG,
        color: TEXT_PRIMARY,
        position: 'relative',
      }}
    >
      {/* Top accent line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          zIndex: 10,
          background: `linear-gradient(90deg, ${AMBER} 0%, ${BLUE} 60%, transparent 100%)`,
        }}
      />

      {/* HEADER — 140px */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          height: 160,
          padding: '16px 40px 0 40px',
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <span
            style={{
              display: 'flex',
              fontFamily: 'DM Mono',
              fontSize: 24,
              color: AMBER,
              letterSpacing: '0.14em',
            }}
          >
            WHATCHANGED.US · DATA REPORT
          </span>
          <span
            style={{
              display: 'flex',
              fontFamily: 'Bebas Neue',
              fontSize: 76,
              color: TEXT_PRIMARY,
              lineHeight: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {cityName.toUpperCase()}, {stateAbbr}
          </span>
          {cpiLabel && (
            <span
              style={{
                display: 'flex',
                fontFamily: 'DM Mono',
                fontSize: 20,
                color: TEXT_TERTIARY,
                marginTop: 2,
              }}
            >
              {cpiLabel}
            </span>
          )}
        </div>

        {/* Right column */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            paddingTop: 4,
            gap: 6,
            flexShrink: 0,
          }}
        >
          {/* Date range badge */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              border: `1px solid rgba(240,165,0,0.30)`,
              borderRadius: 4,
              padding: '6px 16px',
              gap: 2,
            }}
          >
            <span
              style={{
                display: 'flex',
                fontFamily: 'DM Mono',
                fontSize: 22,
                fontWeight: 700,
                color: AMBER,
                letterSpacing: '0.06em',
              }}
            >
              {BASELINE_DAY_LABEL.toUpperCase()}
            </span>
            <span
              style={{
                display: 'flex',
                fontFamily: 'DM Mono',
                fontSize: 56,
                color: 'rgba(240,165,0,0.45)',
                lineHeight: 1,
              }}
            >
              ↓
            </span>
            <span
              style={{
                display: 'flex',
                fontFamily: 'DM Mono',
                fontSize: 22,
                fontWeight: 700,
                color: AMBER,
                letterSpacing: '0.06em',
              }}
            >
              {monthYear}
            </span>
          </div>
        </div>
      </div>

      {/* GRID — flex:1 — two rows × two cells */}
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
        {/* Row 1 */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'row',
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          {/* Cell: Gas Prices */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              position: 'relative',
              padding: '16px 28px 24px 36px',
              overflow: 'hidden',
              borderRight: `1px solid ${BORDER}`,
            }}
          >
            {accentStrip(RED)}
            {sectionLabel('GAS PRICES', '(regular gasoline, $/gal)', gasGeo)}
            {gasSparkline && (
              <div style={{ display: 'flex', width: '100%', marginBottom: 8 }}>{gasSparkline}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' }}>
              {bigNumber(gasOk ? `$${gasData!.current.toFixed(2)}/gal` : 'N/A', RED)}
              {changePill(gasOk ? fmtSignedDollars(gasData!.change) : '—', RED)}
            </div>
            {metaRow(
              gasSince,
              // Like-for-like with the pill: same source, same baseline rule, same months (BLS)
              natGasChange != null ? `Natl: ${fmtSignedDollars(natGasChange)}` : null
            )}
          </div>

          {/* Cell: Groceries */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              position: 'relative',
              padding: '16px 28px 24px 36px',
              overflow: 'hidden',
            }}
          >
            {accentStrip(AMBER)}
            {sectionLabel('GROCERIES', '(CPI: food at home)')}
            {grocerySparkline && (
              <div style={{ display: 'flex', width: '100%', marginBottom: 8 }}>
                {grocerySparkline}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' }}>
              {bigNumber(groceriesOk ? fmtSignedPct(cpiData!.groceriesChange) : 'N/A', AMBER)}
              {changePill(
                groceriesOk && snapshot.dollarImpact?.groceries != null
                  ? `${fmtSignedDollars(snapshot.dollarImpact.groceries, 0)}/yr`
                  : '—',
                AMBER
              )}
            </div>
            {metaRow(
              sinceLabel(cpiData?.groceriesBaselinePeriod),
              natGroceriesChange !== undefined && cpiData?.tier !== 4 ? `Natl: ${fmtSignedPct(natGroceriesChange)}` : null
            )}
          </div>
        </div>

        {/* Row 2 */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'row',
          }}
        >
          {/* Cell: Shelter */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              position: 'relative',
              padding: '16px 28px 24px 36px',
              overflow: 'hidden',
              borderRight: `1px solid ${BORDER}`,
            }}
          >
            {accentStrip(BLUE)}
            {rent ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {sectionLabel('RENT', '(new leases, Zillow, county)')}
                <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center' }}>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 24, color: TEXT_SECONDARY, display: 'flex' }}>
                    {`Asking rent: ${fmtDollars(rent.curRent)}/mo (${fmtMonthShort(rent.asOf)})`}
                  </span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 20, color: TEXT_TERTIARY, display: 'flex', marginTop: 4 }}>
                    {rent.geoName}
                  </span>
                  {rentOutlier && (
                    <span style={{ fontFamily: 'DM Mono', fontSize: 19, color: AMBER, display: 'flex', marginTop: 8 }}>
                      {`${OUTLIER_MARK} Unusual value: far outside most U.S. counties; treat with caution.`}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' }}>
                  {bigNumber(`${fmtSignedPct(rent.pct)}${rentOutlier ? OUTLIER_MARK : ''}`, BLUE)}
                  {/* No dollar pill for a flagged (†) value: keep the % with its caveat only. */}
                  {!rentOutlier && changePill(`≈ ${fmtSignedDollars(rent.monthlyChange, 0)}/mo`, BLUE)}
                </div>
                {metaRow(sinceLabel(rent.baseMonth), 'seasonally adj.')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {sectionLabel('SHELTER', '(CPI, all tenants & homeowners)')}
                {shelterSparkline && (
                  <div style={{ display: 'flex', width: '100%', marginBottom: 8 }}>
                    {shelterSparkline}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' }}>
                  {bigNumber(shelterOk ? fmtSignedPct(cpiData!.shelterChange!) : 'N/A', BLUE)}
                  {changePill(
                    shelterOk && card('shelter')?.change && snapshot.dollarImpact?.shelter != null
                      ? `≈ ${fmtSignedDollars(snapshot.dollarImpact.shelter, 0)}/yr`
                      : '—',
                    BLUE
                  )}
                </div>
                {metaRow(
                  sinceLabel(cpiData?.shelterBaselinePeriod),
                  natShelterChange !== undefined && cpiData?.tier !== 4 ? `Natl: ${fmtSignedPct(natShelterChange)}` : null
                )}
              </div>
            )}
          </div>

          {/* Cell: Tariffs */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              position: 'relative',
              padding: '16px 28px 24px 36px',
              overflow: 'hidden',
            }}
          >
            {accentStrip(PURPLE)}
            {sectionLabel('TARIFFS', '(est. annual cost to household)')}
            {/* Centered number block — fills the chart zone */}
            <div
              style={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {bigNumber(tariffCost > 0 ? `~${fmtDollars(tariffCost)}/yr` : 'N/A', PURPLE)}
              {tariffCost > 0 && (
                <span
                  style={{
                    fontFamily: 'Bebas Neue',
                    fontSize: 64,
                    color: PURPLE,
                    lineHeight: 1,
                    display: 'flex',
                    marginTop: 4,
                  }}
                >
                  ~{fmtDollars(Math.round(tariffCost / 12))}/mo
                </span>
              )}
              {tariffOk && (
                <span
                  style={{
                    fontFamily: 'DM Mono',
                    fontSize: 20,
                    color: TEXT_TERTIARY,
                    display: 'flex',
                    marginTop: 16,
                    textAlign: 'center',
                  }}
                >
                  based on median income of{' '}
                  {medianIncome >= 1000
                    ? `$${(medianIncome / 1000).toFixed(0)}k`
                    : `$${Math.round(medianIncome)}`}
                  {incomeTag ? ` (${incomeTag})` : ''}
                </span>
              )}
              <span
                style={{
                  fontFamily: 'DM Mono',
                  fontSize: 20,
                  color: TEXT_TERTIARY,
                  display: 'flex',
                  marginTop: 4,
                }}
              >
                Yale Budget Lab
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER — 60px */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: 60,
          padding: '0 40px',
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        <span
          style={{
            display: 'flex',
            fontFamily: 'DM Mono',
            fontSize: 22,
            color: TEXT_TERTIARY,
          }}
        >
          {rent ? 'BLS · EIA · Zillow · Census · Yale Budget Lab' : 'BLS · EIA · Census · Yale Budget Lab'}
        </span>
        <span
          style={{
            display: 'flex',
            fontFamily: 'Bebas Neue',
            fontSize: 32,
            color: AMBER,
            letterSpacing: '0.08em',
          }}
        >
          WHATCHANGED.US
        </span>
      </div>
    </div>
  )

  return new ImageResponse(jsx, {
    width: 1080,
    height: 1080,
    fonts: await loadShareFonts(),
    headers: { 'Cache-Control': degraded ? SHARE_CACHE_DEGRADED : SHARE_CACHE_OK },
  })
}
