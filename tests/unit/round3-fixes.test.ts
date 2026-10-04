// Regression tests for the round-3 review findings (Redis resilience, refresh
// markers/args, CPI month union, share-card sparkline geometry, labels).
import React from 'react'
import * as kv from '@/lib/cache/kv'
import { runRefresh, parseRefreshArgs, shouldSkipRecentRun, REFRESH_ATTEMPT_INTERVAL_MS, defaultRefreshDeps } from '@/lib/api/refresh'
import { parseCpiResponse, cpiSeriesIds, cpiCacheKey } from '@/lib/api/bls-cpi'
import { sparklineGeometry, buildLineSparklineV3 } from '@/lib/share-card/sparklines'
import {
  gasShortGeo,
  cpiShortGeo,
  usesNationalFallback,
  dataThroughLabel,
  gasCaveatFor,
  type HeroCardModel,
} from '@/lib/hero-cards'
import type { CpiData, GasPriceData } from '@/types'

const envelope = (data: unknown) => ({ __v: kv.CACHE_SCHEMA_VERSION, fetchedAt: new Date().toISOString(), data })

/** In-memory fake Upstash client; `mode` switches it between healthy, slow (> call timeout) and erroring. */
function fakeRedis() {
  const store = new Map<string, unknown>()
  const state = { mode: 'ok' as 'ok' | 'error', slowGets: 0, calls: [] as string[] }
  const gate = async () => {
    if (state.mode === 'error') throw new Error('ECONNRESET')
  }
  const client: kv.KvClient = {
    async get(k) {
      state.calls.push(`get ${k}`)
      if (state.slowGets > 0) {
        state.slowGets--
        await new Promise((r) => setTimeout(r, kv.REDIS_CALL_TIMEOUT_MS + 200))
      }
      await gate()
      return (store.get(k) ?? null) as never
    },
    async set(k, v, opts) {
      state.calls.push(`set ${k}${opts?.nx ? ' nx' : ''} ex=${opts?.ex}`)
      await gate()
      if (opts?.nx && store.has(k)) return null
      store.set(k, v)
      return 'OK'
    },
    async del(...ks) { await gate(); ks.forEach((k) => store.delete(k)); return ks.length },
    async incr(k) { state.calls.push(`incr ${k}`); await gate(); const n = Number(store.get(k) ?? 0) + 1; store.set(k, n); return n },
    async expire(k) { state.calls.push(`expire ${k}`); await gate(); return 1 },
  }
  return { client, store, state }
}

let errSpy: jest.SpyInstance
beforeEach(() => {
  kv.clearMemCache()
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  kv.__setKvClientForTests(undefined)
  kv.__resetRedisHealthForTests()
  delete process.env.VERCEL
  errSpy.mockRestore()
})

// ---------------------------------------------------------------- MED-1 Redis blip / outage

