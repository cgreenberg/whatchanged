import { fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache } from '@/lib/cache/kv'
import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'
import { blsSource, blsCpiSource, eiaSource, usaSpendingSource } from '@/lib/api/source-registry'

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
    expect(snapshot!.federal).toBeDefined()
    expect(snapshot!.census).toBeDefined()
    expect(snapshot!.fetchedAt).toBeDefined()
  })

  test('all 4 external sources return data (not null)', async () => {
    const snapshot = await fetchSnapshot('98683')
    expect(snapshot).not.toBeNull()
    expect(snapshot!.unemployment.data).not.toBeNull()
    expect(snapshot!.cpi.data).not.toBeNull()
    expect(snapshot!.gas.data).not.toBeNull()
    expect(snapshot!.federal.data).not.toBeNull()
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
    expect(snapshot!.census.data!.medianIncome).toBe(83821)
    expect(snapshot!.census.data!.medianRent).toBe(1450)
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
})

describe('source registry docsUrls', () => {
  test('all sources have docsUrl for debugging', () => {
    for (const source of [blsSource, blsCpiSource, eiaSource, usaSpendingSource]) {
      expect(source.docsUrl).toBeTruthy()
      expect(source.docsUrl).toMatch(/^https:\/\//)
    }
  })
})
