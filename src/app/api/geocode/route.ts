import { NextRequest } from 'next/server'
import { isValidZip } from '@/lib/data/zip-lookup'

const NO_STORE = { 'Cache-Control': 'no-store' }
// A coordinate → zip answer is stable; cache at the edge but never per-user data.
const CACHEABLE = { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=86400' }

/** Parse a coordinate: finite number within [min, max], else null. */
function coord(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw.trim() === '' || raw.length > 32) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

export async function GET(req: NextRequest) {
  const lat = coord(req.nextUrl.searchParams.get('lat'), -90, 90)
  const lng = coord(req.nextUrl.searchParams.get('lng'), -180, 180)

  if (lat === null || lng === null) {
    return Response.json({ zip: null }, { status: 400, headers: NO_STORE })
  }

  // Canonical 4-decimal coordinates (~11 m): arbitrary-precision variants of
  // the same spot redirect to one CDN-cached URL instead of each costing an
  // upstream Census call.
  const latR = String(Number(lat.toFixed(4)))
  const lngR = String(Number(lng.toFixed(4)))
  if (req.nextUrl.searchParams.get('lat') !== latR || req.nextUrl.searchParams.get('lng') !== lngR || req.nextUrl.searchParams.size !== 2) {
    const canonical = new URL(req.nextUrl.pathname, req.nextUrl.origin)
    canonical.searchParams.set('lat', latR)
    canonical.searchParams.set('lng', lngR)
    // The redirect is deterministic in the query, so the CDN can cache it too
    return new Response(null, {
      status: 308,
      headers: { Location: canonical.toString(), 'Cache-Control': 'public, s-maxage=86400' },
    })
  }

  const params = new URLSearchParams({
    x: lngR,
    y: latR,
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: '2020 Census ZIP Code Tabulation Areas,2010 Census ZIP Code Tabulation Areas',
    format: 'json',
  })
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${params.toString()}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return Response.json({ zip: null }, { headers: NO_STORE })

    const data = await res.json()
    const geos = data?.result?.geographies

    const zcta2020 = geos?.['2020 Census ZIP Code Tabulation Areas']?.[0]
    const zcta2010 = geos?.['2010 Census ZIP Code Tabulation Areas']?.[0]
    const candidates = [
      zcta2020?.ZCTA5,
      zcta2020?.ZCTA5CE20,
      zcta2010?.ZCTA5,
      zcta2010?.ZCTA5CE10,
    ]

    // Only return a zip the site can actually look up (a 2010-only ZCTA may
    // no longer exist in zip-county.json).
    for (const zip of candidates) {
      if (typeof zip === 'string' && /^\d{5}$/.test(zip) && isValidZip(zip)) {
        return Response.json({ zip }, { headers: CACHEABLE })
      }
    }

    return Response.json({ zip: null }, { headers: CACHEABLE })
  } catch {
    return Response.json({ zip: null }, { headers: NO_STORE })
  }
}
