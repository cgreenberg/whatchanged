import { ImageResponse } from 'next/og'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { estimateTariffCost, formatDollars } from '@/lib/tariff'

export const runtime = 'nodejs'

// Build a sparkline polyline points string from an array of numbers.
// Normalizes values to fit within width x height.
function buildSparklinePoints(values: number[], width = 200, height = 60): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// Format a federal dollar amount as -$4.2M or -$1.2B
// amount is amountCut: positive = money cut (lost), negative = money gained
function formatFederalAmount(amount: number): string {
  if (amount === 0) return '$0'
  const prefix = amount > 0 ? '-$' : '+$'
  const abs = Math.abs(amount)
  if (abs >= 1_000_000_000) {
    return `${prefix}${(abs / 1_000_000_000).toFixed(1)}B`
  }
  if (abs >= 1_000_000) {
    return `${prefix}${(abs / 1_000_000).toFixed(1)}M`
  }
  if (abs >= 1_000) {
    return `${prefix}${(abs / 1_000).toFixed(0)}K`
  }
  return `${prefix}${abs.toFixed(0)}`
}

// Format a signed number with a + or - prefix and specified decimal places
function formatSigned(value: number, decimals = 1, suffix = ''): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}${suffix}`
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ zip: string }> }
) {
  const { zip } = await params

  if (!/^\d{5}$/.test(zip)) {
    return new Response('Invalid zip code', { status: 400 })
  }

  const snapshot = await fetchSnapshot(zip)
  if (!snapshot) {
    return new Response('Zip code not found', { status: 404 })
  }

  const { location } = snapshot
  const cityName = location.cityName || location.countyName
  const stateAbbr = location.stateAbbr

  // Extract data fields with null guards
  const unemploymentData = snapshot.unemployment.data
  const cpiData = snapshot.cpi.data
  const federalData = snapshot.federal.data
  const censusData = snapshot.census.data

  // Sparkline values
  const unemploymentValues = unemploymentData?.series?.map((p) => p.rate) ?? []
  const groceriesValues = cpiData?.series?.map((p) => p.groceries) ?? []
  const shelterValues = (cpiData?.series ?? [])
    .map((p) => p.shelter)
    .filter((v): v is number => v !== null)

  // Tariff estimate
  const tariffCost = censusData ? estimateTariffCost(censusData.medianIncome) : null

  // Month/year for header
  const now = new Date()
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()

  // Colors
  const BG = '#0c0b09'
  const PANEL_BG = '#141210'
  const PANEL_BORDER = '#2a241c'
  const TEXT = '#f0ebe0'
  const MUTED = '#8a7a65'
  const RULE_COLOR = '#2a241c'

  const ACCENT_UNEMPLOYMENT = '#e8533a'
  const ACCENT_GROCERIES = '#e8a030'
  const ACCENT_SHELTER = '#5ba8e8'
  const ACCENT_FEDERAL = '#a070e8'

  // Panel renderer helper (returns JSX-compatible object notation for ImageResponse)
  // Since ImageResponse uses React JSX at runtime, we build the structure inline below.

  const panelStyle = {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    backgroundColor: PANEL_BG,
    border: `1px solid ${PANEL_BORDER}`,
    borderRadius: '12px',
    padding: '24px',
    flex: 1,
    minWidth: 0,
  }

  const labelStyle = {
    fontSize: 14,
    color: MUTED,
    fontFamily: 'sans-serif',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    marginBottom: '8px',
  }

  const bigNumStyle = (accent: string) => ({
    fontSize: 44,
    fontWeight: 'bold',
    color: accent,
    fontFamily: 'Georgia, serif',
    lineHeight: 1,
  })

  const changeStyle = (accent: string) => ({
    fontSize: 18,
    color: accent,
    fontFamily: 'sans-serif',
    marginTop: '6px',
  })

  // Build sparkline SVG string inline (Satori supports SVG as JSX)
  const SparklineSvg = ({ points, accent }: { points: string; accent: string }) => {
    if (!points) return null as unknown as React.ReactElement
    return (
      <svg
        viewBox="0 0 200 60"
        style={{ width: '100%', height: '48px', marginBottom: '8px' }}
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          stroke={accent}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) as unknown as React.ReactElement
  }

  const unemploymentPoints = buildSparklinePoints(unemploymentValues)
  const groceriesPoints = buildSparklinePoints(groceriesValues)
  const shelterPoints = buildSparklinePoints(shelterValues)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: BG,
          color: TEXT,
          padding: '48px 52px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: 16, color: MUTED, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Data Report
          </span>
          <span style={{ fontSize: 16, color: MUTED, letterSpacing: '0.12em' }}>
            {monthYear}
          </span>
        </div>

        {/* Thin rule */}
        <div style={{ display: 'flex', height: '1px', backgroundColor: RULE_COLOR, marginBottom: '32px' }} />

        {/* Title block */}
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '24px' }}>
          <span style={{ fontSize: 60, fontWeight: 'bold', color: TEXT, fontFamily: 'Georgia, serif', lineHeight: 1.1 }}>
            What Changed
          </span>
          <span style={{ fontSize: 60, fontWeight: 'bold', color: TEXT, fontFamily: 'Georgia, serif', lineHeight: 1.1 }}>
            in {cityName}, {stateAbbr}
          </span>
          <span style={{ fontSize: 60, fontWeight: 'bold', color: TEXT, fontFamily: 'Georgia, serif', lineHeight: 1.1 }}>
            since Jan 20, 2025
          </span>
        </div>

        {/* Zip tag + metro */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
          <div
            style={{
              display: 'flex',
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: '999px',
              padding: '4px 14px',
              fontSize: 14,
              color: MUTED,
              letterSpacing: '0.06em',
            }}
          >
            ZIP {zip}
          </div>
          {cpiData?.metro && (
            <span style={{ fontSize: 14, color: MUTED }}>
              {cpiData.metro}
            </span>
          )}
        </div>

        {/* 2x2 metric panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
          {/* Row 1 */}
          <div style={{ display: 'flex', gap: '16px', flex: 1 }}>
            {/* Panel 1: Unemployment */}
            <div style={panelStyle}>
              <span style={labelStyle}>Unemployment</span>
              {unemploymentPoints && (
                <SparklineSvg points={unemploymentPoints} accent={ACCENT_UNEMPLOYMENT} />
              )}
              <span style={bigNumStyle(ACCENT_UNEMPLOYMENT)}>
                {unemploymentData ? `${unemploymentData.current.toFixed(1)}%` : 'N/A'}
              </span>
              {unemploymentData && (
                <span style={changeStyle(ACCENT_UNEMPLOYMENT)}>
                  {formatSigned(unemploymentData.change, 1, ' pts')}
                </span>
              )}
            </div>

            {/* Panel 2: Groceries */}
            <div style={panelStyle}>
              <span style={labelStyle}>Groceries</span>
              {groceriesPoints && (
                <SparklineSvg points={groceriesPoints} accent={ACCENT_GROCERIES} />
              )}
              <span style={bigNumStyle(ACCENT_GROCERIES)}>
                {cpiData ? `${formatSigned(cpiData.groceriesChange)}%` : 'N/A'}
              </span>
              {cpiData && (
                <span style={changeStyle(ACCENT_GROCERIES)}>
                  since Jan 2025
                </span>
              )}
            </div>
          </div>

          {/* Row 2 */}
          <div style={{ display: 'flex', gap: '16px', flex: 1 }}>
            {/* Panel 3: Shelter */}
            <div style={panelStyle}>
              <span style={labelStyle}>Shelter</span>
              {shelterPoints && (
                <SparklineSvg points={shelterPoints} accent={ACCENT_SHELTER} />
              )}
              <span style={bigNumStyle(ACCENT_SHELTER)}>
                {cpiData?.shelterChange !== undefined ? `${formatSigned(cpiData.shelterChange)}%` : 'N/A'}
              </span>
              {cpiData?.shelterChange !== undefined && (
                <span style={changeStyle(ACCENT_SHELTER)}>
                  since Jan 2025
                </span>
              )}
            </div>

            {/* Panel 4: Federal Spending */}
            <div style={panelStyle}>
              <span style={labelStyle}>Federal $</span>
              {/* No sparkline for federal — no time series data */}
              <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
                <span style={bigNumStyle(ACCENT_FEDERAL)}>
                  {federalData ? formatFederalAmount(federalData.amountCut) : 'N/A'}
                </span>
              </div>
              {federalData && (
                <span style={changeStyle(ACCENT_FEDERAL)}>
                  cut since Jan 20, 2025
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tariff callout (if census data available) */}
        {tariffCost !== null && (
          <div
            style={{
              display: 'flex',
              marginTop: '16px',
              backgroundColor: PANEL_BG,
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: '12px',
              padding: '16px 24px',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 14, color: MUTED }}>
              Est. tariff cost (Yale Budget Lab)
            </span>
            <span style={{ fontSize: 24, fontWeight: 'bold', color: TEXT, fontFamily: 'Georgia, serif' }}>
              ~{formatDollars(tariffCost)}/yr
            </span>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: '20px' }}>
          <div style={{ display: 'flex', height: '1px', backgroundColor: RULE_COLOR, marginBottom: '16px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <span style={{ fontSize: 13, color: MUTED }}>
              BLS · EIA · USASpending · Census
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
              <span style={{ fontSize: 15, color: TEXT, fontWeight: 'bold' }}>
                whatchanged.us
              </span>
              <span style={{ fontSize: 13, color: ACCENT_GROCERIES, letterSpacing: '0.05em' }}>
                CHECK YOUR ZIP ↗
              </span>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    }
  )
}
