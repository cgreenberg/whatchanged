import { server } from '../mocks/server'
import { blsFixtureFor } from '../mocks/handlers'
import {
  clearMemCache,
  getCachedEnvelope,
  getCachedOrFetch,
  lastGoodKey,
  tryAcquireUpstream,
  budgetKey,
  writeEnvelope,
  BudgetExceededError,
  dailyBudget,
  __setKvClientForTests,
  type KvClient,
} from '@/lib/cache/kv'
import {
  planRefresh,
  runRefresh,
  summarize,
  BLS_MAX_SERIES_PER_REQUEST,
  type RefreshDeps,
} from '@/lib/api/refresh'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { lookupZip } from '@/lib/data/zip-lookup'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import { getGasLookup, buildSeriesFromData, type EiaRawPoint } from '@/lib/api/eia'
import { NATIONAL_GAS_LOOKUP } from '@/lib/api/cached-sources'
import { cpiCacheKey } from '@/lib/api/bls-cpi'
import eiaFixture from '../fixtures/eia-gas.json'

// Zips covering: metro CPI + EIA city (10001), state gas (98683), PADD gas +
// division CPI (04101), CT planning region (06902), PR municipio (00601),
// Cleveland county override (44113), Hawaii (96813).
const SAMPLE_ZIPS = ['10001', '98683', '04101', '06902', '00601', '44113', '96813']

function runtimeKeysFor(zip: string): string[] {
  const loc = lookupZip(zip)!
  const area = getMetroCpiAreaForCounty(loc.countyFips, loc.stateAbbr)
  return [
    cpiCacheKey(area.areaCode),
    getGasLookup(loc.stateAbbr, area.areaCode, loc.countyFips).cacheKey,
    NATIONAL_GAS_LOOKUP.cacheKey,
  ]
}

const fastOpts = { blsPauseMs: 0, backoffMs: 0 }

function countUpstreamCalls() {
  const calls = { bls: 0, eia: 0 }
  server.events.on('request:start', ({ request }) => {
    if (request.url.includes('api.bls.gov')) calls.bls++
    if (request.url.includes('api.eia.gov')) calls.eia++
  })
  return calls
}

afterEach(() => {
  server.events.removeAllListeners()
  __setKvClientForTests(undefined)
  delete process.env.BLS_RUNTIME_DAILY_BUDGET
  delete process.env.EIA_RUNTIME_DAILY_BUDGET
})

describe('planRefresh', () => {
  const plan = planRefresh()

  test('plans prices only: no county unemployment (LAUS) targets', () => {
    expect(plan).not.toHaveProperty('lausAreas')
    expect(Object.keys(plan).sort()).toEqual(['cpiAreas', 'gasLookups'])
  })

  test('covers every CPI area (23 metros + 9 divisions + national) and every gas series', () => {
    const codes = plan.cpiAreas.map((a) => a.areaCode)
    expect(codes).toContain('0000')
    expect(codes).toEqual(expect.arrayContaining(['S12A', 'S49G', '0110', '0490']))
    expect(codes.filter((c) => c.startsWith('S')).length).toBe(23)
    const gasAreas = plan.gasLookups.map((g) => g.duoarea)
    expect(gasAreas).toEqual(expect.arrayContaining(['NUS', 'YCLE', 'SWA', 'R1X', 'R1Y', 'R1Z', 'R20', 'R5XCA']))
    expect(plan.gasLookups.every((g) => g.cacheKey.startsWith('eia:gas:epmr:'))).toBe(true)
  })

  test('the plan includes every key the runtime can request for the sample zips', () => {
    const planned = new Set([
      ...plan.cpiAreas.map((a) => cpiCacheKey(a.areaCode)),
      ...plan.gasLookups.map((g) => g.cacheKey),
    ])
    for (const zip of SAMPLE_ZIPS) for (const key of runtimeKeysFor(zip)) expect(planned).toContain(key)
  })
})

