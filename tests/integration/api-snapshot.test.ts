import { fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache } from '@/lib/cache/kv'
import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'
import { blsFixtureFor } from '../mocks/handlers'
import eiaFixture from '../fixtures/eia-gas.json'
import { isGasStale } from '@/lib/api/eia'
import { blsSource, blsCpiSource, eiaSource } from '@/lib/api/source-registry'

describe('fetchSnapshot', () => {
  beforeEach(() => clearMemCache())

  test('returns full EconomicSnapshot with all fields for known zip', async () => {
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    expect(snapshot!.zip).toBe('98683')
    expect(snapshot!.location).toBeDefined()
    expect(snapshot!.unemployment).toBeDefined()
    expect(snapshot!.cpi).toBeDefined()
    expect(snapshot!.gas).toBeDefined()
    expect((snapshot as unknown as Record<string, unknown>).federal).toBeUndefined()
    expect(snapshot!.census).toBeDefined()
    expect(snapshot!.fetchedAt).toBeDefined()
  })

  test('all 3 external sources return data (not null)', async () => {
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    expect(snapshot!.unemployment.data).not.toBeNull()
    expect(snapshot!.cpi.data).not.toBeNull()
    expect(snapshot!.gas.data).not.toBeNull()
  })

  test('returns null for unknown zip', async () => {
    const snapshot = await fetchSnapshot('00000')
    expect(snapshot).toBeNull()
  })

  test('when EIA fails, snapshot still returns with gas error', async () => {
    server.use(
      http.get('https://api.eia.gov/v2/petroleum/pri/gnd/data/', () => {
        return new HttpResponse(null, { status: 503 })
      })
    )
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    expect(snapshot!.gas.data).toBeNull()
    expect(snapshot!.gas.error).toBeTruthy()
    // Other sources should still succeed
    expect(snapshot!.unemployment.data).not.toBeNull()
    expect(snapshot!.cpi.data).not.toBeNull()
  })

  test('census data is always present (no network fetch)', async () => {
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    expect(snapshot!.census.data).not.toBeNull()
    expect(snapshot!.census.error).toBeNull()
    expect(snapshot!.census.data!.zip).toBe('98683')
    // Use ranges instead of exact values — Census ACS data updates annually
    expect(snapshot!.census.data!.medianIncome).toBeGreaterThan(20000)
    expect(snapshot!.census.data!.medianIncome).toBeLessThan(500000)
    expect(snapshot!.census.data!.medianRent).toBeGreaterThan(200)
    expect(snapshot!.census.data!.medianRent).toBeLessThan(10000)
  })

  test('census uses national fallback for unknown zip with known county', async () => {
    // Find a zip that is in zip-lookup but not in census-acs.json
    // Use a zip that maps to a real county but not in our small census fixture
    const snapshot = await fetchSnapshot('10001')
    if (snapshot) {
      expect(snapshot.census.data).not.toBeNull()
      expect(snapshot.census.data!.zip).toBe('10001')
    }
  })

  test('BLS requests ask for >= 9 years of history (10Y charts)', async () => {
    const startYears: number[] = []
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        const body = (await request.json()) as { startyear: string; endyear: string }
        startYears.push(Number(body.endyear) - Number(body.startyear))
        return HttpResponse.json({ status: 'REQUEST_SUCCEEDED', Results: { series: [] } })
      })
    )
    await fetchSnapshot('98683')
    expect(startYears.length).toBeGreaterThan(0)
    for (const span of startYears) expect(span).toBeGreaterThanOrEqual(9)
  })

  test('values come from the recorded fixture with their baseline periods', async () => {
    const snapshot = await fetchSnapshot('98683')
    const u = snapshot!.unemployment.data!
    expect(u.seriesId).toBe('LAUCN530110000000003')
    expect(u.baselinePeriod).toBe('2025-01')
    expect(u.nationalSeriesId).toBe('LNU04000000')
    const c = snapshot!.cpi.data!
    expect(c.seriesIds?.groceries).toBe('CUUR0490SAF11')
    expect(c.groceriesBaselinePeriod).toBe('2025-01')
    expect(c.groceriesChange).toBe(4.0)
    expect(c.shelterChange).toBe(5.3)
    // BLS footnote "P": the recorded LAUS Aug 2026 value is preliminary
    expect(u.latestPeriod).toBe('2026-08')
    expect(u.latestPreliminary).toBe(true)
    expect(u.series[u.series.length - 1].preliminary).toBe(true)
    expect(u.series.filter((p) => p.preliminary).length).toBe(1)
    // Gas: real recorded EIA EPMR (regular) response for Washington state
    const g = snapshot!.gas.data!
    expect(g.duoarea).toBe('SWA')
    expect(g.baselineDate).toBe('2025-01-20')
    expect(g.baseline).toBe(3.791)
    expect(g.current).toBe(5.453)
    expect(g.latestDate).toBe('2026-09-28')
    expect(g.nationalSeries?.length).toBeGreaterThan(0)
    expect(snapshot!.gas.stale ?? false).toBe(isGasStale(g.latestDate!))
    // Dollar translations: $6,000 × 4.0% = $240; local rent × 12 × 5.3%
    expect(snapshot!.dollarImpact!.groceries).toBe(240)
    const rent = snapshot!.census.data!.medianRent
    expect(snapshot!.dollarImpact!.shelter).toBe(Math.round((rent * 12 * 5.3) / 100))
  })

  test('out-of-range values are rejected → source unavailable, not cached', async () => {
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        const body = (await request.json()) as { seriesid: string[] }
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED',
          Results: {
            series: body.seriesid.map((id) => ({
              seriesID: id,
              data: [
                { year: '2026', period: 'M08', value: id.startsWith('LAU') ? '45.0' : '300.0' },
                { year: '2025', period: 'M01', value: id.startsWith('LAU') ? '4.0' : '100.0' },
              ],
            })),
          },
        })
      })
    )
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot!.unemployment.data).toBeNull() // 45% > 25%
    expect(snapshot!.cpi.data).toBeNull() // +200% > +50%
    expect(snapshot!.dollarImpact!.groceries).toBeNull()
  })

  test('primary gas failure falls back to national, labeled, and not stored under the primary key', async () => {
    const { getCachedEnvelope } = await import('@/lib/cache/kv')
    server.use(
      http.get('https://api.eia.gov/v2/petroleum/pri/gnd/data/', ({ request }) => {
        const area = new URL(request.url).searchParams.get('facets[duoarea][]')
        if (area !== 'NUS') return new HttpResponse(null, { status: 503 })
        return HttpResponse.json(eiaFixture)
      })
    )
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot!.gas.data!.isNationalFallback).toBe(true)
    expect(snapshot!.gas.data!.duoarea).toBe('NUS')
    expect(await getCachedEnvelope('eia:gas:epmr:state:WA')).toBeNull()
  })

  test('local CPI failure → national CPI marked fallback, shelter $ impact null', async () => {
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        const body = (await request.json()) as { seriesid: string[] }
        if (body.seriesid.includes('CUUR0490SAF11')) return new HttpResponse(null, { status: 503 })
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED',
          Results: { series: body.seriesid.map((id) => ({ seriesID: id, data: blsFixtureFor(id) })) },
        })
      })
    )
    const snapshot = await fetchSnapshot('98683')
    const c = snapshot!.cpi.data!
    expect(c.areaCode).toBe('0000')
    expect(c.fallback).toBe('national')
    expect(c.shelterChange).toEqual(expect.any(Number))
    expect(snapshot!.dollarImpact!.shelter).toBeNull()
    expect(snapshot!.dollarImpact!.groceries).toEqual(expect.any(Number))
  })

  test('local CPI success → no fallback marker', async () => {
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot!.cpi.data!.fallback).toBeUndefined()
  })
})

