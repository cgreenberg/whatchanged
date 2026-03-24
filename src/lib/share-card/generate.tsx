import React from 'react'
import { ImageResponse } from 'next/og'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { estimateTariffCost, formatDollars } from '@/lib/tariff'
import { loadShareFonts } from '@/lib/share-card/fonts'
import { buildLineSparklineV3, buildTariffBarChart } from '@/lib/share-card/sparklines'

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
  [AMBER]:  '240,165,0',
  [BLUE]:   '61,158,255',
  [PURPLE]: '168,126,255',
  [RED]:    '240,64,64',
}

// ── Helpers ───────────────────────────────────────────────────────
function formatSigned(value: number, decimals = 1, suffix = ''): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}${suffix}`
}

function getMonthLabel(series: Array<{ date: string }>, idx: number): string {
  const d = series[idx]?.date // "2025-01" format
  if (!d) return ''
  const [year, month] = d.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month, 10) - 1] || ''} '${year.slice(2)}`
}

// ── Main Export ───────────────────────────────────────────────────
export async function generateShareCard(zip: string): Promise<Response> {
  const snapshot = await fetchSnapshot(zip)
  if (!snapshot) {
    return new Response('Zip code not found', { status: 404 })
  }

  const { location } = snapshot
  const cityName = location.cityName || location.countyName
  const stateAbbr = location.stateAbbr

  // Extract data fields with null guards
  const cpiData = snapshot.cpi.data
  const censusData = snapshot.census.data
  const gasData = snapshot.gas.data

  // Month/year for header date badge
  const now = new Date()
  const monthYear = now
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    .toUpperCase()

  // ── Tariff Estimate ──────────────────────────────────────────────
  const tariffCost = censusData ? estimateTariffCost(censusData.medianIncome) : 0

  // ── National Comparison ─────────────────────────────────────────
  const natCpi = cpiData?.nationalSeries
  const natBaseline = natCpi?.find((p) => p.date === '2025-01')
  const natLatest = natCpi?.length ? natCpi[natCpi.length - 1] : undefined

  let natGroceriesChange: number | undefined
  let natShelterChange: number | undefined
  if (natBaseline && natLatest) {
    const g0 = natBaseline.groceries
    const g1 = natLatest.groceries
    if (g0 && g1 && g0 !== 0) natGroceriesChange = ((g1 - g0) / g0) * 100
    const s0 = natBaseline.shelter
    const s1 = natLatest.shelter
    if (s0 && s1 && s0 !== 0) natShelterChange = ((s1 - s0) / s0) * 100
  }

  const natGas = gasData?.nationalSeries
  const natGasPrice = natGas?.length ? natGas[natGas.length - 1].price : undefined

  // ── Gas Sparkline Data ───────────────────────────────────────────
  // Filter to Jan 2025+ for sparkline to match hero number baseline
  const gasSeries = (gasData?.series ?? []).filter(p => p.date >= '2025-01')
  const gasValues = gasSeries.map((p) => p.price)
  const gasMin = gasValues.length ? Math.min(...gasValues) : 0
  const gasMax = gasValues.length ? Math.max(...gasValues) : 0
  const gasMid = (gasMin + gasMax) / 2
  const gasXLeft = getMonthLabel(gasSeries, 0)
  const gasXMid = getMonthLabel(gasSeries, Math.floor(gasSeries.length / 2))
  const gasXRight = getMonthLabel(gasSeries, gasSeries.length - 1)

  // ── Grocery Sparkline Data ───────────────────────────────────────
  // Filter to Jan 2025+ for sparkline (series may start from 2020)
  const grocerySeries = (cpiData?.series ?? []).filter(p => p.date >= '2025-01')
  const groceryRaw = grocerySeries.map((p) => p.groceries)
  const groceryBase = (groceryRaw[0] !== undefined && groceryRaw[0] !== 0) ? groceryRaw[0] : 1
  const groceryValues = groceryRaw.map((v) => ((v - groceryBase) / groceryBase) * 100)
  const groceryMin = groceryValues.length ? Math.min(...groceryValues) : 0
  const groceryMax = groceryValues.length ? Math.max(...groceryValues) : 0
  const groceryMid = (groceryMin + groceryMax) / 2
  // Use the filtered series for x-axis labels
  const cpiXLeft = getMonthLabel(grocerySeries, 0)
  const cpiXMid = getMonthLabel(grocerySeries, Math.floor(grocerySeries.length / 2))
  const cpiXRight = getMonthLabel(grocerySeries, grocerySeries.length - 1)

  // ── Shelter Sparkline Data (filtered for null, date-aligned) ─────
  // Filter to Jan 2025+ AND non-null shelter values for sparkline
  const shelterPairs = (cpiData?.series ?? [])
    .filter((p) => p.date >= '2025-01' && p.shelter !== null)
    .map((p) => ({ date: p.date, value: p.shelter as number }))
  const shelterBase = (shelterPairs[0]?.value !== undefined && shelterPairs[0].value !== 0) ? shelterPairs[0].value : 1
  const shelterValues = shelterPairs.map((p) => ((p.value - shelterBase) / shelterBase) * 100)
  const shelterMin = shelterValues.length ? Math.min(...shelterValues) : 0
  const shelterMax = shelterValues.length ? Math.max(...shelterValues) : 0
  const shelterMid = (shelterMin + shelterMax) / 2
  const shelterXLeft = getMonthLabel(shelterPairs, 0)
  const shelterXMid = getMonthLabel(shelterPairs, Math.floor(shelterPairs.length / 2))
  const shelterXRight = getMonthLabel(shelterPairs, shelterPairs.length - 1)

  // ── Build Sparklines ─────────────────────────────────────────────
  const gasSparkline =
    gasValues.length >= 2
      ? buildLineSparklineV3(gasValues, RED, 'grad-gas', {
          yMin: `$${gasMin.toFixed(2)}`,
          yMid: `$${gasMid.toFixed(2)}`,
          yMax: `$${gasMax.toFixed(2)}`,
          xLeft: gasXLeft,
          xMid: gasXMid,
          xRight: gasXRight,
        })
      : null

  const groceryPadded = groceryValues.length >= 2
    ? { min: groceryMin - Math.abs(groceryMax - groceryMin) * 0.10, max: groceryMax + Math.abs(groceryMax - groceryMin) * 0.05 }
    : undefined

  const grocerySparkline =
    groceryValues.length >= 2
      ? buildLineSparklineV3(groceryValues, AMBER, 'grad-groceries', {
          yMin: `${groceryMin.toFixed(1)}%`,
          yMid: `${groceryMid.toFixed(1)}%`,
          yMax: `${groceryMax.toFixed(1)}%`,
          xLeft: cpiXLeft,
          xMid: cpiXMid,
          xRight: cpiXRight,
          bounds: groceryPadded,
        })
      : null

  const shelterPadded = shelterValues.length >= 2
    ? { min: shelterMin - Math.abs(shelterMax - shelterMin) * 0.10, max: shelterMax + Math.abs(shelterMax - shelterMin) * 0.05 }
    : undefined

  const shelterSparkline =
    shelterValues.length >= 2
      ? buildLineSparklineV3(shelterValues, BLUE, 'grad-shelter', {
          yMin: `${shelterMin.toFixed(1)}%`,
          yMid: `${shelterMid.toFixed(1)}%`,
          yMax: `${shelterMax.toFixed(1)}%`,
          xLeft: shelterXLeft,
          xMid: shelterXMid,
          xRight: shelterXRight,
          bounds: shelterPadded,
        })
      : null

  const tariffSparkline = tariffCost > 0
    ? buildTariffBarChart(tariffCost, PURPLE, 'grad-tariff')
    : null

  // ── Inline cell helpers (avoid named components in Satori render tree) ──
  const accentStrip = (accent: string) => (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0,
      width: 3, backgroundColor: accent, display: 'flex',
    }} />
  )

  const sectionLabel = (label: string, sublabel: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12 }}>
      <span style={{ fontFamily: 'DM Mono', fontSize: 28, color: TEXT_SECONDARY, display: 'flex', letterSpacing: '0.10em' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'DM Mono', fontSize: 24, color: TEXT_TERTIARY, display: 'flex' }}>
        {sublabel}
      </span>
    </div>
  )

  const bigNumber = (value: string, accent: string) => (
    <span style={{ fontFamily: 'Bebas Neue', fontSize: 108, color: accent, lineHeight: 1, display: 'flex' }}>
      {value}
    </span>
  )

  const changePill = (text: string, accent: string) => {
    const rgb = ACCENT_RGB[accent] ?? '255,255,255'
    return (
      <div style={{
        display: 'flex',
        backgroundColor: `rgba(${rgb}, 0.22)`,
        border: `1.5px solid rgba(${rgb}, 0.55)`,
        borderRadius: 4,
        padding: '8px 18px',
        alignSelf: 'flex-end',
        marginLeft: 12,
        marginBottom: 16,
      }}>
        <span style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 32, color: accent, display: 'flex' }}>
          {text}
        </span>
      </div>
    )
  }

  const metaRow = (left: string, right: string | null) => (
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
      <span style={{ fontFamily: 'DM Mono', fontSize: 26, color: TEXT_SECONDARY, display: 'flex' }}>
        {left}
      </span>
      {right && (
        <span style={{ fontFamily: 'DM Mono', fontSize: 26, color: TEXT_SECONDARY, display: 'flex', fontStyle: 'italic' }}>
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

      {/* HEADER — 120px */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          height: 120,
          padding: '20px 40px 0 40px',
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
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
              fontSize: 88,
              color: TEXT_PRIMARY,
              lineHeight: 1,
            }}
          >
            {cityName.toUpperCase()}, {stateAbbr}
          </span>
        </div>

        {/* Right column */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            paddingTop: 4,
            gap: 6,
          }}
        >
          {/* Date badge */}
          <div
            style={{
              display: 'flex',
              border: `1px solid ${BORDER}`,
              borderRadius: 4,
              padding: '4px 14px',
            }}
          >
            <span
              style={{
                display: 'flex',
                fontFamily: 'DM Mono',
                fontSize: 26,
                color: TEXT_SECONDARY,
              }}
            >
              {monthYear}
            </span>
          </div>
          {/* Metro name */}
          <span
            style={{
              display: 'flex',
              fontFamily: 'DM Mono',
              fontSize: 26,
              color: TEXT_SECONDARY,
            }}
          >
            {cpiData?.metro ?? ''}
          </span>
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
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, position: 'relative',
                         padding: '28px 28px 24px 36px', overflow: 'hidden',
                         borderRight: `1px solid ${BORDER}` }}>
            {accentStrip(RED)}
            {sectionLabel('GAS PRICES', '(regular unleaded, $/gal)')}
            {gasSparkline && <div style={{ display: 'flex', width: '100%', marginBottom: 8 }}>{gasSparkline}</div>}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' }}>
              {bigNumber(gasData ? `$${gasData.current.toFixed(2)}/gal` : 'N/A', RED)}
              {changePill(gasData ? `${gasData.change >= 0 ? '+' : ''}$${gasData.change.toFixed(2)}` : '—', RED)}
            </div>
            {metaRow('since Jan 2025', natGasPrice != null ? `Natl: $${natGasPrice.toFixed(2)}` : null)}
          </div>

          {/* Cell: Groceries */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, position: 'relative',
                         padding: '28px 28px 24px 36px', overflow: 'hidden' }}>
            {accentStrip(AMBER)}
            {sectionLabel('GROCERIES', '(CPI: food at home)')}
            {grocerySparkline && <div style={{ display: 'flex', width: '100%', marginBottom: 8 }}>{grocerySparkline}</div>}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' }}>
              {bigNumber(cpiData ? `${formatSigned(cpiData.groceriesChange)}%` : 'N/A', AMBER)}
              {changePill(cpiData ? (cpiData.groceriesChange >= 0 ? '↑ rising' : '↓ falling') : '—', AMBER)}
            </div>
            {metaRow('since Jan 2025', natGroceriesChange !== undefined ? `Natl: ${formatSigned(natGroceriesChange)}%` : null)}
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
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, position: 'relative',
                         padding: '28px 28px 24px 36px', overflow: 'hidden',
                         borderRight: `1px solid ${BORDER}` }}>
            {accentStrip(BLUE)}
            {sectionLabel('SHELTER', "(rent & owners' equiv.)")}
            {shelterSparkline && <div style={{ display: 'flex', width: '100%', marginBottom: 8 }}>{shelterSparkline}</div>}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' }}>
              {bigNumber(cpiData?.shelterChange !== undefined ? `${formatSigned(cpiData.shelterChange)}%` : 'N/A', BLUE)}
              {changePill(cpiData?.shelterChange !== undefined ? (cpiData.shelterChange >= 0 ? '↑ rising' : '↓ falling') : '—', BLUE)}
            </div>
            {metaRow('since Jan 2025', natShelterChange !== undefined ? `Natl: ${formatSigned(natShelterChange)}%` : null)}
          </div>

          {/* Cell: Tariffs */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, position: 'relative',
                         padding: '28px 28px 24px 36px', overflow: 'hidden' }}>
            {accentStrip(PURPLE)}
            {sectionLabel('TARIFFS', '(est. cumulative cost to household)')}
            {tariffSparkline && <div style={{ display: 'flex', width: '100%', marginBottom: 8 }}>{tariffSparkline}</div>}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
                <span style={{ fontFamily: 'Bebas Neue', fontSize: 96, color: PURPLE, lineHeight: 1, display: 'flex' }}>
                  {tariffCost > 0 ? `~${formatDollars(tariffCost)}` : 'N/A'}
                </span>
                {tariffCost > 0 && (
                  <span style={{ fontFamily: 'Bebas Neue', fontSize: 48, color: PURPLE, opacity: 0.75, display: 'flex', alignSelf: 'flex-end', marginBottom: 8 }}>
                    /yr
                  </span>
                )}
              </div>
              {changePill('2.05% rate', PURPLE)}
            </div>
            {metaRow('est. annual household cost', 'Yale Budget Lab')}
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
          BLS · EIA · Census · Yale Budget Lab
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
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
  })
}