describe('runRefresh — full plan with mocked upstreams', () => {
  test('batches ≤ 50 series per BLS request; reports call counts', async () => {
    const plan = planRefresh()
    const blsBatches: string[][] = []
    const deps: RefreshDeps = {
      fetchBls: async (ids) => {
        blsBatches.push(ids)
        return Object.fromEntries(ids.map((id) => [id, blsFixtureFor(id)]))
      },
      fetchGas: async () => buildSeriesFromData(eiaFixture.response.data as EiaRawPoint[]),
      write: async () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
    }
    const report = await runRefresh(plan, deps, fastOpts)
    const s = summarize(report)
    expect(blsBatches.every((b) => b.length <= BLS_MAX_SERIES_PER_REQUEST)).toBe(true)
    expect(blsBatches.every((b) => new Set(b).size === b.length)).toBe(true)
    const expectedCalls = Math.ceil((plan.cpiAreas.length - 1) / 15)
    expect(s.blsCalls).toBe(expectedCalls)
    expect(s.blsCalls).toBe(3) // 32 local CPI areas (+ national) → 3 BLS requests per full refresh
    expect(blsBatches.flat().some((id) => id.startsWith('LAU') || id.startsWith('LNU'))).toBe(false)
    expect(s.eiaCalls).toBe(plan.gasLookups.length)
    expect(s.errors).toBe(0)
    expect(s.written).toBe(plan.cpiAreas.length + plan.gasLookups.length)
  })

  test('a failing BLS batch is retried with backoff, then reported as errors (no writes)', async () => {
    const plan = {
      cpiAreas: [
        { areaCode: '0490', areaName: 'Pacific', tier: 2 as const },
        { areaCode: '0480', areaName: 'Mountain', tier: 2 as const },
      ],
      gasLookups: [],
    }
    let calls = 0
    const writes: string[] = []
    const report = await runRefresh(
      plan,
      {
        fetchBls: async () => {
          calls++
          throw new Error('BLS API error: 503')
        },
        fetchGas: async () => {
          throw new Error('unused')
        },
        write: async (key) => {
          writes.push(key)
        },
        sleep: async () => undefined,
        log: () => undefined,
      },
      { ...fastOpts, retries: 2 }
    )
    expect(calls).toBe(3)
    expect(report.blsCalls).toBe(3)
    expect(summarize(report).errors).toBe(2)
    expect(writes).toEqual([])
  })

  test('a BLS daily-threshold error halts further BLS requests', async () => {
    const plan = planRefresh() // 3 CPI batches
    let calls = 0
    const report = await runRefresh(
      plan,
      {
        fetchBls: async () => {
          calls++
          throw new Error('BLS refresh API failed: daily threshold for total number of requests allocated has been reached')
        },
        fetchGas: async () => buildSeriesFromData(eiaFixture.response.data as EiaRawPoint[]),
        write: async () => undefined,
        sleep: async () => undefined,
        log: () => undefined,
      },
      fastOpts
    )
    expect(calls).toBe(1)
    expect(report.blsCalls).toBe(1)
  })
})

describe('refresh and runtime produce identical keys and envelopes', () => {
  beforeEach(() => clearMemCache())

  test.each(SAMPLE_ZIPS)('zip %s', async (zip) => {
    const keys = runtimeKeysFor(zip)

    // 1. Refresh path (real fetch/parse via MSW mocks), writing to the in-memory cache
    const report = await runRefresh(planRefresh([zip]), undefined, fastOpts)
    expect(summarize(report).errors).toBe(0)
    const refreshed = new Map<string, unknown>()
    for (const key of keys) {
      const env = await getCachedEnvelope<unknown>(key)
      expect(env).not.toBeNull()
      expect(await getCachedEnvelope<unknown>(lastGoodKey(key))).toEqual(env)
      refreshed.set(key, env)
    }

    // 2. A request served after the refresh makes no upstream calls
    const calls = countUpstreamCalls()
    const warm = await fetchSnapshot(zip)
    expect(calls).toEqual({ bls: 0, eia: 0 })
    expect(warm!.cacheStatus).toMatchObject({ cpi: 'hit', gas: 'hit' })

    // 3. Runtime path from a cold cache writes the same keys with the same envelope shape + data
    clearMemCache()
    await fetchSnapshot(zip)
    for (const key of keys) {
      const env = await getCachedEnvelope<unknown>(key)
      const ref = refreshed.get(key) as { __v: number; data: unknown }
      expect(env).not.toBeNull()
      expect(Object.keys(env!).sort()).toEqual(Object.keys(ref).sort())
      expect(env!.__v).toBe(ref.__v)
      expect(env!.data).toEqual(ref.data)
    }
  })
})

