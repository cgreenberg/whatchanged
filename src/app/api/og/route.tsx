import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { estimateTariffCost, formatDollars } from '@/lib/tariff'
import { getCachedNationalData } from '@/lib/api/national'
import type { NationalDataPoint } from '@/lib/api/national'

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
  const padY = height * 0.05
  const usableHeight = height - 2 * padY

  return data.map((d, i) => {
    const x = (i / (data.length - 1)) * width
    const y = padY + usableHeight - ((d.value - min) / range) * usableHeight
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function buildAreaPath(data: NationalDataPoint[], width: number, height: number): string {
  if (data.length < 2) return '0,0'
  const sparkline = buildSparklinePath(data, width, height)
  return `0,${height} ${sparkline} ${width},${height}`
}

function computeDotY(series: NationalDataPoint[], index: number, height: number): number {
  if (series.length === 0) return height / 2
  const values = series.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const padY = height * 0.05
  const usableH = height - 2 * padY
  const idx = index < 0 ? series.length + index : index
  return padY + usableH - ((series[idx].value - min) / range) * usableH
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const zip = searchParams.get('zip') ?? ''

  // Try to fetch live data when zip is provided
  let location = searchParams.get('location') ?? ''
  let groceries = searchParams.get('groceries') ?? ''
  let shelter = ''
  let federal = searchParams.get('federal') ?? ''
  let tariff = ''
  let gasPrice = ''

  if (zip && /^\d{5}$/.test(zip)) {
    try {
      const snapshot = await fetchSnapshot(zip)
      if (snapshot) {
        if (!location) {
          const city = snapshot.location.cityName || snapshot.location.countyName
          location = `${city}, ${snapshot.location.stateAbbr}`
        }
        if (!groceries && snapshot.cpi.data) {
          groceries = `${snapshot.cpi.data.groceriesChange > 0 ? '+' : ''}${snapshot.cpi.data.groceriesChange.toFixed(1)}%`
        }
        if (snapshot.cpi.data?.shelterChange !== undefined) {
          shelter = `${snapshot.cpi.data.shelterChange > 0 ? '+' : ''}${snapshot.cpi.data.shelterChange.toFixed(1)}%`
        }
        if (!federal && snapshot.federal.data) {
          const amt = snapshot.federal.data.amountCut
          federal = amt >= 1_000_000_000
            ? `$${(amt / 1_000_000_000).toFixed(1)}B`
            : `$${(amt / 1_000_000).toFixed(1)}M`
        }
        if (snapshot.gas.data) {
          gasPrice = `$${snapshot.gas.data.current.toFixed(2)}/gal`
        }
        if (snapshot.census.data) {
          const cost = estimateTariffCost(snapshot.census.data.medianIncome)
          tariff = `~${formatDollars(cost)}/yr`
        }
      }
    } catch {
      // Fall through with whatever query params we have
    }
  }

  // Dynamic month/year for date range badge
  const monthYear = new Date()
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    .toUpperCase()

  // No zip or no location — show generic fallback card
  const hasData = location && (gasPrice || groceries || shelter || tariff)

  if (!hasData) {
    const national = await getCachedNationalData()

    // Format values for display
    const gasChange = national.gas.change >= 0
      ? `+$${national.gas.change.toFixed(2)}`
      : `-$${Math.abs(national.gas.change).toFixed(2)}`
    const grocChange = national.groceries.change >= 0
      ? `+${national.groceries.change.toFixed(1)}%`
      : `${national.groceries.change.toFixed(1)}%`
    const sheltChange = national.shelter.change >= 0
      ? `+${national.shelter.change.toFixed(1)}%`
      : `${national.shelter.change.toFixed(1)}%`
    const tariffAnnual = `~$${national.tariff.annualCost.toLocaleString()}/yr`

    // Sparkline dimensions per panel
    const sparkW = 320
    const sparkH = 120

    // Build SVG point strings
    const gasPoints = buildSparklinePath(national.gas.series, sparkW, sparkH)
    const gasArea = buildAreaPath(national.gas.series, sparkW, sparkH)
    const grocPoints = buildSparklinePath(national.groceries.series, sparkW, sparkH)
    const grocArea = buildAreaPath(national.groceries.series, sparkW, sparkH)
    const sheltPoints = buildSparklinePath(national.shelter.series, sparkW, sparkH)
    const sheltArea = buildAreaPath(national.shelter.series, sparkW, sparkH)

    // Date labels
    const latestMonth = new Date().toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).toUpperCase()

    const panels = [
      { label: 'GAS PRICES ($/GAL)', value: gasChange, color: RED, points: gasPoints, area: gasArea, startDotY: computeDotY(national.gas.series, 0, sparkH), endDotY: computeDotY(national.gas.series, -1, sparkH) },
      { label: 'GROCERIES (CPI)', value: grocChange, color: AMBER, points: grocPoints, area: grocArea, startDotY: computeDotY(national.groceries.series, 0, sparkH), endDotY: computeDotY(national.groceries.series, -1, sparkH) },
      { label: 'SHELTER (RENT & EQUIV.)', value: sheltChange, color: BLUE, points: sheltPoints, area: sheltArea, startDotY: computeDotY(national.shelter.series, 0, sparkH), endDotY: computeDotY(national.shelter.series, -1, sparkH) },
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
                fontFamily: 'monospace',
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
                fontFamily: 'Inter, sans-serif',
                fontWeight: 800,
                fontSize: 48,
                color: TEXT_PRIMARY,
                lineHeight: 1.1,
                display: 'flex',
                marginBottom: 6,
              }}
            >
              COST OF LIVING SINCE JAN. 20, 2025
            </span>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: 15,
                color: '#777',
                display: 'flex',
              }}
            >
              national averages · enter your zip for your city
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
                    fontFamily: 'monospace',
                    fontSize: 13,
                    color: TEXT_SECONDARY,
                    letterSpacing: '0.1em',
                    display: 'flex',
                    marginBottom: 4,
                  }}
                >
                  {panel.label}
                </span>
                {/* Big number */}
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 800,
                    fontSize: 56,
                    color: panel.color,
                    lineHeight: 1,
                    display: 'flex',
                    marginBottom: 8,
                  }}
                >
                  {panel.value}
                </span>
                {/* Sparkline SVG */}
                <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
                  <svg
                    viewBox={`0 0 ${sparkW} ${sparkH}`}
                    width={sparkW}
                    height={sparkH}
                    style={{ display: 'flex' }}
                  >
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
                    <circle cx="0" cy={panel.startDotY.toFixed(1)} r="4" fill={panel.color} />
                    <circle cx={sparkW.toString()} cy={panel.endDotY.toFixed(1)} r="4" fill={panel.color} />
                  </svg>
                </div>
                {/* Date labels */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginTop: 4,
                  }}
                >
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#555', display: 'flex' }}>
                    {"JAN '25"}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#555', display: 'flex' }}>
                    {latestMonth}
                  </span>
                </div>
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
                  fontFamily: 'monospace',
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
                    fontSize: 38,
                    color: PURPLE,
                    display: 'flex',
                  }}
                >
                  {tariffAnnual}
                </span>
                <span
                  style={{
                    fontFamily: 'monospace',
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
                fontFamily: 'Inter, sans-serif',
                fontWeight: 800,
                fontSize: 20,
                color: AMBER,
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
            <span style={{ fontFamily: 'monospace', fontSize: 14, color: '#444', display: 'flex' }}>
              BLS · EIA · Census · Yale Budget Lab
            </span>
          </div>
        </div>
      ),
      { width: 1200, height: 630 },
    )
  }

  // ── Stats data for the four cards ───────────────────────────────────
  const stats = [
    { label: 'GAS PRICES', value: gasPrice, color: RED },
    { label: 'GROCERIES', value: groceries, color: AMBER },
    { label: 'SHELTER', value: shelter, color: BLUE },
    { label: 'TARIFF IMPACT', value: tariff, color: PURPLE },
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
              JAN. 20, 2025
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
                }}
              >
                {stat.value || 'N/A'}
              </span>
            </div>
          ))}
        </div>

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
            BLS · EIA · Census · Yale Budget Lab
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
    { width: 1200, height: 630 },
  )
}
