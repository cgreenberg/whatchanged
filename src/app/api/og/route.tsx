import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { getCachedNationalData } from '@/lib/api/national'
import { buildHeroCards, usesNationalFallback, dataThroughLabel, OUTLIER_MARK, OUTLIER_FOOTNOTE, type HeroCardModel } from '@/lib/hero-cards'
import { fmtSignedDollars, fmtSignedPct, fmtDollars, fmtMonthShort, fmtMonthYear, fmtDay } from '@/lib/format'
import { BASELINE_DAY_LABEL, gasBaselineIndex } from '@/lib/baseline'
import type { NationalDataPoint } from '@/lib/api/national'
import { loadShareFonts } from '@/lib/share-card/fonts'
import { computeDotX, computeDotY, DOT_PAD } from '@/lib/share-card/og-geometry'

export const runtime = 'nodejs'

// ── Design Tokens (match share card) ────────────────────────────────
const BG = '#0b0c0f'
const BORDER = 'rgba(255,255,255,0.10)'
const TEXT_PRIMARY = '#F0EBE1'
const TEXT_SECONDARY = '#A89F93'
const TEXT_TERTIARY = '#6B6560'
const AMBER = '#F0A500'
const BLUE = '#3D9EFF'
const PURPLE = '#A87EFF'
const RED = '#F04040'


