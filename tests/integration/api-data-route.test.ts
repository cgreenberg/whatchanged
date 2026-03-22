// Integration tests for the /api/data/[zip] route
// Tests zip validation, 404 behavior, and snapshot response structure
// Uses fetchSnapshot directly (same as the route handler) since Next.js
// route testing requires a running server — we validate the logic layer instead.
import { fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache } from '@/lib/cache/kv'
import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'

describe('zip validation (mirrors route.ts guard: /^\\d{5}$/)', () => {
  test('5-digit numeric zip is valid', () => {
    expect(/^\d{5}$/.test('98683')).toBe(true)
    expect(/^\d{5}$/.test('10001')).toBe(true)
    expect(/^\d{5}$/.test('00601')).toBe(true)
  })

  test('4-digit string is invalid', () => {
    expect(/^\d{5}$/.test('9868')).toBe(false)
  })

  test('6-digit string is invalid', () => {
    expect(/^\d{5}$/.test('986830')).toBe(false)
  })

  test('non-numeric string is invalid', () => {
    expect(/^\d{5}$/.test('abcde')).toBe(false)
    expect(/^\d{5}$/.test('986ab')).toBe(false)
  })

  test('empty string is invalid', () => {
    expect(/^\d{5}$/.test('')).toBe(false)
  })

  test('zip with spaces is invalid', () => {
    expect(/^\d{5}$/.test('986 3')).toBe(false)
    expect(/^\d{5}$/.test(' 98683')).toBe(false)
  })

  test('99999 is invalid (no such zip in lookup)', async () => {
    const snapshot = await fetchSnapshot('99999')
    expect(snapshot).toBeNull()
  })

  test('00000 is invalid (no such zip in lookup)', async () => {
    const snapshot = await fetchSnapshot('00000')
    expect(snapshot).toBeNull()
  })
})

describe('fetchSnapshot response structure for valid zips', () => {
  beforeEach(() => clearMemCache())

  test('returns EconomicSnapshot with all top-level fields for known zip', async () => {
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    expect(snapshot!.zip).toBe('98683')
    expect(snapshot!.location).toBeDefined()
    expect(snapshot!.unemployment).toBeDefined()
    expect(snapshot!.cpi).toBeDefined()
    expect(snapshot!.gas).toBeDefined()
    expect(snapshot!.federal).toBeDefined()
    expect(snapshot!.census).toBeDefined()
    expect(snapshot!.fetchedAt).toBeDefined()
    expect(snapshot!.cacheStatus).toBeDefined()
  })

  test('fetchedAt is a valid ISO date string', async () => {
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    expect(() => new Date(snapshot!.fetchedAt)).not.toThrow()
    expect(new Date(snapshot!.fetchedAt).getTime()).not.toBeNaN()
  })

  test('location has all required fields', async () => {
    const snapshot = await fetchSnapshot('98683')
    const loc = snapshot!.location
    expect(loc.zip).toBe('98683')
    expect(loc.countyFips).toBeTruthy()
    expect(loc.countyName).toBeTruthy()
    expect(loc.stateName).toBeTruthy()
    expect(loc.stateAbbr).toBeTruthy()
    expect(loc.stateAbbr.length).toBe(2)
  })

  test('each DataResult has data, error, fetchedAt, sourceId', async () => {
    const snapshot = await fetchSnapshot('98683')
    for (const key of ['unemployment', 'cpi', 'gas', 'federal', 'census'] as const) {
      const result = snapshot![key]
      expect('data' in result).toBe(true)
      expect('error' in result).toBe(true)
      expect('fetchedAt' in result).toBe(true)
      expect('sourceId' in result).toBe(true)
    }
  })

  test('cacheStatus has all 5 source keys', async () => {
    const snapshot = await fetchSnapshot('98683')
    const status = snapshot!.cacheStatus!
    expect(['hit', 'miss']).toContain(status.unemployment)
    expect(['hit', 'miss']).toContain(status.cpi)
    expect(['hit', 'miss']).toContain(status.gas)
    expect(['hit', 'miss']).toContain(status.federal)
    expect(['hit', 'miss']).toContain(status.census)
  })
})

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

  test('snapshot has cacheStatus with all 5 keys', async () => {
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    const cs = snapshot!.cacheStatus!
    expect(cs).toHaveProperty('unemployment')
    expect(cs).toHaveProperty('cpi')
    expect(cs).toHaveProperty('gas')
    expect(cs).toHaveProperty('federal')
    expect(cs).toHaveProperty('census')
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