describe('Redis: one slow call is not an outage', () => {
  test('one slow get, then healthy → cached k2 served from Redis, zero upstream fetches, no BudgetExceededError', async () => {
    const { client, store, state } = fakeRedis()
    store.set(kv.nsKey('k1'), envelope({ x: 1 }))
    store.set(kv.nsKey('k2'), envelope({ x: 2 }))
    kv.__setKvClientForTests(client)

    state.slowGets = 1 // one latency spike (> REDIS_CALL_TIMEOUT_MS) on the first read
    await kv.getCachedOrFetch('k1', 100, async () => { throw new Error('upstream down') }, { budget: 'bls' }).catch(() => undefined)
    expect(kv.isRedisMarkedDown()).toBe(false)

    let fetches = 0
    const results: string[] = []
    for (let i = 0; i < 8; i++) {
      results.push(
        await kv
          .getCachedOrFetch('k2', 100, async () => { fetches++; return { x: 2 } }, { budget: 'bls' })
          .then((r) => `ok hit=${r.cacheHit} x=${(r.data as { x: number }).x}`, (e: Error) => `err ${e.name}`)
      )
    }
    expect(results).toEqual(Array(8).fill('ok hit=true x=2'))
    expect(fetches).toBe(0)
  }, 15000)

  test(`${kv.REDIS_DOWN_AFTER_FAILURES} consecutive failures mark Redis down; a success in between resets the count`, async () => {
    const { client, state } = fakeRedis()
    kv.__setKvClientForTests(client)
    state.mode = 'error'
    await expect(kv.getCached('a')).rejects.toThrow('ECONNRESET')
    await expect(kv.getCached('a')).rejects.toThrow('ECONNRESET')
    state.mode = 'ok'
    await kv.getCached('a')
    state.mode = 'error'
    await expect(kv.getCached('a')).rejects.toThrow('ECONNRESET')
    await expect(kv.getCached('a')).rejects.toThrow('ECONNRESET')
    expect(kv.isRedisMarkedDown()).toBe(false)
    await expect(kv.getCached('a')).rejects.toThrow('ECONNRESET')
    expect(kv.isRedisMarkedDown()).toBe(true)
    expect(kv.isRedisMarkedDown(Date.now() + kv.REDIS_DOWN_COOLDOWN_MS + 1)).toBe(false)
    expect(kv.REDIS_DOWN_COOLDOWN_MS).toBeLessThanOrEqual(5000)
  })

  test('Redis down → envelopes this instance already read are served from the in-process LRU, no upstream fetch', async () => {
    const { client, store, state } = fakeRedis()
    store.set(kv.nsKey('k'), envelope({ x: 7 }))
    kv.__setKvClientForTests(client)
    let fetches = 0
    const fetchFn = async () => { fetches++; return { x: 99 } }
    expect((await kv.getCachedOrFetch('k', 100, fetchFn, { budget: 'bls' })).data).toEqual({ x: 7 })

    state.mode = 'error'
    for (let i = 0; i < 5; i++) {
      const r = await kv.getCachedOrFetch('k', 100, fetchFn, { budget: 'bls' })
      expect(r.data).toEqual({ x: 7 })
      expect(r.cacheHit).toBe(true)
    }
    expect(kv.isRedisMarkedDown()).toBe(true)
    expect(fetches).toBe(0)
  })

  test('LRU respects the envelope TTL', async () => {
    const { client, store, state } = fakeRedis()
    const old = { __v: kv.CACHE_SCHEMA_VERSION, fetchedAt: new Date(Date.now() - 200_000).toISOString(), data: { x: 1 } }
    store.set(kv.nsKey('k'), old)
    kv.__setKvClientForTests(client)
    // Redis still has it (its own TTL is what Redis enforces); the LRU copy must not outlive ttlSeconds=100.
    await kv.getCachedOrFetch('k', 100, async () => ({ x: 2 }))
    state.mode = 'error'
    let fetches = 0
    await kv.getCachedOrFetch('k', 100, async () => { fetches++; return { x: 3 } })
    expect(fetches).toBe(1)
  })

  test('LRU is bounded', async () => {
    const { client, state } = fakeRedis()
    kv.__setKvClientForTests(client)
    // each write caches key + key:lastgood → after 500 writes the oldest keys are evicted
    for (let i = 0; i < kv.LRU_MAX_ENTRIES; i++) await kv.writeEnvelope(`w${i}`, { i }, 100)
    state.mode = 'error'
    let fetches = 0
    const fetchFn = async () => { fetches++; return { i: -1 } }
    expect((await kv.getCachedOrFetch(`w${kv.LRU_MAX_ENTRIES - 1}`, 100, fetchFn)).data).toEqual({ i: kv.LRU_MAX_ENTRIES - 1 })
    expect(fetches).toBe(0)
    expect((await kv.getCachedOrFetch('w0', 100, fetchFn)).data).toEqual({ i: -1 })
    expect(fetches).toBe(1)
  })

  test('production + Redis unreachable: no runtime BLS fetches (fail closed); EIA keeps the per-instance limiter', async () => {
    process.env.VERCEL = '1'
    const { client, state } = fakeRedis()
    kv.__setKvClientForTests(client)
    state.mode = 'error'
    let bls = 0
    await expect(
      kv.getCachedOrFetch('bls:cpi:X:all', 100, async () => { bls++; return {} }, { budget: 'bls' })
    ).rejects.toBeInstanceOf(kv.BudgetExceededError)
    expect(bls).toBe(0)
    expect(await kv.tryAcquireUpstream('bls')).toBe(false)
    expect(await kv.tryAcquireUpstream('eia')).toBe(true)
    expect(errSpy.mock.calls.filter((c) => String(c[0]).includes('fail closed')).length).toBe(1)
  })

  test('local dev + Redis unreachable: BLS still uses the per-instance breaker', async () => {
    const { client, state } = fakeRedis()
    kv.__setKvClientForTests(client)
    state.mode = 'error'
    const res = []
    for (let i = 0; i < 7; i++) res.push(await kv.tryAcquireUpstream('bls'))
    expect(res.filter(Boolean).length).toBe(kv.breakerPerHour('bls'))
  })
})