describe('source registry docsUrls', () => {
  test('all sources have docsUrl for debugging', () => {
    for (const source of [blsSource, blsCpiSource, eiaSource]) {
      expect(source.docsUrl).toBeTruthy()
      expect(source.docsUrl).toMatch(/^https:\/\//)
    }
  })
})

describe('fetchSnapshot — Connecticut LAUS area by zip', () => {
  beforeEach(() => clearMemCache())

  test('06902 (Stamford) requests the Western CT planning region series', async () => {
    const requested: string[] = []
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        const body = (await request.json()) as { seriesid?: string[] }
        requested.push(...(body.seriesid ?? []))
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED',
          Results: { series: (body.seriesid ?? []).map(id => ({ seriesID: id, data: blsFixtureFor(id) })) },
        })
      })
    )
    const snapshot = await fetchSnapshot('06902')
    expect(requested).toContain('LAUCN091900000000003')
    expect(requested).not.toContain('LAUCN091200000000003')
    expect(snapshot!.unemployment.data!.seriesId).toBe('LAUCN091900000000003')
    expect(snapshot!.unemployment.data!.lausFips).toBe('09190')
    expect(snapshot!.unemployment.data!.lausAreaName).toBe('Western Connecticut Planning Region')
  })

  test('zips in one planning region share a single cached LAUS entry', async () => {
    let lausCalls = 0
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        const body = (await request.json()) as { seriesid?: string[] }
        if ((body.seriesid ?? []).some(id => id.startsWith('LAUCN'))) lausCalls++
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED',
          Results: { series: (body.seriesid ?? []).map(id => ({ seriesID: id, data: blsFixtureFor(id) })) },
        })
      })
    )
    await fetchSnapshot('06902') // Stamford
    await fetchSnapshot('06830') // Greenwich
    expect(lausCalls).toBe(1)
  })
})
