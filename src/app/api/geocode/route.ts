import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const lat = req.nextUrl.searchParams.get('lat')
  const lng = req.nextUrl.searchParams.get('lng')

  if (!lat || !lng || isNaN(Number(lat)) || isNaN(Number(lng))) {
    return Response.json({ zip: null }, { status: 400 })
  }

  const layers = encodeURIComponent(
    '2020 Census ZIP Code Tabulation Areas,2010 Census ZIP Code Tabulation Areas'
  )
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=${layers}&format=json`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return Response.json({ zip: null })

    const data = await res.json()
    const geos = data?.result?.geographies

    const zcta2020 = geos?.['2020 Census ZIP Code Tabulation Areas']?.[0]
    if (zcta2020?.ZCTA5) return Response.json({ zip: zcta2020.ZCTA5 })
    if (zcta2020?.ZCTA5CE20) return Response.json({ zip: zcta2020.ZCTA5CE20 })

    const zcta2010 = geos?.['2010 Census ZIP Code Tabulation Areas']?.[0]
    if (zcta2010?.ZCTA5) return Response.json({ zip: zcta2010.ZCTA5 })
    if (zcta2010?.ZCTA5CE10) return Response.json({ zip: zcta2010.ZCTA5CE10 })

    return Response.json({ zip: null })
  } catch {
    return Response.json({ zip: null })
  }
}
