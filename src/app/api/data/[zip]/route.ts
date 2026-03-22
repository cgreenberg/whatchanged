import { NextRequest, NextResponse } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'

function computeAge(fetchedAt: string): number | null {
  try {
    return Math.round((Date.now() - new Date(fetchedAt).getTime()) / 1000)
  } catch {
    return null
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ zip: string }> }
) {
  const { zip } = await params

  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip code format' }, { status: 400 })
  }

  const snapshot = await fetchSnapshot(zip)
  if (!snapshot) {
    return NextResponse.json({ error: 'Zip code not found' }, { status: 404 })
  }

  const audit = req.nextUrl.searchParams.get('audit') === 'true'

  const body = audit
    ? {
        ...snapshot,
        _audit: {
          cacheStatus: snapshot.cacheStatus,
          tariffComputation: {
            input: snapshot.tariff?.data?.medianIncome,
            rate: snapshot.tariff?.data?.tariffRate,
            output: snapshot.tariff?.data?.estimatedCost,
            isFallback: snapshot.tariff?.data?.isFallback,
          },
          gasSeries: {
            duoarea: snapshot.gas?.data?.duoarea,
            geoLevel: snapshot.gas?.data?.geoLevel,
            isNationalFallback: snapshot.gas?.data?.isNationalFallback,
          },
          dataAge: {
            gas: computeAge(snapshot.gas.fetchedAt),
            cpi: computeAge(snapshot.cpi.fetchedAt),
            unemployment: computeAge(snapshot.unemployment.fetchedAt),
          },
          censusFallback: snapshot.census?.data?.isFallback ?? null,
          blsSeriesIds: {
            unemployment: snapshot.unemployment?.data?.seriesId ?? null,
            cpiGroceries: snapshot.cpi?.data?.seriesIds?.groceries ?? null,
            cpiShelter: snapshot.cpi?.data?.seriesIds?.shelter ?? null,
            cpiEnergy: snapshot.cpi?.data?.seriesIds?.energy ?? null,
          },
          apiVersion: '1.0',
        },
      }
    : snapshot

  const response = NextResponse.json(body)
  response.headers.set('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
  return response
}
