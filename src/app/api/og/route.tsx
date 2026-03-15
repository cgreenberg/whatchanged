import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const zip = searchParams.get('zip') ?? ''
  const location = searchParams.get('location') ?? ''
  const unemployment = searchParams.get('unemployment') ?? ''
  const unemploymentChange = searchParams.get('unemploymentChange') ?? ''
  const groceries = searchParams.get('groceries') ?? ''
  const federal = searchParams.get('federal') ?? ''

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
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '28px', color: '#A1A1AA' }}>
            📍 {location} ({zip})
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '40px', marginBottom: '40px' }}>
          {unemployment && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '18px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Unemployment
              </span>
              <span style={{ fontSize: '48px', fontWeight: 'bold', color: '#F59E0B' }}>
                {unemployment}
              </span>
              {unemploymentChange && (
                <span style={{ fontSize: '18px', color: '#EF4444' }}>
                  ↑ {unemploymentChange} since Jan 2025
                </span>
              )}
            </div>
          )}

          {groceries && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '18px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Groceries
              </span>
              <span style={{ fontSize: '48px', fontWeight: 'bold', color: '#EF4444' }}>
                +{groceries}
              </span>
              <span style={{ fontSize: '18px', color: '#EF4444' }}>
                since Jan 2025
              </span>
            </div>
          )}

          {federal && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '18px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Federal $ Cut
              </span>
              <span style={{ fontSize: '48px', fontWeight: 'bold', color: '#EF4444' }}>
                {federal}
              </span>
              <span style={{ fontSize: '18px', color: '#EF4444' }}>
                locally since Jan 20
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
