import { NextRequest, NextResponse } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { eiaGasSeriesId, EIA_GAS_PRODUCT } from '@/lib/api/eia'
import { hasElectricitySeries } from '@/lib/api/eia-electricity'
import type { EconomicSnapshot } from '@/types'
import { usesNationalFallback, cpiItemStale } from '@/lib/hero-cards'

function computeAge(fetchedAt: string | undefined): number | null {
  if (!fetchedAt) return null
  const t = new Date(fetchedAt).getTime()
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : null
}

function buildAudit(snapshot: EconomicSnapshot) {
  const c = snapshot.cpi?.data
  const g = snapshot.gas?.data
  const e = snapshot.electricity?.data
  return {
    cacheStatus: snapshot.cacheStatus,
    gasSeries: {
      source: g?.source ?? (g ? 'eia' : undefined),
      frequency: g?.frequency ?? (g ? 'weekly' : undefined),
      seriesId: g ? (g.seriesId ?? (g.duoarea ? eiaGasSeriesId(g.duoarea) : null)) : undefined,
      duoarea: g?.duoarea,
      blsArea: g?.blsArea,
      geoLevel: g?.geoLevel,
      isNationalFallback: g?.isNationalFallback,
    },
    // Seconds since the upstream data was actually fetched (stored in the cache entry)
    dataAge: {
      gas: computeAge(snapshot.gas.fetchedAt),
      cpi: computeAge(snapshot.cpi.fetchedAt),
      electricity: snapshot.electricity?.data ? computeAge(snapshot.electricity.fetchedAt) : null,
    },
    censusFallback: snapshot.census?.data?.isFallback ?? null,
    censusRent: snapshot.census?.data ? {
      source: snapshot.census.data.source ?? null,
      medianRent: snapshot.census.data.medianRent,
      isRentFallback: snapshot.census.data.isRentFallback ?? null,
      year: snapshot.census.data.year,
      donorZip: snapshot.census.data.donorZip ?? null,
      donorScope: snapshot.census.data.donorScope ?? null,
      label: snapshot.census.data.sourceLabel ?? null,
    } : null,
    blsSeriesIds: {
      cpiGroceries: c?.seriesIds?.groceries ?? null,
      cpiShelter: c?.seriesIds?.shelter ?? null,
      cpiRent: c?.seriesIds?.rent ?? null,
    },
    // Per-source series + the exact observations used for each displayed change
    sources: {
      cpiGroceries: c ? {
        seriesId: c.seriesIds?.groceries ?? null,
        fallback: c.fallback ?? null,
        baseline: { period: c.groceriesBaselinePeriod ?? null, value: c.groceriesBaseline },
        latest: { period: c.groceriesLatestPeriod ?? null, value: c.groceriesCurrent },
        stale: cpiItemStale(snapshot, 'groceries'),
      } : null,
      cpiShelter: c && c.shelterChange !== undefined ? {
        seriesId: c.seriesIds?.shelter ?? null,
        baseline: { period: c.shelterBaselinePeriod ?? null, value: c.shelterBaseline ?? null },
        latest: { period: c.shelterLatestPeriod ?? null, value: c.shelterCurrent ?? null },
        stale: cpiItemStale(snapshot, 'shelter'),
      } : null,
      // Rent of primary residence: used only for the shelter card's $/yr in rent
      cpiRent: c && c.rentIndexChange !== undefined ? {
        seriesId: c.seriesIds?.rent ?? null,
        baseline: { period: c.rentIndexBaselinePeriod ?? null, value: c.rentIndexBaseline ?? null },
        latest: { period: c.rentIndexLatestPeriod ?? null, value: c.rentIndexCurrent ?? null },
      } : null,
      gas: g ? {
        source: g.source ?? 'eia',
        frequency: g.frequency ?? 'weekly',
        seriesId: g.seriesId ?? (g.duoarea ? eiaGasSeriesId(g.duoarea) : null),
        // EIA product code (EPMR = regular); BLS tiers use item 74714 (unleaded regular); static sources none
        product: !g.source || g.source === 'eia' ? EIA_GAS_PRODUCT : null,
        ...(g.staticSource ? { staticSource: g.staticSource } : {}),
        duoarea: g.duoarea ?? null,
        baseline: { period: g.baselineDate ?? null, value: g.baseline },
        latest: { period: g.latestDate ?? null, value: g.current },
        stale: snapshot.gas.stale ?? false,
      } : null,
      electricity: e ? {
        source: 'eia',
        route: 'electricity/retail-sales',
        seriesId: e.seriesId,
        state: e.state,
        sector: 'RES',
        method: '12-month average price (mean of 12 published monthly prices); no seasonal adjustment',
        baseline: { from: e.baselineFrom, period: e.baselinePeriod, avg12: e.baseline, monthPrice: e.baselineMonthPrice },
        latest: { from: e.currentFrom, period: e.latestPeriod, avg12: e.current, monthPrice: e.latestMonthPrice },
        usage: { kwhPerMonth: e.usageKwh, from: e.usageFrom ?? null, to: e.usageTo ?? null },
        stale: snapshot.electricity.stale ?? false,
      } : null,
      heating: (['oil', 'propane'] as const).map((product) => {
        const h = snapshot.heating?.[product]?.data
        return h ? {
          product, source: h.source, seriesId: h.seriesId, geography: h.geography,
          baseline: { period: h.baselineDate, value: h.baseline },
          latest: { period: h.latestDate, value: h.current },
          change: h.change, offSeason: h.offSeasonNote ?? null,
        } : null
      }).filter(Boolean),
    },
    computations: {
      gasChange: g ? {
        formula: 'current - baseline',
        current: g.current,
        baseline: g.baseline,
        result: g.change,
      } : null,
      groceriesChange: c ? {
        formula: '(groceriesCurrent - groceriesBaseline) / groceriesBaseline * 100',
        current: c.groceriesCurrent,
        baseline: c.groceriesBaseline,
        result: c.groceriesChange,
      } : null,
      shelterChange: c && c.shelterChange !== undefined ? {
        formula: '(shelterCurrent - shelterBaseline) / shelterBaseline * 100',
        current: c.shelterCurrent ?? null,
        baseline: c.shelterBaseline ?? null,
        result: c.shelterChange,
      } : null,
      rentIndexChange: c && c.rentIndexChange !== undefined ? {
        formula: '(rentIndexCurrent - rentIndexBaseline) / rentIndexBaseline * 100',
        current: c.rentIndexCurrent ?? null,
        baseline: c.rentIndexBaseline ?? null,
        result: c.rentIndexChange,
      } : null,
      shelterDollars: snapshot.dollarImpact ? {
        formula: 'Math.round(localMedianRent * 12 * rentIndexChange / 100)',
        localMedianRent: snapshot.census?.data?.medianRent ?? null,
        rentIndexChange: c?.rentIndexChange ?? null,
        result: snapshot.dollarImpact.shelter,
      } : null,
      electricityChange: e ? {
        formula: '(avg12Current - avg12Baseline) / avg12Baseline * 100',
        current: e.current,
        baseline: e.baseline,
        result: e.change,
      } : null,
      electricityDollars: snapshot.dollarImpact ? {
        formula: 'Math.round((avg12Current - avg12Baseline) * usageKwh / 100)',
        priceChangeCents: e ? e.current - e.baseline : null,
        usageKwh: e?.usageKwh ?? null,
        result: snapshot.dollarImpact.electricity,
      } : null,
    },
    apiVersion: '2.0',
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

  // Every number comes from the zip alone (?city=/&state= in old links are ignored)
  const snapshot = await fetchSnapshot(zip)
  if (!snapshot) {
    return NextResponse.json({ error: 'Zip code not found' }, { status: 404 })
  }

  const audit = req.nextUrl.searchParams.get('audit') === 'true'
  const body = audit ? { ...snapshot, _audit: buildAudit(snapshot) } : snapshot

  // Electricity counts only where EIA publishes a state series (territories have none by design)
  const sources = [snapshot.cpi, snapshot.gas, ...(hasElectricitySeries(snapshot.location.stateAbbr) ? [snapshot.electricity] : [])]
  // A national stand-in for a failed local series is degraded too (short TTL, self-heals).
  const degraded = sources.some((s) => !s?.data || s.stale) || usesNationalFallback(snapshot)
  const cacheHeader = degraded
    ? 's-maxage=300, stale-while-revalidate=300'
    : 's-maxage=86400, stale-while-revalidate=86400'
  const response = NextResponse.json(body)
  response.headers.set('Cache-Control', cacheHeader)
  return response
}
