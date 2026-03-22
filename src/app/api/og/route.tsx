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
  let unemployment = searchParams.get('unemployment') ?? ''
  let unemploymentChange = searchParams.get('unemploymentChange') ?? ''
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
        if (!unemployment && snapshot.unemployment.data) {
          unemployment = `${snapshot.unemployment.data.current}%`
          unemploymentChange = `${snapshot.unemployment.data.change > 0 ? '+' : ''}${snapshot.unemployment.data.change} pts`
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
        {/* Location */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
          <span style={{ fontSize: '32px', color: '#F5F5F5', fontWeight: 'bold' }}>
            What Changed in {location}?
          </span>
        </div>
        <div style={{ display: 'flex', marginBottom: '32px' }}>
          <span style={{ fontSize: '20px', color: '#A1A1AA' }}>
            Since January 2025 · Zip {zip}
          </span>
        </div>

        {/* Stats grid - 2 rows of 3 */}
        <div style={{ display: 'flex', gap: '40px', marginBottom: '24px' }}>
          {gasPrice && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '16px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
                Gas Prices
              </span>
              <span style={{ fontSize: '42px', fontWeight: 'bold', color: '#F59E0B' }}>
                {gasPrice}
              </span>
            </div>
          )}

          {tariff && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '16px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
                Tariff Impact
              </span>
              <span style={{ fontSize: '42px', fontWeight: 'bold', color: '#A855F7' }}>
                {tariff}
              </span>
            </div>
          )}

          {shelter && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '16px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
                Housing Costs
              </span>
              <span style={{ fontSize: '42px', fontWeight: 'bold', color: '#3B82F6' }}>
                {shelter}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '40px', marginBottom: '24px' }}>
          {groceries && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '16px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
                Grocery Prices
              </span>
              <span style={{ fontSize: '42px', fontWeight: 'bold', color: '#EF4444' }}>
                {groceries}
              </span>
            </div>
          )}

          {unemployment && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '16px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
                Unemployment
              </span>
              <span style={{ fontSize: '42px', fontWeight: 'bold', color: '#F59E0B' }}>
                {unemployment}
              </span>
              {unemploymentChange && (
                <span style={{ fontSize: '16px', color: '#A1A1AA' }}>
                  {unemploymentChange} since Jan 2025
                </span>
              )}
            </div>
          )}

          {federal && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: '16px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
                Federal $ Cut
              </span>
              <span style={{ fontSize: '42px', fontWeight: 'bold', color: '#EF4444' }}>
                {federal}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', marginTop: 'auto' }}>
          <span style={{ fontSize: '22px', color: '#6B7280' }}>
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
