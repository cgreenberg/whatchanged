import { fetchUnemployment } from '@/lib/api/bls'
import { getCached, setCached, clearMemCache } from '@/lib/cache/kv'
import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'
import blsFixture from '../fixtures/bls-unemployment.json'

describe('BLS unemployment client', () => {
  beforeEach(() => clearMemCache())

  test('fetches and parses unemployment data correctly', async () => {
    const data = await fetchUnemployment('53011')
    expect(data.current).toBe(5.0)
    expect(data.baseline).toBe(4.1)
    expect(data.change).toBe(0.9)
    expect(data.series.length).toBeGreaterThan(0)
    expect(data.countyFips).toBe('53011')
  })

  test('throws on BLS API error', async () => {
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', () => {
        return new HttpResponse(null, { status: 503 })
      })
    )
    await expect(fetchUnemployment('53011')).rejects.toThrow('BLS API error: 503')
  })

  test('throws when no data returned', async () => {
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', () => {
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED',
          Results: { series: [{ seriesID: 'LAUCN530110000000003', data: [] }] }
        })
      })
    )
    await expect(fetchUnemployment('53011')).rejects.toThrow()
  })
})

describe('Cache adapter (in-memory)', () => {
  beforeEach(() => clearMemCache())

  test('returns null on cache miss', async () => {
    const result = await getCached('nonexistent')
    expect(result).toBeNull()
  })

  test('returns cached value on hit', async () => {
    await setCached('test-key', { value: 42 }, 60)
    const result = await getCached<{ value: number }>('test-key')
    expect(result?.value).toBe(42)
  })

  test('returns null after TTL expires', async () => {
    await setCached('expiring', { x: 1 }, 0)  // TTL 0 = expires immediately
    await new Promise(r => setTimeout(r, 10))
    const result = await getCached('expiring')
    expect(result).toBeNull()
  })
})
