import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { estimateTariffCost, formatDollars } from '@/lib/tariff'

export const runtime = 'nodejs'

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

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px',
          backgroundColor: '#0A0A0A',
          color: '#F5F5F5',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '48px', color: '#F5F5F5', fontWeight: 'bold' }}>
            What changed in {location} since Jan 2025?
          </span>
        </div>

        {/* Stats - row 1 */}
        <div style={{ display: 'flex', gap: '40px', marginBottom: '28px' }}>
          {gasPrice && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '26px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 'bold', marginBottom: '4px' }}>
                Gas Prices
              </span>
              <span style={{ fontSize: '64px', fontWeight: 'bold', color: '#F59E0B' }}>
                {gasPrice}
              </span>
            </div>
          )}

          {tariff && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '26px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 'bold', marginBottom: '4px' }}>
                Tariff Impact
              </span>
              <span style={{ fontSize: '64px', fontWeight: 'bold', color: '#A855F7' }}>
                {tariff}
              </span>
            </div>
          )}

          {shelter && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '26px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 'bold', marginBottom: '4px' }}>
                Housing Costs
              </span>
              <span style={{ fontSize: '64px', fontWeight: 'bold', color: '#3B82F6' }}>
                {shelter}
              </span>
            </div>
          )}
        </div>

        {/* Stats - row 2 */}
        <div style={{ display: 'flex', gap: '40px', marginBottom: '28px' }}>
          {groceries && (
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: '300px' }}>
              <span style={{ fontSize: '26px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 'bold', marginBottom: '4px' }}>
                Grocery Prices
              </span>
              <span style={{ fontSize: '64px', fontWeight: 'bold', color: '#EF4444' }}>
                {groceries}
              </span>
            </div>
          )}

          {federal && (
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: '300px' }}>
              <span style={{ fontSize: '26px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 'bold', marginBottom: '4px' }}>
                Federal $ Cut
              </span>
              <span style={{ fontSize: '64px', fontWeight: 'bold', color: '#EF4444' }}>
                {federal}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', marginTop: 'auto' }}>
          <span style={{ fontSize: '24px', color: '#6B7280' }}>
            whatchanged.us — enter your zip
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