describe('runtime upstream budget', () => {
  beforeEach(() => clearMemCache())

  test('daily counter caps upstream calls (key budget:{source}:{YYYY-MM-DD})', async () => {
    process.env.BLS_RUNTIME_DAILY_BUDGET = '3'
    const now = new Date('2026-10-02T12:00:00Z')
    expect(budgetKey('bls', now)).toBe('budget:bls:2026-10-02')
    const results = []
    for (let i = 0; i < 5; i++) results.push(await tryAcquireUpstream('bls', now))
    expect(results).toEqual([true, true, true, false, false])
    // EIA has its own counter
    expect(await tryAcquireUpstream('eia', now)).toBe(true)
  })

  /** Exhaust the BLS budget: cap 1, already spent. */
  async function exhaustBls() {
    process.env.BLS_RUNTIME_DAILY_BUDGET = '1'
    expect(await tryAcquireUpstream('bls')).toBe(true)
  }

  test('empty, zero, negative or malformed budget env → default (never silently disables fetches)', async () => {
    for (const v of ['', '  ', '0', '-5', 'abc', '2.5']) {
      process.env.BLS_RUNTIME_DAILY_BUDGET = v
      expect(dailyBudget('bls')).toBe(60)
    }
    process.env.BLS_RUNTIME_DAILY_BUDGET = '7'
    expect(dailyBudget('bls')).toBe(7)
  })

  test('over budget: serves last-good if present, else BudgetExceededError — never fetches', async () => {
    await exhaustBls()
    const fetchFn = jest.fn(async () => 'fresh')
    await writeEnvelope('k:with-lastgood', 'old', 1)
    await new Promise((r) => setTimeout(r, 1100)) // primary key expires, last-good remains
    const r = await getCachedOrFetch('k:with-lastgood', 60, fetchFn, { budget: 'bls' })
    expect(r).toMatchObject({ data: 'old', stale: true })
    await expect(getCachedOrFetch('k:none', 60, fetchFn, { budget: 'bls' })).rejects.toBeInstanceOf(BudgetExceededError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('budget exhausted → uncached zip makes zero BLS calls, sources "Data unavailable"', async () => {
    await exhaustBls()
    const calls = countUpstreamCalls()
    const snapshot = await fetchSnapshot('98683')
    expect(calls.bls).toBe(0)
    expect(snapshot!.cpi.data).toBeNull()
    expect(snapshot!.cpi.error).toBe('Data unavailable')
    expect(snapshot!.gas.data).not.toBeNull() // EIA budget separate
  })

  test('Redis unreachable → in-process circuit breaker caps BLS calls per hour', async () => {
    const down = () => Promise.reject(new Error('ECONNREFUSED'))
    const brokenRedis: KvClient = { get: down, set: down, del: down, incr: down, expire: down }
    __setKvClientForTests(brokenRedis)
    const fetchFn = jest.fn(async () => 'x')
    let ok = 0
    for (let i = 0; i < 20; i++) {
      try {
        await getCachedOrFetch(`bls:cpi:test${i}:all`, 60, fetchFn, { budget: 'bls' })
        ok++
      } catch (e) {
        expect(e).toBeInstanceOf(BudgetExceededError)
      }
    }
    expect(fetchFn).toHaveBeenCalledTimes(5)
    expect(ok).toBe(5)
  })
})