function buildSparklinePath(data: NationalDataPoint[], width: number, height: number): string {
  if (data.length < 2) return '0,0'
  const values = data.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const usableWidth = width - 2 * DOT_PAD
  const usableHeight = height - 2 * DOT_PAD

  return data.map((d, i) => {
    const x = DOT_PAD + (i / (data.length - 1)) * usableWidth
    const y = DOT_PAD + usableHeight - ((d.value - min) / range) * usableHeight
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function buildAreaPath(data: NationalDataPoint[], width: number, height: number): string {
  if (data.length < 2) return '0,0'
  const sparkline = buildSparklinePath(data, width, height)
  return `${DOT_PAD},${height - DOT_PAD} ${sparkline} ${width - DOT_PAD},${height - DOT_PAD}`
}

function yLabels(series: NationalDataPoint[], fmt: 'dollar' | 'percent'): { yMin: string; yMid: string; yMax: string } {
  if (!series.length) return { yMin: '', yMid: '', yMax: '' }
  const values = series.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const mid = (min + max) / 2
  if (fmt === 'dollar') {
    return { yMin: `$${min.toFixed(2)}`, yMid: `$${mid.toFixed(2)}`, yMax: `$${max.toFixed(2)}` }
  }
  return { yMin: `${min.toFixed(1)}%`, yMid: `${mid.toFixed(1)}%`, yMax: `${max.toFixed(1)}%` }
}

function midDateLabel(series: NationalDataPoint[]): string {
  if (series.length < 3) return ''
  return fmtMonthShort(series[Math.floor(series.length / 2)].date).toUpperCase()
}

function gridlineYPositions(series: NationalDataPoint[], height: number): { minY: number; midY: number } {
  if (!series.length) return { minY: height - DOT_PAD, midY: height / 2 }
  const values = series.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const usableH = height - 2 * DOT_PAD
  const mid = (min + max) / 2
  const minY = DOT_PAD + usableH - ((min - min) / range) * usableH
  const midY = DOT_PAD + usableH - ((mid - min) / range) * usableH
  return { minY, midY }
}

/**
 * Context under each OG stat: line 1 = short geography (every number comes from a different
 * area: county rent, regional CPI, regional gas), line 2 = baseline window.
 */
function ogSublines(c: HeroCardModel): [string, string] {
  // Weekly EIA: "since Jan 13, 2025"; monthly BLS gas: "since Jan 2025"
  const since = c.provenance.window.replace(/^since week of /, 'since ').replace(/^monthly · /, '')
  switch (c.id) {
    case 'gas': return [c.geoTag ?? c.provenance.geography, since]
    case 'rent': return [c.geoTag ?? c.provenance.geography, `${since}, seas. adj.`]
    case 'tariff': return [c.geoTag ? `${c.geoTag} income` : 'income', 'estimate']
    default: return [c.geoTag ?? c.provenance.geography, since]
  }
}

/** Short CDN lifetime; degraded (missing/stale) cards expire fast so they self-heal. */
const CACHE_OK = 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400'
const CACHE_DEGRADED = 'public, max-age=60, s-maxage=300'

const OG_LABELS: Record<HeroCardModel['id'], string> = {
  gas: 'GAS (REGULAR)',
  rent: 'RENT (NEW LEASES)',
  shelter: 'SHELTER (CPI)',
  groceries: 'GROCERIES',
  tariff: 'TARIFF IMPACT (EST.)',
}
const OG_COLORS: Record<HeroCardModel['id'], string> = {
  gas: RED, rent: BLUE, shelter: BLUE, groceries: AMBER, tariff: PURPLE,
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const zip = searchParams.get('zip') ?? ''
  const city = searchParams.get('city')?.slice(0, 100) || undefined
  const state = searchParams.get('state')?.slice(0, 2) || undefined

  // Everything drawn comes from the zip's own snapshot — no free-text query params.
  let location = ''
  let stats: Array<{ label: string; value: string; unit?: string; color: string; sub?: string; sub2?: string }> = []
  const footnotes: string[] = []
  let latestPeriod: string | undefined
  let throughLabel: string | null = null
  let degraded = false
  let sources = 'BLS · EIA · Census · Yale Budget Lab'

  if (/^\d{5}$/.test(zip)) {
    try {
      const snapshot = await fetchSnapshot(zip, city, state)
      if (snapshot) {
        const cards = buildHeroCards(snapshot)
        location = `${snapshot.location.cityName || snapshot.location.countyName}, ${snapshot.location.stateAbbr}`
        sources = cards.some(c => c.id === 'rent' && c.status === 'ok')
          ? 'BLS · EIA · Zillow · Census · Yale Budget Lab'
          : 'BLS · EIA · Census · Yale Budget Lab'
        stats = cards.map(c => {
          const [sub, sub2] = c.status === 'ok' ? ogSublines(c) : [undefined, undefined]
          const isGas = c.status === 'ok' && c.id === 'gas' && !!snapshot.gas.data
          const value = c.status === 'ok' ? (isGas ? fmtSignedDollars(snapshot.gas.data!.change) : c.value ?? '') : ''
          return {
            label: OG_LABELS[c.id],
            value: value && c.outlier ? `${value}${OUTLIER_MARK}` : value,
            // Unit drawn smaller on the same line so "+$1.19/gal" never wraps
            unit: isGas ? '/gal' : undefined,
            color: OG_COLORS[c.id],
            sub,
            sub2,
          }
        })
        if (cards.some(c => c.status === 'ok' && c.outlier)) footnotes.push(OUTLIER_FOOTNOTE)
        latestPeriod = cards.map(c => c.asOfPeriod).filter((p): p is string => !!p).sort().pop()
        throughLabel = dataThroughLabel(cards)
        degraded = cards.some(c => c.status !== 'ok' || c.stale) || usesNationalFallback(snapshot)
      }
    } catch {
      // fall through to the national card
    }
  }

  const hasData = !!location && stats.some(s => s.value) && !!latestPeriod

  if (!hasData) {
    const fetched = await getCachedNationalData()
    // No hard-coded fallback numbers: if national data is unavailable, don't render a card
    if (!fetched.gas || !fetched.groceries || !fetched.shelter) {
      return new Response('National data unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    const nationalStale = [fetched.gas, fetched.groceries, fetched.shelter].some(m => m.stale)
    // Header/axis dates come from the data, never today's date
    const nationalLatest = [fetched.gas.latestPeriod, fetched.groceries.latestPeriod, fetched.shelter.latestPeriod]
      .filter(Boolean).sort().pop()
    // Sparklines start at the baseline point (same rule as the headline numbers)
    const gasFrom = gasBaselineIndex(fetched.gas.series)
    const national = {
      ...fetched,
      gas: { ...fetched.gas, series: fetched.gas.series.slice(Math.max(0, gasFrom)) },
      groceries: { ...fetched.groceries, series: fetched.groceries.series.filter(p => p.date >= fetched.groceries!.baselinePeriod) },
      shelter: { ...fetched.shelter, series: fetched.shelter.series.filter(p => p.date >= fetched.shelter!.baselinePeriod) },
    }

    // Format values for display
    const gasChange = fmtSignedDollars(national.gas.change)
    const grocChange = fmtSignedPct(national.groceries.change)
    const sheltChange = fmtSignedPct(national.shelter.change)
    const tariffAnnual = `~${fmtDollars(national.tariff.annualCost)}/yr`

    // Sparkline dimensions per panel (leave 45px for y-axis labels)
    const yAxisW = 55
    const sparkW = 265
    const sparkH = 120

    // Build SVG point strings
    const gasPoints = buildSparklinePath(national.gas.series, sparkW, sparkH)
    const gasArea = buildAreaPath(national.gas.series, sparkW, sparkH)
    const grocPoints = buildSparklinePath(national.groceries.series, sparkW, sparkH)
    const grocArea = buildAreaPath(national.groceries.series, sparkW, sparkH)
    const sheltPoints = buildSparklinePath(national.shelter.series, sparkW, sparkH)
    const sheltArea = buildAreaPath(national.shelter.series, sparkW, sparkH)

    // Date labels
    const latestMonth = fmtMonthShort(nationalLatest).toUpperCase()

    // RGB lookup for dynamic pill colors
    const RGB: Record<string, string> = {
      [RED]: '240,64,64',
      [AMBER]: '240,165,0',
      [BLUE]: '61,158,255',
    }

    const gasYLabels = yLabels(national.gas.series, 'dollar')
    const grocYLabels = yLabels(national.groceries.series, 'percent')
    const sheltYLabels = yLabels(national.shelter.series, 'percent')

    const gasMidDate = midDateLabel(national.gas.series)
    const grocMidDate = midDateLabel(national.groceries.series)
    const sheltMidDate = midDateLabel(national.shelter.series)

    const gasGrid = gridlineYPositions(national.gas.series, sparkH)
    const grocGrid = gridlineYPositions(national.groceries.series, sparkH)
    const sheltGrid = gridlineYPositions(national.shelter.series, sparkH)

    const panels = [
      { label: 'GAS PRICES', sublabel: '(regular gasoline, $/gal)', value: `$${national.gas.current.toFixed(2)}/gal`, pill: gasChange, color: RED, points: gasPoints, area: gasArea, startDotX: computeDotX(national.gas.series, 0, sparkW), startDotY: computeDotY(national.gas.series, 0, sparkH), endDotX: computeDotX(national.gas.series, -1, sparkW), endDotY: computeDotY(national.gas.series, -1, sparkH), firstDate: national.gas.series[0]?.date, since: national.gas.series[0]?.date ? `since ${fmtDay(national.gas.series[0].date)}` : `since ${BASELINE_DAY_LABEL}`, yMin: gasYLabels.yMin, yMid: gasYLabels.yMid, yMax: gasYLabels.yMax, midDate: gasMidDate, gridMinY: gasGrid.minY, gridMidY: gasGrid.midY },
      { label: 'GROCERIES', sublabel: '(CPI: food at home)', value: grocChange, pill: national.groceries.change >= 0 ? 'rising' : 'falling', color: AMBER, points: grocPoints, area: grocArea, startDotX: computeDotX(national.groceries.series, 0, sparkW), startDotY: computeDotY(national.groceries.series, 0, sparkH), endDotX: computeDotX(national.groceries.series, -1, sparkW), endDotY: computeDotY(national.groceries.series, -1, sparkH), firstDate: national.groceries.series[0]?.date, since: `since ${fmtMonthYear(national.groceries.baselinePeriod)}`, yMin: grocYLabels.yMin, yMid: grocYLabels.yMid, yMax: grocYLabels.yMax, midDate: grocMidDate, gridMinY: grocGrid.minY, gridMidY: grocGrid.midY },
      { label: 'SHELTER', sublabel: "(rent & owners' equiv.)", value: sheltChange, pill: national.shelter.change >= 0 ? 'rising' : 'falling', color: BLUE, points: sheltPoints, area: sheltArea, startDotX: computeDotX(national.shelter.series, 0, sparkW), startDotY: computeDotY(national.shelter.series, 0, sparkH), endDotX: computeDotX(national.shelter.series, -1, sparkW), endDotY: computeDotY(national.shelter.series, -1, sparkH), firstDate: national.shelter.series[0]?.date, since: `since ${fmtMonthYear(national.shelter.baselinePeriod)}`, yMin: sheltYLabels.yMin, yMid: sheltYLabels.yMid, yMax: sheltYLabels.yMax, midDate: sheltMidDate, gridMinY: sheltGrid.minY, gridMidY: sheltGrid.midY },
    ]

    return new ImageResponse(
      (
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
          {/* Top gradient bar */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: `linear-gradient(90deg, ${AMBER} 0%, #E8557A 50%, ${BLUE} 100%)`,
              display: 'flex',
            }}
          />

          {/* HEADER */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '20px 40px 12px 40px',
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            <span
              style={{
                fontFamily: 'DM Mono',
                fontSize: 16,
                color: AMBER,
                letterSpacing: '0.14em',
                display: 'flex',
                marginBottom: 6,
              }}
            >
              WHATCHANGED.US · DATA REPORT
            </span>
            <span
              style={{
                fontFamily: 'Bebas Neue',
                fontSize: 58,
                color: TEXT_PRIMARY,
                lineHeight: 1.1,
                display: 'flex',
                marginBottom: 6,
              }}
            >
              NATIONAL SNAPSHOT
            </span>
            <span
              style={{
                fontFamily: 'DM Mono',
                fontSize: 18,
                color: '#777',
                display: 'flex',
              }}
            >
              Since {BASELINE_DAY_LABEL} · data through {fmtMonthYear(nationalLatest)} · enter your zip for local data
            </span>
          </div>

          {/* THREE CHART PANELS */}
          <div
            style={{
              display: 'flex',
              flex: 1,
              flexDirection: 'row',
              padding: '0 40px',
            }}
          >
            {panels.map((panel, idx) => (
              <div
                key={panel.label}
                style={{
                  display: 'flex',
                  flex: 1,
                  flexDirection: 'column',
                  padding: '16px 16px 8px 16px',
                  borderRight: idx < 2 ? `1px solid ${BORDER}` : 'none',
                }}
              >
                {/* Category label */}
                <span
                  style={{
                    fontFamily: 'Barlow Condensed',
                    fontWeight: 600,
                    fontSize: 31,
                    color: TEXT_SECONDARY,
                    letterSpacing: '0.1em',
                    display: 'flex',
                    marginBottom: 2,
                  }}
                >
                  {panel.label}
                </span>
                {/* Category sublabel */}
                <span
                  style={{
                    fontFamily: 'DM Mono',
                    fontSize: 13,
                    color: TEXT_TERTIARY,
                    display: 'flex',
                    marginBottom: 6,
                  }}
                >
                  {panel.sublabel}
                </span>
                {/* Sparkline with y-axis labels */}
                <div style={{ display: 'flex', flexDirection: 'row' }}>
                  {/* Y-axis labels */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      width: yAxisW,
                      height: sparkH,
                      paddingRight: 4,
                    }}
                  >
                    <span style={{ fontFamily: 'DM Mono', fontSize: 16, color: '#555', display: 'flex' }}>
                      {panel.yMax}
                    </span>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 16, color: '#555', display: 'flex' }}>
                      {panel.yMid}
                    </span>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 16, color: '#555', display: 'flex' }}>
                      {panel.yMin}
                    </span>
                  </div>
                  {/* Sparkline SVG */}
                  <svg
                    viewBox={`0 0 ${sparkW} ${sparkH}`}
                    width={sparkW}
                    height={sparkH}
                    style={{ display: 'flex' }}
                  >
                    {/* Gridlines */}
                    <line x1="0" y1={panel.gridMinY.toFixed(1)} x2={sparkW.toString()} y2={panel.gridMinY.toFixed(1)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4,4" />
                    <line x1="0" y1={panel.gridMidY.toFixed(1)} x2={sparkW.toString()} y2={panel.gridMidY.toFixed(1)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4,4" />
                    <polygon
                      points={panel.area}
                      fill={panel.color}
                      opacity="0.15"
                    />
                    <polyline
                      points={panel.points}
                      fill="none"
                      stroke={panel.color}
                      strokeWidth="3"
                    />
                    <circle cx={panel.startDotX.toFixed(1)} cy={panel.startDotY.toFixed(1)} r="8" fill={panel.color} />
                    <circle cx={panel.endDotX.toFixed(1)} cy={panel.endDotY.toFixed(1)} r="8" fill={panel.color} />
                  </svg>
                </div>
                {/* Date labels (3: start, mid, end) */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginTop: 0,
                    marginLeft: yAxisW,
                  }}
                >
                  <span style={{ fontFamily: 'DM Mono', fontSize: 18, color: '#555', display: 'flex' }}>
                    {fmtMonthShort(panel.firstDate).toUpperCase()}
                  </span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 18, color: '#555', display: 'flex' }}>
                    {panel.midDate}
                  </span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 18, color: '#555', display: 'flex' }}>
                    {latestMonth}
                  </span>
                </div>
                {/* Big number + pill */}
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 }}>
                  <span
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 800,
                      fontSize: 70,
                      color: panel.color,
                      lineHeight: 1,
                      display: 'flex',
                    }}
                  >
                    {panel.value}
                  </span>
                  {panel.pill ? (
                    <div
                      style={{
                        display: 'flex',
                        backgroundColor: `rgba(${RGB[panel.color]}, 0.22)`,
                        border: `1.5px solid rgba(${RGB[panel.color]}, 0.55)`,
                        borderRadius: 4,
                        padding: '5px 12px',
                        marginLeft: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'Inter, sans-serif',
                          fontWeight: 700,
                          fontSize: 29,
                          color: panel.color,
                          display: 'flex',
                        }}
                      >
                        {panel.pill}
                      </span>
                    </div>
                  ) : null}
                </div>
                {/* Meta row */}
                <span
                  style={{
                    fontFamily: 'DM Mono',
                    fontSize: 13,
                    color: TEXT_TERTIARY,
                    display: 'flex',
                    marginTop: 4,
                  }}
                >
                  {panel.since}
                </span>
              </div>
            ))}
          </div>

          {/* TARIFF BOTTOM BAND */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              padding: '12px 40px',
              borderTop: `1px solid ${BORDER}`,
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span
                style={{
                  fontFamily: 'DM Mono',
                  fontSize: 14,
                  color: '#888',
                  letterSpacing: '0.08em',
                  display: 'flex',
                  marginBottom: 4,
                }}
              >
                TARIFF COST TO AVERAGE HOUSEHOLD:
              </span>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 800,
                    fontSize: 49,
                    color: PURPLE,
                    display: 'flex',
                  }}
                >
                  {tariffAnnual}
                </span>
                <span
                  style={{
                    fontFamily: 'DM Mono',
                    fontSize: 13,
                    color: '#666',
                    display: 'flex',
                  }}
                >
                  · based on national median income · Yale Budget Lab
                </span>
              </div>
            </div>
            <span
              style={{
                fontFamily: 'Bebas Neue',
                fontSize: 60,
                color: AMBER,
                letterSpacing: '0.06em',
                display: 'flex',
              }}
            >
              WHATCHANGED.US
            </span>
          </div>

          {/* FOOTER */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              height: 44,
              padding: '0 40px',
              borderTop: `1px solid ${BORDER}`,
            }}
          >
            <span style={{ fontFamily: 'DM Mono', fontSize: 14, color: '#444', display: 'flex' }}>
              BLS · EIA · Census · Yale Budget Lab
            </span>
          </div>
        </div>
      ),
      // A stale national series (last-good copy or old period) gets the short cache so it self-heals
      { width: 1200, height: 630, fonts: await loadShareFonts(), headers: { 'Cache-Control': nationalStale ? CACHE_DEGRADED : CACHE_OK } },
    )
  }

  const monthYear = throughLabel ?? fmtMonthYear(latestPeriod).toUpperCase()

  return new ImageResponse(
    (
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
            background: `linear-gradient(90deg, ${AMBER} 0%, ${BLUE} 60%, transparent 100%)`,
            display: 'flex',
          }}
        />

        {/* HEADER — ~120px */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            height: 120,
            padding: '16px 40px 0 40px',
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <span
              style={{
                display: 'flex',
                fontFamily: 'monospace',
                fontSize: 18,
                color: AMBER,
                letterSpacing: '0.14em',
              }}
            >
              WHATCHANGED.US · DATA REPORT
            </span>
            <span
              style={{
                display: 'flex',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 800,
                fontSize: 56,
                color: TEXT_PRIMARY,
                lineHeight: 1,
                textTransform: 'uppercase',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {location.toUpperCase()}
            </span>
          </div>

          {/* Right column — date range badge */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              border: '1px solid rgba(240,165,0,0.30)',
              borderRadius: 4,
              padding: '4px 14px',
              gap: 0,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                display: 'flex',
                fontFamily: 'monospace',
                fontSize: 16,
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
                fontFamily: 'monospace',
                fontSize: 28,
                color: 'rgba(240,165,0,0.45)',
                lineHeight: 1,
              }}
            >
              ↓
            </span>
            <span
              style={{
                display: 'flex',
                fontFamily: 'monospace',
                fontSize: 16,
                fontWeight: 700,
                color: AMBER,
                letterSpacing: '0.06em',
              }}
            >
              {monthYear}
            </span>
          </div>
        </div>

        {/* STATS ROW — four cards */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'row',
            padding: '0 40px',
            gap: 24,
            alignItems: 'center',
          }}
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                position: 'relative',
                paddingLeft: 16,
              }}
            >
              {/* 3px left accent border */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  backgroundColor: stat.color,
                  display: 'flex',
                }}
              />
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: 18,
                  color: TEXT_SECONDARY,
                  display: 'flex',
                  marginBottom: 8,
                  letterSpacing: '0.08em',
                }}
              >
                {stat.label}
              </span>
              <span
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 800,
                  fontSize: 52,
                  color: stat.value ? stat.color : TEXT_TERTIARY,
                  lineHeight: 1,
                  textTransform: 'uppercase',
                  display: 'flex',
                  flexDirection: 'row',
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.value || 'N/A'}
                {stat.value && stat.unit && (
                  <span style={{ fontSize: 26, fontWeight: 700, textTransform: 'none', marginLeft: 2, alignSelf: 'flex-end', marginBottom: 4 }}>
                    {stat.unit}
                  </span>
                )}
              </span>
              {stat.sub && (
                <span style={{ fontFamily: 'monospace', fontSize: 16, color: TEXT_SECONDARY, display: 'flex', marginTop: 10 }}>
                  {stat.sub}
                </span>
              )}
              {stat.sub2 && (
                <span style={{ fontFamily: 'monospace', fontSize: 14, color: TEXT_TERTIARY, display: 'flex', marginTop: 4 }}>
                  {stat.sub2}
                </span>
              )}
            </div>
          ))}
        </div>

        {footnotes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 40px 10px 40px', gap: 2 }}>
            {footnotes.map(f => (
              <span key={f} style={{ fontFamily: 'monospace', fontSize: 14, color: AMBER, display: 'flex' }}>
                {f}
              </span>
            ))}
          </div>
        )}

        {/* FOOTER — ~50px */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            height: 50,
            padding: '0 40px',
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <span style={{ fontFamily: 'monospace', fontSize: 16, color: TEXT_TERTIARY, display: 'flex' }}>
            {sources}
          </span>
          <span
            style={{
              fontFamily: 'Inter, sans-serif',
              fontWeight: 800,
              fontSize: 24,
              color: AMBER,
              textTransform: 'uppercase',
              display: 'flex',
            }}
          >
            WHATCHANGED.US
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'Cache-Control': degraded ? CACHE_DEGRADED : CACHE_OK } },
  )
}
