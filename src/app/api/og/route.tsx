import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { estimateTariffCost, formatDollars } from '@/lib/tariff'

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

          {/* Centered content */}
          <div
            style={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 80px',
            }}
          >
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: 18,
                color: AMBER,
                letterSpacing: '0.14em',
                display: 'flex',
                marginBottom: 24,
              }}
            >
              WHATCHANGED.US
            </span>
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontWeight: 800,
                fontSize: 56,
                color: TEXT_PRIMARY,
                textTransform: 'uppercase',
                textAlign: 'center',
                display: 'flex',
              }}
            >
              ENTER YOUR ZIP CODE
            </span>
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 24,
                color: TEXT_SECONDARY,
                marginTop: 16,
                display: 'flex',
              }}
            >
              See what changed since Jan. 20, 2025
            </span>
          </div>

          {/* Footer */}
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
