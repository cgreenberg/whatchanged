/**
 * Redis-down breaker: GET timeouts count toward it even when the SET that follows a cache-miss
 * fetch succeeds — only a successful GET resets the count. (Regression: a burst of concurrent
 * GET timeouts used to be "reset" by the successful SETs, so a cold instance never tripped the
 * breaker and kept spending upstream budget re-fetching data that was already cached.)
 */
import * as kv from '@/lib/cache/kv'

const env = () => ({ __v: 2, fetchedAt: new Date().toISOString(), data: { x: 1 } })

function slowGetClient(store: Map<string, unknown>, state: { slow: boolean }): kv.KvClient {
  return {
    async get(k) { if (state.slow) await new Promise(r => setTimeout(r, 80)); return (store.get(k) ?? null) as never },
    async set(k, v) { store.set(k, v); return 'OK' },
    async del() { return 1 },
    async incr() { return 1 },
    async expire() { return 1 },
  }
}

const prevVercel = process.env.VERCEL
beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => {
  ;(console.error as jest.Mock).mockRestore()
  process.env.VERCEL = prevVercel
  kv.__setKvClientForTests(undefined)
  kv.__resetRedisHealthForTests()
})

test('a burst of concurrent GET timeouts trips the breaker despite successful SETs', async () => {
  const store = new Map<string, unknown>(['a', 'b', 'c', 'cold'].map(k => [kv.nsKey(k), env()]))
  const state = { slow: true }
  kv.__setKvClientForTests(slowGetClient(store, state))
  kv.configureRedisTimeouts({ callTimeoutMs: 20 })
  process.env.VERCEL = '1'
  let fetches = 0
  const f = async () => { fetches++; return { x: 9 } }
  await Promise.all(['a', 'b', 'c'].map(k => kv.getCachedOrFetch(k, 100, f, { budget: 'bls' }).catch(() => null)))
  state.slow = false
  expect(kv.isRedisMarkedDown()).toBe(true)
  // While down: Redis is skipped and production BLS fails closed (no blind upstream spend)
  const before = fetches
  await expect(kv.getCachedOrFetch('cold', 100, f, { budget: 'bls' })).rejects.toThrow()
  expect(fetches).toBe(before)
})

test('a successful GET resets the failure count', async () => {
  const store = new Map<string, unknown>([[kv.nsKey('a'), env()], [kv.nsKey('b'), env()]])
  const state = { slow: true }
  kv.__setKvClientForTests(slowGetClient(store, state))
  kv.configureRedisTimeouts({ callTimeoutMs: 20 })
  const f = async () => ({ x: 9 })
  await kv.getCachedOrFetch('a', 100, f).catch(() => null)
  await kv.getCachedOrFetch('a', 100, f).catch(() => null)
  state.slow = false
  const ok = await kv.getCachedOrFetch('b', 100, f)
  expect(ok.cacheHit).toBe(true)
  state.slow = true
  await kv.getCachedOrFetch('a', 100, f).catch(() => null)
  expect(kv.isRedisMarkedDown()).toBe(false)
})
