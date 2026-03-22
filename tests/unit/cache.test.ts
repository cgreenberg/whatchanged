import { getCached, setCached, clearMemCache, getCachedOrFetch } from '@/lib/cache/kv'

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
    await expect(getCachedOrFetch('neg-cache', 60, fetchFn, 60)).rejects.toThrow()
    // Second call: should throw "Negative cache hit" without calling fetchFn
    await expect(getCachedOrFetch('neg-cache', 60, fetchFn, 60)).rejects.toThrow('Negative cache hit')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test('stores fetched data so subsequent calls are cache hits', async () => {
    const fetchFn = jest.fn().mockResolvedValue('fresh-data')
    await getCachedOrFetch('store-test', 60, fetchFn)
    const cached = await getCached<string>('store-test')
    expect(cached).toBe('fresh-data')
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
