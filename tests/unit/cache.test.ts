import { getCached, setCached, clearMemCache, getCachedOrFetch, getCachedEnvelope } from '@/lib/cache/kv'

// NODE_ENV=test is set by Jest, so the in-memory fallback is always used here
// (getRedis() returns null in test env)

describe('in-memory cache: getCached / setCached', () => {
  beforeEach(() => clearMemCache())

  test('returns null for a key that was never set', async () => {
    const result = await getCached('missing-key')
    expect(result).toBeNull()
  })

  test('returns stored value after setCached', async () => {
    await setCached('greeting', 'hello', 60)
    const result = await getCached<string>('greeting')
    expect(result).toBe('hello')
  })

  test('stores and retrieves an object', async () => {
    const obj = { unemployment: 5.0, county: '53011' }
    await setCached('county-data', obj, 300)
    const result = await getCached<typeof obj>('county-data')
    expect(result).toEqual(obj)
  })

  test('stores and retrieves a number', async () => {
    await setCached('rate', 3.75, 60)
    const result = await getCached<number>('rate')
    expect(result).toBe(3.75)
  })

  test('stores and retrieves an array', async () => {
    const arr = [1, 2, 3]
    await setCached('series', arr, 60)
    const result = await getCached<number[]>('series')
    expect(result).toEqual(arr)
  })

  test('returns null after TTL=0 (expires immediately)', async () => {
    await setCached('ephemeral', 'gone', 0)
    await new Promise(r => setTimeout(r, 10))
    const result = await getCached('ephemeral')
    expect(result).toBeNull()
  })

  test('returns null after TTL expires (short lived)', async () => {
    await setCached('short', 'value', 0.001) // 1ms TTL
    await new Promise(r => setTimeout(r, 50))
    const result = await getCached('short')
    expect(result).toBeNull()
  })

  test('does not return data from a different key', async () => {
    await setCached('key-a', 'apple', 60)
    const result = await getCached('key-b')
    expect(result).toBeNull()
  })

  test('overwrites existing value when same key is set again', async () => {
    await setCached('overwrite', 'first', 60)
    await setCached('overwrite', 'second', 60)
    const result = await getCached<string>('overwrite')
    expect(result).toBe('second')
  })

  test('clearMemCache removes all entries', async () => {
    await setCached('a', 1, 60)
    await setCached('b', 2, 60)
    clearMemCache()
    expect(await getCached('a')).toBeNull()
    expect(await getCached('b')).toBeNull()
  })
})