// ---------------------------------------------------------------- LOW2 atomic budget counter

test('budget counter is created with its TTL atomically (SET NX EX) before INCR; no separate EXPIRE', async () => {
  const { client, store, state } = fakeRedis()
  kv.__setKvClientForTests(client)
  const now = new Date('2026-10-02T12:00:00Z')
  expect(await kv.tryAcquireUpstream('bls', now)).toBe(true)
  expect(await kv.tryAcquireUpstream('bls', now)).toBe(true)
  const key = kv.nsKey(kv.budgetKey('bls', now))
  expect(state.calls).toEqual([`set ${key} nx ex=${2 * 86400}`, `incr ${key}`, `set ${key} nx ex=${2 * 86400}`, `incr ${key}`])
  expect(store.get(key)).toBe(2)
})

// ---------------------------------------------------------------- LOW3 known-missing markers

test('refresh marks areas with no upstream data; the runtime then skips the upstream fetch', async () => {
  const key = cpiCacheKey('0490')
  const report = await runRefresh(
    { cpiAreas: [{ areaCode: '0490', areaName: 'Pacific', tier: 2 }], gasLookups: [] },
    { ...defaultRefreshDeps, fetchBls: async () => ({}), sleep: async () => undefined, log: () => undefined },
    { blsPauseMs: 0 }
  )
  expect(report.results).toEqual([expect.objectContaining({ key, status: 'missing' })])
  expect(await kv.getCached(kv.missingKey(key))).toBe(true)

  let fetches = 0
  await expect(
    kv.getCachedOrFetch(key, 100, async () => { fetches++; return {} }, { budget: 'bls' })
  ).rejects.toThrow(/no upstream data at last refresh/)
  expect(fetches).toBe(0)

  // a later successful write clears the marker
  await kv.writeEnvelope(key, { ok: true }, 100)
  expect(await kv.getCached(kv.missingKey(key))).toBeNull()
})

// ---------------------------------------------------------------- LOW1 / security refresh guards

test('refresh CLI rejects unknown argument forms instead of running a full refresh', () => {
  for (const bad of [['--only', 'gas'], ['--zips', '98683'], ['--dryrun'], ['gas']]) {
    expect(parseRefreshArgs(bad)).toEqual({ error: expect.stringContaining('Unknown argument') })
  }
  expect(parseRefreshArgs(['--dry-run', '--only=cpi'])).toEqual({ dryRun: true, force: false, only: 'cpi' })
})

test('a full refresh started < 2h ago blocks another unforced run', () => {
  const now = new Date('2026-10-02T12:00:00Z')
  const started = new Date(now.getTime() - 30 * 60_000).toISOString()
  expect(shouldSkipRecentRun(started, now, false, REFRESH_ATTEMPT_INTERVAL_MS)).toBe(true)
  expect(shouldSkipRecentRun(started, now, true, REFRESH_ATTEMPT_INTERVAL_MS)).toBe(false)
  const old = new Date(now.getTime() - 3 * 3600_000).toISOString()
  expect(shouldSkipRecentRun(old, now, false, REFRESH_ATTEMPT_INTERVAL_MS)).toBe(false)
})

// ---------------------------------------------------------------- LOW4 CPI union of months

