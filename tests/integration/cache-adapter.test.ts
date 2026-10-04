import { getCached, setCached, clearMemCache } from '@/lib/cache/kv'

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
