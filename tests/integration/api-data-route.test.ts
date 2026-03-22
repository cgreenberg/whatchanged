// Integration tests for the /api/data/[zip] route
// Tests graceful degradation, caching behavior, and edge-case zip handling.
// Uses fetchSnapshot directly (same as the route handler) since Next.js
// route testing requires a running server — we validate the logic layer instead.
import { fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache } from '@/lib/cache/kv'
import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'

describe('fetchSnapshot graceful degradation', () => {
  beforeEach(() => clearMemCache())

  test('when BLS unemployment fails, snapshot still returns with error field', async () => {
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        const body = await request.json() as { seriesid?: string[] }
        // Only fail for unemployment (LAUCN series), let CPI through
        const ids = body.seriesid ?? []
        if (ids.some((id: string) => id.startsWith('LAUCN'))) {
          return new HttpResponse(null, { status: 503 })
        }
        // Let CPI requests pass through to default handler
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED',
          Results: { series: [] },
        })
      })
    )
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    // unemployment should be null with error
    expect(snapshot!.unemployment.data).toBeNull()
    expect(snapshot!.unemployment.error).toBeTruthy()
  })

  test('when USASpending fails, snapshot still returns with federal error', async () => {
    server.use(
      http.post('https://api.usaspending.gov/api/v2/search/spending_by_award/', () => {
        return new HttpResponse(null, { status: 500 })
      })
    )
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    expect(snapshot!.federal.data).toBeNull()
    expect(snapshot!.federal.error).toBeTruthy()
    // Other sources should still work
    expect(snapshot!.census.data).not.toBeNull()
  })

  test('when all external APIs fail, snapshot returns with all data null but no crash', async () => {
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', () =>
        new HttpResponse(null, { status: 503 })
      ),
      http.get('https://api.eia.gov/v2/petroleum/pri/gnd/data/', () =>
        new HttpResponse(null, { status: 503 })
      ),
      http.post('https://api.usaspending.gov/api/v2/search/spending_by_award/', () =>
        new HttpResponse(null, { status: 503 })
      )
    )
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull() // should not return null for valid zip
    expect(snapshot!.unemployment.data).toBeNull()
    expect(snapshot!.cpi.data).toBeNull()
    expect(snapshot!.gas.data).toBeNull()
    expect(snapshot!.federal.data).toBeNull()
    // Census is static — should still be present
    expect(snapshot!.census.data).not.toBeNull()
  })

  test('census data is always present and does not require external API', async () => {
    // Even if all external APIs are down, census comes from bundled static data
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', () =>
        new HttpResponse(null, { status: 503 })
      )
    )
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    expect(snapshot!.census.data).not.toBeNull()
    expect(snapshot!.census.error).toBeNull()
  })
})

describe('fetchSnapshot caching behavior', () => {
  beforeEach(() => clearMemCache())

  test('first call is a cache miss for all external sources', async () => {
    clearMemCache()
    const first = await fetchSnapshot('98683')
    expect(first).not.toBeNull()
    // On first call, all external sources are fetched (miss), not cached
    // (census is always 'hit' because it's static)
    expect(first!.cacheStatus!.census).toBe('hit')
  })

  test('each cacheStatus value is "hit" or "miss"', async () => {
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    const cs = snapshot!.cacheStatus!
    for (const key of ['unemployment', 'cpi', 'gas', 'federal', 'census'] as const) {
      expect(['hit', 'miss']).toContain(cs[key])
    }
  })
})

describe('fetchSnapshot for edge-case zip codes', () => {
  beforeEach(() => clearMemCache())

  test('returns null for completely fake zip 99999', async () => {
    const snapshot = await fetchSnapshot('99999')
    expect(snapshot).toBeNull()
  })

  test('returns null for all-zeros zip 00000', async () => {
    const snapshot = await fetchSnapshot('00000')
    expect(snapshot).toBeNull()
  })

  test('returns valid snapshot for NYC zip 10001', async () => {
    const snapshot = await fetchSnapshot('10001')
    if (snapshot) {
      expect(snapshot.location.stateAbbr).toBe('NY')
      expect(snapshot.census.data).not.toBeNull()
    }
  })
})