test('CPI points are the union of months: a groceries gap keeps the shelter months', () => {
  const ids = cpiSeriesIds('S48A')
  const pt = (y: number, m: number, v: number) => ({ year: String(y), period: `M${String(m).padStart(2, '0')}`, value: String(v) })
  const months = (from: number, to: number, base: number) => Array.from({ length: to - from + 1 }, (_, i) => pt(2026, from + i, base + i))
  const jan25 = (v: number) => pt(2025, 1, v)
  const d = parseCpiResponse(
    {
      [ids.groceries]: [jan25(300), pt(2026, 1, 310), pt(2026, 8, 312)], // gap Feb–Jul 2026
      [ids.shelter]: [jan25(400), ...months(1, 8, 410)],
    },
    { areaCode: 'S48A', areaName: 'Phoenix-Mesa-Scottsdale', tier: 1 }
  )
  const byDate = Object.fromEntries(d.series.map((p) => [p.date, p]))
  expect(byDate['2026-04']).toEqual({ date: '2026-04', groceries: null, shelter: 413 })
  expect(byDate['2026-08'].groceries).toBe(312)
  expect(d.series.filter((p) => p.shelter !== null).length).toBe(9)
  expect(d.series.map((p) => p.date)).toEqual([...d.series.map((p) => p.date)].sort())
  expect(d.groceriesLatestPeriod).toBe('2026-08')
})

// ---------------------------------------------------------------- MED1 sparkline label geometry

describe('share-card sparkline: y labels sit on the plotted values', () => {
  type El = React.ReactElement<{ style?: React.CSSProperties; children?: React.ReactNode }>
  const kids = (el: El) => React.Children.toArray(el.props.children) as El[]

  function renderedLabelCenters(values: number[], opts: { height?: number; bounds?: { min: number; max: number } }) {
    const el = buildLineSparklineV3(values, '#fff', 'g', { yMin: 'min', yMid: 'mid', yMax: 'max', xLeft: 'a', xMid: 'b', xRight: 'c', ...opts }) as El
    const [labelCol, chartCol] = kids(el)
    const [plotBox] = kids(chartCol)
    const centers = Object.fromEntries(
      kids(labelCol).map((s) => [String(s.props.children), Number(s.props.style!.top) + Number(s.props.style!.height) / 2])
    )
    return { centers, labelColHeight: labelCol.props.style!.height, plotHeight: plotBox.props.style!.height }
  }

  test.each([
    ['gas $/gal, no bounds', [3.1, 3.4, 2.9, 3.05, 3.3], { height: 146 }],
    ['groceries %, padded bounds', [0, 0.7, 1.2, 2.4, 3.1], { height: 170, bounds: { min: 0, max: 3.1 * 1.05 } }],
    ['shelter %, range spanning 0', [0, -0.3, 0.8, 1.9], { height: 170, bounds: { min: -0.3, max: 1.9 + 2.2 * 0.05 } }],
  ] as const)('%s', (_name, values, opts) => {
    const v: number[] = [...values]
    const geo = sparklineGeometry(v, opts)
    const { centers, labelColHeight, plotHeight } = renderedLabelCenters(v, opts)
    // label column is exactly as tall as the plot (excludes the x-axis row)
    expect(labelColHeight).toBe(geo.plotHeight)
    expect(plotHeight).toBe(geo.plotHeight)
    // each label's centre equals the plotted y of the value it names
    const yOf = (val: number) => (geo.toY(val) / 50) * geo.plotHeight
    expect(centers.max).toBeCloseTo(yOf(geo.maxVal), 6)
    expect(centers.mid).toBeCloseTo(yOf((geo.minVal + geo.maxVal) / 2), 6)
    expect(centers.min).toBeCloseTo(yOf(geo.minVal), 6)
    if (!('bounds' in opts)) {
      // no padding: max/min labels are level with the highest/lowest plotted points
      expect(centers.max).toBeCloseTo(geo.pointYs[v.indexOf(Math.max(...v))], 6)
      expect(centers.min).toBeCloseTo(geo.pointYs[v.indexOf(Math.min(...v))], 6)
    } else {
      // the baseline 0% point sits on the 0 label when the lower bound is 0
      if (opts.bounds.min === 0) expect(geo.pointYs[0]).toBeCloseTo(centers.min, 6)
    }
  })
})

// ---------------------------------------------------------------- MED2 / LOW3 / LOW5 / LOW6 labels