describe('getCachedOrFetch', () => {
  beforeEach(() => clearMemCache())

  test('calls fetchFn on cache miss and returns data', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ value: 42 })
    const result = await getCachedOrFetch('fetch-test', 60, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(result.data).toEqual({ value: 42 })
    expect(result.cacheHit).toBe(false)
  })

  test('returns cached value on second call without calling fetchFn again', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ value: 99 })
    await getCachedOrFetch('cache-hit-test', 60, fetchFn)
    const second = await getCachedOrFetch('cache-hit-test', 60, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(second.data).toEqual({ value: 99 })
    expect(second.cacheHit).toBe(true)
  })

  test('throws when fetchFn throws', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('API down'))
    await expect(getCachedOrFetch('throw-test', 60, fetchFn)).rejects.toThrow('API down')
  })

  test('negative cache: second call within negativeTtl does not call fetchFn', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('Broken'))
    // First call: failure sets negative cache
    await expect(getCachedOrFetch('neg-cache', 60, fetchFn, { negativeTtl: 60 })).rejects.toThrow()
    // Second call: should throw "Negative cache hit" without calling fetchFn
    await expect(getCachedOrFetch('neg-cache', 60, fetchFn, { negativeTtl: 60 })).rejects.toThrow('Negative cache hit')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test('stores fetched data with fetchedAt inside the cached value', async () => {
    const fetchFn = jest.fn().mockResolvedValue('fresh-data')
    const first = await getCachedOrFetch('store-test', 60, fetchFn)
    const env = await getCachedEnvelope<string>('store-test')
    expect(env?.data).toBe('fresh-data')
    expect(env?.fetchedAt).toBe(first.fetchedAt)
    const second = await getCachedOrFetch('store-test', 60, fetchFn)
    expect(second.fetchedAt).toBe(first.fetchedAt) // upstream fetch time, not request time
  })

  test('legacy (non-envelope) cached values are treated as misses', async () => {
    await setCached('legacy', { shelterChange: 0 }, 60)
    const fetchFn = jest.fn().mockResolvedValue({ shelterChange: 3.1 })
    const r = await getCachedOrFetch('legacy', 60, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r.data).toEqual({ shelterChange: 3.1 })
  })

  test('validator: invalid fetched data is not cached and throws', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ rate: 99 })
    await expect(
      getCachedOrFetch('bad', 60, fetchFn, { validate: (d: { rate: number }) => d.rate <= 25 })
    ).rejects.toThrow(/validation/)
    expect(await getCachedEnvelope('bad')).toBeNull()
  })

  test('validator: invalid cached entry is ignored and refetched', async () => {
    await getCachedOrFetch('val', 60, async () => ({ rate: 99 }))
    const fetchFn = jest.fn().mockResolvedValue({ rate: 5 })
    const r = await getCachedOrFetch('val', 60, fetchFn, { validate: (d: { rate: number }) => d.rate <= 25 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r.data.rate).toBe(5)
  })

  test('fetch failure serves the last-good copy with stale=true', async () => {
    await getCachedOrFetch('lg', 0.001, async () => 'good')
    await new Promise((r) => setTimeout(r, 10)) // primary entry expires; last-good remains
    const failing = jest.fn().mockRejectedValue(new Error('down'))
    const r = await getCachedOrFetch('lg', 60, failing)
    expect(r).toMatchObject({ data: 'good', stale: true })
    // Negative cache now set: next call serves last-good without refetching
    const r2 = await getCachedOrFetch('lg', 60, failing)
    expect(r2).toMatchObject({ data: 'good', stale: true })
    expect(failing).toHaveBeenCalledTimes(1)
  })

  test('concurrent callers for the same key share one fetch (stampede protection)', async () => {
    let resolve!: (v: string) => void
    const fetchFn = jest.fn().mockImplementation(() => new Promise<string>((r) => { resolve = r }))
    const a = getCachedOrFetch('stampede', 60, fetchFn)
    const b = getCachedOrFetch('stampede', 60, fetchFn)
    await new Promise((r) => setTimeout(r, 0))
    resolve('once')
    const [ra, rb] = await Promise.all([a, b])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(ra.data).toBe('once')
    expect(rb.data).toBe('once')
  })

  test('forceRefresh refetches even when cached', async () => {
    await getCachedOrFetch('force', 60, async () => 'old')
    const r = await getCachedOrFetch('force', 60, async () => 'new', { forceRefresh: true })
    expect(r).toMatchObject({ data: 'new', cacheHit: false })
  })
})

describe('cache isolation (different keys do not interfere)', () => {
  beforeEach(() => clearMemCache())

  test('cache keys for different county FIPS do not collide', async () => {
    await setCached('bls-county-53011', { unemployment: 5.0 }, 60)
    await setCached('bls-county-36061', { unemployment: 4.2 }, 60)
    const wa = await getCached<{ unemployment: number }>('bls-county-53011')
    const ny = await getCached<{ unemployment: number }>('bls-county-36061')
    expect(wa?.unemployment).toBe(5.0)
    expect(ny?.unemployment).toBe(4.2)
  })

  test('national CPI cache key does not collide with county cache key', async () => {
    await setCached('bls-national-cpi', { groceries: 311 }, 60)
    await setCached('bls-county-53011', { unemployment: 5.0 }, 60)
    const national = await getCached<{ groceries: number }>('bls-national-cpi')
    const county = await getCached<{ unemployment: number }>('bls-county-53011')
    expect(national?.groceries).toBe(311)
    expect(county?.unemployment).toBe(5.0)
  })
})
