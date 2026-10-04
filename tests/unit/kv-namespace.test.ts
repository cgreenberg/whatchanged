/** Every key written to / read from Redis (and the in-memory fallback) carries the version prefix. */
import * as kv from '@/lib/cache/kv'

function recordingClient() {
  const keys: string[] = []
  const store = new Map<string, unknown>()
  const client: kv.KvClient = {
    async get(k) { keys.push(k); return (store.get(k) ?? null) as never },
    async set(k, v) { keys.push(k); store.set(k, v); return 'OK' },
    async del(...ks) { keys.push(...ks); ks.forEach(k => store.delete(k)); return ks.length },
    async incr(k) { keys.push(k); const n = ((store.get(k) as number) ?? 0) + 1; store.set(k, n); return n },
    async expire(k) { keys.push(k); return 1 },
  }
  return { client, keys, store }
}

afterEach(() => {
  kv.__setKvClientForTests(undefined)
  kv.__resetRedisHealthForTests()
  kv.clearMemCache()
})

test('prefix is wc2:', () => {
  expect(kv.KEY_PREFIX).toBe('wc2:')
})

test('every Redis key touched (get/set/del/incr, envelope, lastgood, failed, missing, budget) is prefixed', async () => {
  const { client, keys, store } = recordingClient()
  kv.__setKvClientForTests(client)
  await kv.getCachedOrFetch('bls:cpi:0000:all', 100, async () => ({ x: 1 }), { budget: 'bls' })
  await kv.getCachedOrFetch('bls:cpi:0000:all', 100, async () => ({ x: 2 }), { budget: 'bls' })
  await kv.getCachedOrFetch('eia:gas:bad', 100, async () => { throw new Error('boom') }).catch(() => {})
  await kv.setCached('refresh:last-success', 'now', 100)
  await kv.getCached('refresh:last-success')
  await kv.deleteCached('refresh:last-success')
  await kv.tryAcquireUpstream('eia')
  expect(keys.length).toBeGreaterThan(8)
  expect(keys.filter(k => !k.startsWith('wc2:'))).toEqual([])
  expect([...store.keys()].filter(k => !k.startsWith('wc2:'))).toEqual([])
  expect(keys).toContain('wc2:bls:cpi:0000:all')
  expect(keys).toContain('wc2:bls:cpi:0000:all:lastgood')
  expect(keys).toContain('wc2:eia:gas:bad:failed')
  expect(keys.some(k => k.startsWith('wc2:budget:eia:'))).toBe(true)
})

test('in-memory fallback is namespaced consistently and round-trips logical keys', async () => {
  kv.__setKvClientForTests(null)
  await kv.setCached('some:key', { a: 1 }, 100)
  expect(await kv.getCached('some:key')).toEqual({ a: 1 })
  expect(await kv.getCached('wc2:some:key')).toEqual({ a: 1 }) // already-prefixed is not double-prefixed
  await kv.deleteCached('some:key')
  expect(await kv.getCached('some:key')).toBeNull()
  expect(kv.nsKey('x')).toBe('wc2:x')
  expect(kv.nsKey('wc2:x')).toBe('wc2:x')
})