describe('geography + header labels', () => {
  const gas = (over: Partial<GasPriceData>): GasPriceData => ({
    current: 3, baseline: 3, change: 0, region: 'National avg', series: [], geoLevel: 'National avg', duoarea: 'NUS', isNationalFallback: true, ...over,
  })

  test('gas outage fallback (local series failed) says "local n/a"; a native national series does not', () => {
    expect(gasShortGeo(gas({ fallback: 'national' }))).toBe('U.S. avg; local n/a')
    expect(gasShortGeo(gas({}))).toBe('U.S. avg')
  })

  test('national fallbacks count as degraded (short cache)', () => {
    const snap = (g: GasPriceData | null, c: Partial<CpiData> | null) =>
      ({ gas: { data: g }, cpi: { data: c } }) as unknown as Parameters<typeof usesNationalFallback>[0]
    expect(usesNationalFallback(snap(gas({ fallback: 'national' }), null))).toBe(true)
    expect(usesNationalFallback(snap(null, { fallback: 'national' }))).toBe(true)
    expect(usesNationalFallback(snap(gas({}), {}))).toBe(false)
  })

  test('CPI division vs region short labels', () => {
    expect(cpiShortGeo({ metro: 'South Atlantic', tier: 2 } as CpiData)).toBe('South Atlantic div.')
    expect(cpiShortGeo({ metro: 'South Urban', tier: 3 } as CpiData)).toBe('South region')
  })

  test('header shows the span of the cards’ latest data months', () => {
    const c = (asOfPeriod: string, status: 'ok' | 'unavailable' = 'ok') => ({ status, asOfPeriod }) as HeroCardModel
    expect(dataThroughLabel([c('2026-09'), c('2026-08'), c('2026-08')])).toBe('AUG–SEP 2026')
    expect(dataThroughLabel([c('2026-09'), c('2026-09')])).toBe('SEP 2026')
    expect(dataThroughLabel([c('2026-01'), c('2025-12')])).toBe('DEC 2025–JAN 2026')
    expect(dataThroughLabel([c('2026-09'), c('2026-02', 'unavailable')])).toBe('SEP 2026')
    expect(dataThroughLabel([])).toBeNull()
  })

  test('gas caveats: HI/AK stand-in note (BLS), territories with only the U.S. average', () => {
    const s = (st: string, g: GasPriceData) => ({ location: { stateAbbr: st }, gas: { data: g } }) as unknown as Parameters<typeof gasCaveatFor>[0]
    expect(gasCaveatFor(s('HI', gas({ duoarea: undefined, source: 'bls', frequency: 'monthly', blsArea: 'S49F', areaName: 'Honolulu', standIn: true, isNationalFallback: false }))))
      .toBe('Honolulu-area price — no BLS or EIA series for this area; local prices are typically higher and may have changed differently.')
    // Inside the Honolulu CBSA: the metro's own series, no caveat
    expect(gasCaveatFor(s('HI', gas({ duoarea: undefined, source: 'bls', frequency: 'monthly', blsArea: 'S49F', areaName: 'Honolulu', isNationalFallback: false })))).toBeUndefined()
    expect(gasCaveatFor(s('HI', gas({ duoarea: 'R5XCA', isNationalFallback: false })))).toBeUndefined()
    expect(gasCaveatFor(s('PR', gas({})))).toMatch(/No EIA gas price series for Puerto Rico; showing the U.S. average/)
    expect(gasCaveatFor(s('TX', gas({ fallback: 'national' })))).toBeUndefined()
    expect(gasCaveatFor(s('WA', gas({ duoarea: 'SWA', isNationalFallback: false })))).toBeUndefined()
  })
})

// ---------------------------------------------------------------- Phoenix groceries gap on the share card

test('monthly sparkline axis is time-based: a Feb–Jul publication gap is a gap, bimonthly months are not', async () => {
  const { monthlyAxis } = await import('@/lib/share-card/generate')
  const dates = ['2025-01', '2025-02', '2025-03', '2026-01', '2026-08'].map((date) => ({ date }))
  const a = monthlyAxis(dates)
  expect(a.xFractions[0]).toBe(0)
  expect(a.xFractions[4]).toBe(1)
  expect(a.xFractions[3]).toBeCloseTo(12 / 19, 9)
  expect(a.gapAfter).toEqual([2, 3])
  expect(a.xMid).toBe("Nov '25")
  expect(monthlyAxis(['2025-01', '2025-03', '2025-05'].map((date) => ({ date }))).gapAfter).toEqual([])
})
