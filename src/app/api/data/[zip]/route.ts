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
          computations: {
            gasChange: snapshot.gas?.data ? {
              formula: 'current - baseline',
              current: snapshot.gas.data.current,
              baseline: snapshot.gas.data.baseline,
              result: snapshot.gas.data.change,
            } : null,
            groceriesChange: snapshot.cpi?.data ? {
              formula: '(groceriesCurrent - groceriesBaseline) / groceriesBaseline * 100',
              current: snapshot.cpi.data.groceriesCurrent,
              baseline: snapshot.cpi.data.groceriesBaseline,
              result: snapshot.cpi.data.groceriesChange,
            } : null,
            shelterChange: snapshot.cpi?.data ? {
              formula: 'shelter % change from Jan 2025 baseline',
              result: snapshot.cpi.data.shelterChange,
            } : null,
            unemploymentChange: snapshot.unemployment?.data ? {
              formula: 'current - baseline',
              current: snapshot.unemployment.data.current,
              baseline: snapshot.unemployment.data.baseline,
              result: snapshot.unemployment.data.change,
            } : null,
            tariffEstimate: snapshot.tariff?.data ? {
              formula: 'Math.round(medianIncome * tariffRate)',
              medianIncome: snapshot.tariff.data.medianIncome,
              tariffRate: snapshot.tariff.data.tariffRate,
              result: snapshot.tariff.data.estimatedCost,
            } : null,
          },
          apiVersion: '1.0',
        },
      }
    : snapshot

  const response = NextResponse.json(body)
  response.headers.set('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
  return response
}
