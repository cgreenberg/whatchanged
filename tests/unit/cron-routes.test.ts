import { server } from '../mocks/server'
import { clearMemCache } from '@/lib/cache/kv'
import { GET as healthGET } from '@/app/api/health/route'
import { isCronAuthorized } from '@/lib/api/cron-auth'

const SECRET = 'test-cron-secret'

function req(url: string, auth?: string) {
  return new Request(url, { headers: auth ? { authorization: auth } : {} })
}

function countUpstreamCalls() {
  const calls = { bls: 0, eia: 0 }
  server.events.on('request:start', ({ request }) => {
    if (request.url.includes('api.bls.gov')) calls.bls++
    if (request.url.includes('api.eia.gov')) calls.eia++
  })
  return calls
}

describe('cron auth', () => {
  const original = process.env.CRON_SECRET
  afterEach(() => {
    process.env.CRON_SECRET = original
  })

  test('requires CRON_SECRET to be configured', () => {
    delete process.env.CRON_SECRET
    expect(isCronAuthorized(req('http://x/', 'Bearer '))).toBe(false)
    expect(isCronAuthorized(req('http://x/', 'Bearer undefined'))).toBe(false)
  })

  test('accepts only the exact bearer token', () => {
    process.env.CRON_SECRET = SECRET
    expect(isCronAuthorized(req('http://x/', `Bearer ${SECRET}`))).toBe(true)
    expect(isCronAuthorized(req('http://x/', `Bearer ${SECRET}x`))).toBe(false)
    expect(isCronAuthorized(req('http://x/', SECRET))).toBe(false)
    expect(isCronAuthorized(req('http://x/'))).toBe(false)
  })
})

describe('/api/health', () => {
  beforeEach(() => {
    clearMemCache()
    process.env.CRON_SECRET = SECRET
  })
  afterEach(() => {
    server.events.removeAllListeners()
    delete process.env.CRON_SECRET
  })

  test('public request is cache-only: no upstream calls', async () => {
    const calls = countUpstreamCalls()
    const res = await healthGET(req('http://localhost/api/health'))
    const body = await res.json()
    expect(calls).toEqual({ bls: 0, eia: 0 })
    expect(body.liveChecks).toMatch(/skipped/)
    expect(Array.isArray(body.cache.keys)).toBe(true)
    expect(body.cache.keys.every((k: { present: boolean }) => k.present === false)).toBe(true)
  })

  test('wrong token → still cache-only', async () => {
    const calls = countUpstreamCalls()
    await healthGET(req('http://localhost/api/health', 'Bearer nope'))
    expect(calls).toEqual({ bls: 0, eia: 0 })
  })

  test('valid CRON_SECRET → live checks run', async () => {
    const calls = countUpstreamCalls()
    const res = await healthGET(req('http://localhost/api/health', `Bearer ${SECRET}`))
    const body = await res.json()
    expect(calls.bls).toBeGreaterThan(0)
    expect(calls.eia).toBeGreaterThan(0)
    expect(body.live['bls-cpi'].status).toBe('ok')
    expect(body.live['eia-gas'].status).toBe('ok')
    expect(body.live).not.toHaveProperty('bls-laus')
  })
})
