import { ImageResponse } from 'next/og'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { estimateTariffCost, formatDollars } from '@/lib/tariff'
import { loadShareFonts } from '@/lib/share-card/fonts'
import { buildLineSparkline } from '@/lib/share-card/sparklines'

export const runtime = 'nodejs'

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
  const cpiData = snapshot.cpi.data
  const federalData = snapshot.federal.data
  const censusData = snapshot.census.data
  const gasData = snapshot.gas.data

  // Sparkline values
  const gasValues = gasData?.series?.map((p) => p.price) ?? []
  const groceriesValues = cpiData?.series?.map((p) => p.groceries) ?? []
  const shelterValues = (cpiData?.series ?? [])
    .map((p) => p.shelter)
    .filter((v): v is number => v !== null)

  // National comparison values
  const natCpi = snapshot.cpi.data?.nationalSeries
  const natCpiBaseline = natCpi?.find(p => p.date === '2025-01')
  const natCpiLatest = natCpi?.length ? natCpi[natCpi.length - 1] : undefined

  let natGroceriesChange: number | undefined
  if (natCpiBaseline && natCpiLatest) {
    const first = natCpiBaseline.groceries
    const last = natCpiLatest.groceries
    if (first != null && last != null && first !== 0) {
      natGroceriesChange = ((last - first) / first) * 100
    }
  }

  let natShelterChange: number | undefined
  if (natCpiBaseline && natCpiLatest) {
    const first = natCpiBaseline.shelter
    const last = natCpiLatest.shelter
    if (first != null && last != null && first !== 0) {
      natShelterChange = ((last - first) / first) * 100
    }
  }

  const natGas = gasData?.nationalSeries
  const natGasPrice = natGas?.length ? natGas[natGas.length - 1].price : undefined

  // Tariff estimate
  const tariffCost = censusData ? estimateTariffCost(censusData.medianIncome) : null

  // Month/year for header
  const now = new Date()
  const monthYear = now
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    .toUpperCase()

  // Design tokens
  const BG = '#0b0c0f'
  const SURFACE = '#12151a'
  const BORDER = 'rgba(255,255,255,0.07)'
  const TEXT = '#e8e4dc'
  const MUTED = 'rgba(232,228,220,0.38)'
  const AMBER = '#e8a020'
  const BLUE = '#4c9eff'
  const RED = '#f05050'
  const PURPLE = '#b78cff'

  // Sparklines
  const gasSparkline = gasData
    ? buildLineSparkline(gasValues, RED, 'grad-gas', {
        min: `$${Math.min(...gasValues).toFixed(2)}`,
        max: `$${Math.max(...gasValues).toFixed(2)}`,
      })
    : null
  const groceriesSparkline = cpiData
    ? buildLineSparkline(groceriesValues, AMBER, 'grad-groceries', {
        min: Math.min(...groceriesValues).toFixed(0),
        max: Math.max(...groceriesValues).toFixed(0),
      })
    : null
  const shelterSparkline = cpiData && shelterValues.length >= 2
    ? buildLineSparkline(shelterValues, BLUE, 'grad-shelter', {
        min: Math.min(...shelterValues).toFixed(0),
        max: Math.max(...shelterValues).toFixed(0),
      })
    : null
  // Metric cell builder
  const MetricCell = ({
    label,
    accentColor,
    pillBg,
    bigNumber,
    changePill,
    national,
    sparkline,
  }: {
    label: string
    accentColor: string
    pillBg: string
    bigNumber: string
    changePill: string | null
    national: string | null
    sparkline: React.ReactElement | null
  }) => (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: '10px',
        padding: '28px 26px 24px 32px',
        width: '50%',
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: '16px',
          bottom: '16px',
          width: '3px',
          borderRadius: '2px',
          backgroundColor: accentColor,
        }}
      />

      {/* Label */}
      <div
        style={{
          display: 'flex',
          fontFamily: 'DM Mono',
          fontSize: 14,
          color: MUTED,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          marginBottom: '6px',
        }}
      >
        {label}
      </div>

      {/* Sparkline */}
      {sparkline && (
        <div style={{ display: 'flex', width: '100%', height: 100, marginBottom: '12px' }}>
          {sparkline}
        </div>
      )}

      {/* Big number row */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontFamily: 'Bebas Neue',
            fontSize: 76,
            color: accentColor,
            lineHeight: 1,
          }}
        >
          {bigNumber}
        </div>
        {changePill && (
          <div
            style={{
              display: 'flex',
              backgroundColor: pillBg,
              borderRadius: '4px',
              padding: '2px 10px',
            }}
          >
            <span
              style={{
                fontFamily: 'Barlow Condensed',
                fontSize: 20,
                color: accentColor,
              }}
            >
              {changePill}
            </span>
          </div>
        )}
      </div>

      {/* Meta row */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: '6px',
        }}
      >
        <span
          style={{
            fontFamily: 'DM Mono',
            fontSize: 14,
            color: MUTED,
          }}
        >
          since Jan 2025
        </span>
        {national && (
          <span
            style={{
              fontFamily: 'DM Mono',
              fontSize: 14,
              color: MUTED,
              fontStyle: 'italic',
            }}
          >
            {national}
          </span>
        )}
      </div>
    </div>
  )

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
          padding: '44px 48px 36px',
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
            height: '4px',
            background: 'linear-gradient(90deg, #e8a020 0%, #4c9eff 50%, transparent 100%)',
            zIndex: 10,
          }}
        />

        {/* Header section */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '20px',
          }}
        >
          {/* Left side */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontFamily: 'DM Mono',
                fontSize: 18,
                color: AMBER,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              whatchanged.us · data report
            </span>
            <span
              style={{
                fontFamily: 'Bebas Neue',
                fontSize: 64,
                color: TEXT,
                lineHeight: 1.0,
                textTransform: 'uppercase',
              }}
            >
              {cityName.toUpperCase()}, {stateAbbr}
            </span>
            <span
              style={{
                fontFamily: 'DM Mono',
                fontSize: 18,
                color: MUTED,
              }}
            >
              ZIP {zip} · since Jan 20, 2025
            </span>
          </div>

          {/* Right side */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '8px',
            }}
          >
            <div
              style={{
                display: 'flex',
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: `1px solid ${BORDER}`,
                borderRadius: '6px',
                padding: '8px 16px',
              }}
            >
              <span
                style={{
                  fontFamily: 'DM Mono',
                  fontSize: 16,
                  color: MUTED,
                }}
              >
                {monthYear}
              </span>
            </div>
            <span
              style={{
                fontFamily: 'DM Mono',
                fontSize: 16,
                color: MUTED,
              }}
            >
              {cpiData?.metro ?? ''}
            </span>
          </div>
        </div>

        {/* Header separator */}
        <div
          style={{
            display: 'flex',
            height: '1px',
            backgroundColor: BORDER,
            marginBottom: '16px',
          }}
        />

        {/* 2x2 Metric Grid */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {/* Row 1 */}
          <div style={{ display: 'flex', flexDirection: 'row', gap: '12px' }}>
            {/* Top-left: Gas Prices */}
            <MetricCell
              label="Gas Prices"
              accentColor={RED}
              pillBg="rgba(240,80,80,0.15)"
              bigNumber={gasData ? `$${gasData.current.toFixed(2)}/gal` : 'N/A'}
              changePill={
                gasData ? `${gasData.change >= 0 ? '+' : ''}$${gasData.change.toFixed(2)}` : null
              }
              national={
                natGasPrice !== undefined ? `Natl: $${natGasPrice.toFixed(2)}` : null
              }
              sparkline={gasSparkline}
            />

            {/* Top-right: Groceries */}
            <MetricCell
              label="Groceries"
              accentColor={AMBER}
              pillBg="rgba(232,160,32,0.15)"
              bigNumber={cpiData ? `${formatSigned(cpiData.groceriesChange)}%` : 'N/A'}
              changePill={
                cpiData
                  ? cpiData.groceriesChange >= 0
                    ? '↑ rising'
                    : '↓ falling'
                  : null
              }
              national={
                natGroceriesChange !== undefined
                  ? `Natl: ${formatSigned(natGroceriesChange)}%`
                  : null
              }
              sparkline={groceriesSparkline}
            />
          </div>

          {/* Row 2 */}
          <div style={{ display: 'flex', flexDirection: 'row', gap: '12px' }}>
            {/* Bottom-left: Shelter */}
            <MetricCell
              label="Shelter"
              accentColor={BLUE}
              pillBg="rgba(76,158,255,0.15)"
              bigNumber={
                cpiData?.shelterChange !== undefined
                  ? `${formatSigned(cpiData.shelterChange)}%`
                  : 'N/A'
              }
              changePill={
                cpiData?.shelterChange !== undefined
                  ? cpiData.shelterChange >= 0
                    ? '↑ rising'
                    : '↓ falling'
                  : null
              }
              national={
                natShelterChange !== undefined
                  ? `Natl: ${formatSigned(natShelterChange)}%`
                  : null
              }
              sparkline={shelterSparkline}
            />

            {/* Bottom-right: Federal $ */}
            <MetricCell
              label="Federal $"
              accentColor={PURPLE}
              pillBg="rgba(183,140,255,0.15)"
              bigNumber={federalData ? formatFederalAmount(federalData.amountCut) : 'N/A'}
              changePill={federalData ? 'cut' : null}
              national={null}
              sparkline={null}
            />
          </div>
        </div>

        {/* Tariff Banner */}
        {tariffCost !== null && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              backgroundColor: SURFACE,
              borderTop: `1px solid ${BORDER}`,
              borderRadius: '10px',
              padding: '14px 24px',
              marginTop: '12px',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            {/* Left side */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                gap: '16px',
                alignItems: 'center',
              }}
            >
              {/* Icon box */}
              <div
                style={{
                  display: 'flex',
                  width: '48px',
                  height: '48px',
                  backgroundColor: 'rgba(232,160,32,0.12)',
                  border: '1px solid rgba(232,160,32,0.25)',
                  borderRadius: '8px',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ fontSize: 24 }}>🧾</span>
              </div>

              {/* Text stack */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span
                  style={{
                    fontFamily: 'DM Mono',
                    fontSize: 14,
                    color: MUTED,
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                  }}
                >
                  Est. Tariff Cost / Household / yr
                </span>
                <span
                  style={{
                    fontFamily: 'DM Mono',
                    fontSize: 12,
                    color: 'rgba(232,228,220,0.22)',
                  }}
                >
                  Source: Yale Budget Lab
                </span>
              </div>
            </div>

            {/* Right side */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
              }}
            >
              <span
                style={{
                  fontFamily: 'Bebas Neue',
                  fontSize: 52,
                  color: AMBER,
                }}
              >
                {formatDollars(tariffCost)}
              </span>
              <span
                style={{
                  fontFamily: 'DM Mono',
                  fontSize: 14,
                  color: MUTED,
                }}
              >
                per year · {cityName}
              </span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            backgroundColor: 'rgba(255,255,255,0.025)',
            borderTop: `1px solid ${BORDER}`,
            padding: '12px 24px',
            marginTop: '12px',
            borderRadius: '8px',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'DM Mono',
              fontSize: 13,
              color: 'rgba(232,228,220,0.3)',
            }}
          >
            BLS · EIA · USASpending · Census · Yale Budget Lab
          </span>
          <span
            style={{
              fontFamily: 'Bebas Neue',
              fontSize: 24,
              letterSpacing: '0.08em',
              color: AMBER,
              opacity: 0.7,
            }}
          >
            WHATCHANGED.US
          </span>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1080,
      fonts: await loadShareFonts(),
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    }
  )
}
