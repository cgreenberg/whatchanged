// Regression tests for the final review round (data accuracy, logic, security findings).
import {
  clearMemCache,
  getCached,
  tryAcquireUpstream,
  isRedisMarkedDown,
  __setKvClientForTests,
  __resetRedisHealthForTests,
  REDIS_CALL_TIMEOUT_MS,
  type KvClient,
} from '@/lib/cache/kv'
import { fetchSnapshot, isBlsPeriodStale, BLS_STALE_DAYS } from '@/lib/api/snapshot'
import {
  runRefresh,
  planRefresh,
  parseRefreshArgs,
  shouldSkipRecentRun,
  planSize,
  REFRESH_MIN_INTERVAL_MS,
  type RefreshDeps,
} from '@/lib/api/refresh'
import {
  buildGasCard,
  buildShelterCard,
  buildRentCard,
  buildHeroCards,
  shortCountyName,
  imageCountyName,
  cpiShortGeo,
  gasShortGeo,
  HI_AK_STANDIN_GAS_NOTE,
} from '@/lib/hero-cards'
import { cpiGeoLabel } from '@/lib/provenance'
import { getCountyRent } from '@/lib/rent'
import { firstParam } from '@/lib/share-url'
import { moversFor, timelineMonths, type CountyMap } from '@/lib/county-data'
import { filterByTimeframe } from '@/lib/charts/chart-data'
import { chartConfigs as CHART_CONFIGS } from '@/lib/charts/chart-config'
import type { EconomicSnapshot, CpiData, GasPriceData } from '@/types'
import austin from '../fixtures/snapshots/78701.json'
import { blsGasData } from '../mocks/bls-gas-data'

const snap = (): EconomicSnapshot => JSON.parse(JSON.stringify(austin))

afterEach(() => {
  __setKvClientForTests(undefined)
  __resetRedisHealthForTests()
  delete process.env.VERCEL
  delete process.env.BLS_RUNTIME_DAILY_BUDGET
})

// ---------------------------------------------------------------- Redis resilience (logic #1, security)

describe('Redis: timeouts, cool-down, fail-closed', () => {
  beforeEach(() => clearMemCache())

  test('a hanging Redis does not hang /api/data: snapshot returns within ~3s, with data', async () => {
    let calls = 0
    const hang = () => {
      calls++
      return new Promise<never>(() => {})
    }
    const hangingRedis: KvClient = { get: hang, set: hang, del: hang, incr: hang, expire: hang }
    __setKvClientForTests(hangingRedis)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const t0 = Date.now()
    const s = await fetchSnapshot('98683')
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(3000)
    // upstream fetched through the in-process breaker
    expect(s!.cpi.data).not.toBeNull()
    expect(s!.gas.data).not.toBeNull()
    expect(isRedisMarkedDown()).toBe(true)

    // Within the cool-down, Redis is skipped entirely: no new Redis calls, fast response.
    const before = calls
    const t1 = Date.now()
    await fetchSnapshot('98683')
    expect(Date.now() - t1).toBeLessThan(REDIS_CALL_TIMEOUT_MS)
    expect(calls).toBe(before)
    ;(console.error as jest.Mock).mockRestore()
  }, 10000)

  test('3 consecutive Redis failures mark Redis down; later calls fail fast without touching the client', async () => {
    const get = jest.fn(() => Promise.reject(new Error('ECONNRESET')))
    const fail = () => Promise.reject(new Error('ECONNRESET'))
    __setKvClientForTests({ get, set: fail, del: fail, incr: fail, expire: fail } as unknown as KvClient)
    jest.spyOn(console, 'error').mockImplementation(() => {})
    for (const k of ['a', 'b', 'c']) await expect(getCached(k)).rejects.toThrow('ECONNRESET')
    await expect(getCached('d')).rejects.toThrow(/Redis unavailable/)
    expect(get).toHaveBeenCalledTimes(3)
    // the budget counter falls back to the in-process breaker (5 BLS calls/hour)
    const res = []
    for (let i = 0; i < 7; i++) res.push(await tryAcquireUpstream('bls'))
    expect(res.filter(Boolean).length).toBe(5)
    ;(console.error as jest.Mock).mockRestore()
  })

  test('Upstash client: 1 quick retry and an abort signal per request', () => {
    jest.isolateModules(() => {
      const Redis = jest.fn()
      jest.doMock('@upstash/redis', () => ({ Redis }))
      const env = { ...process.env }
      Object.assign(process.env, { NODE_ENV: 'development', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't' })
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const kv = require('@/lib/cache/kv') as typeof import('@/lib/cache/kv')
        expect(kv.isRedisConfigured()).toBe(true)
      } finally {
        process.env = env
      }
      const opts = Redis.mock.calls[0][0]
      expect(opts.retry.retries).toBe(1)
      expect(opts.retry.backoff(0)).toBe(50)
      const signal = opts.signal()
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)
    })
  })

  test('production without KV_* env: BLS runtime fetches fail closed (EIA still allowed), logged once', async () => {
    process.env.VERCEL = '1'
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(await tryAcquireUpstream('bls')).toBe(false)
    expect(await tryAcquireUpstream('bls')).toBe(false)
    expect(await tryAcquireUpstream('eia')).toBe(true)
    expect(err.mock.calls.filter(c => String(c[0]).includes('fail closed')).length).toBe(1)
    err.mockRestore()
  })
})

// ---------------------------------------------------------------- BLS staleness (logic #3)

describe('BLS data-age staleness', () => {
  const now = new Date('2026-10-02T12:00:00Z')
  test(`latest month ended more than ${BLS_STALE_DAYS} days ago → stale`, () => {
    expect(isBlsPeriodStale('2026-08', now)).toBe(false) // ended Aug 31: 32 days
    expect(isBlsPeriodStale('2026-07', now)).toBe(false) // ended Jul 31: 63 days
    expect(isBlsPeriodStale('2026-06', now)).toBe(true) // ended Jun 30: 94 days
    expect(isBlsPeriodStale(undefined, now)).toBe(false)
    expect(isBlsPeriodStale('garbage', now)).toBe(false)
  })

  test('snapshot marks CPI stale when the recorded data stops moving', async () => {
    clearMemCache()
    jest.useFakeTimers({ now: new Date('2030-01-15T00:00:00Z'), doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] })
    try {
      const s = await fetchSnapshot('98683')
      expect(s!.cpi.data).not.toBeNull()
      expect(s!.cpi.stale).toBe(true)
      expect(buildHeroCards(s!).find(c => c.id === 'groceries')!.stale).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------- Refresh safety (security)

describe('refresh-cache safety', () => {
  test('a full run within 12h of a success is skipped unless forced', () => {
    const now = new Date('2026-10-02T15:00:00Z')
    const recent = new Date(now.getTime() - 2 * 3600_000).toISOString()
    const old = new Date(now.getTime() - REFRESH_MIN_INTERVAL_MS - 1000).toISOString()
    expect(shouldSkipRecentRun(recent, now, false)).toBe(true)
    expect(shouldSkipRecentRun(recent, now, true)).toBe(false)
    expect(shouldSkipRecentRun(old, now, false)).toBe(false)
    expect(shouldSkipRecentRun(null, now, false)).toBe(false)
    expect(shouldSkipRecentRun('not a date', now, false)).toBe(false)
  })

  test('--only / --zips are validated (bad values are errors, not empty plans)', () => {
    expect(parseRefreshArgs(['--only=foo'])).toEqual({ error: expect.stringContaining('--only') })
    expect(parseRefreshArgs(['--zips=abc'])).toEqual({ error: expect.stringContaining('malformed') })
    expect(parseRefreshArgs(['--zips='])).toEqual({ error: expect.stringContaining('empty') })
    expect(parseRefreshArgs(['--zips=00000'])).toEqual({ error: expect.stringContaining('no known zip') })
    expect(parseRefreshArgs(['--only=gas', '--zips=98683,10001', '--force'])).toEqual({
      dryRun: false, force: true, only: 'gas', zips: ['98683', '10001'],
    })
    expect(planSize({ cpiAreas: [], gasLookups: [] })).toBe(0)
  })

  test('BLS retries default to 2 (3 attempts per batch at most)', async () => {
    const plan = planRefresh(['98683'])
    let blsCalls = 0
    const deps: RefreshDeps = {
      fetchBls: async () => { blsCalls++; throw new Error('HTTP 503') },
      fetchGas: async () => { throw new Error('skip') },
      write: async () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
    }
    const report = await runRefresh({ ...plan, gasLookups: [] }, deps, { blsPauseMs: 0, backoffMs: 0 })
    const batches = report.failedBatches
    expect(batches).toBeGreaterThan(0)
    expect(blsCalls).toBe(batches * 3)
  })
})

// ---------------------------------------------------------------- Geography tags / outliers / caveats (data #1–#7)

describe('hero-card geography tags and caveats', () => {
  test('short geography names', () => {
    expect(shortCountyName('Buncombe County, NC')).toBe('Buncombe Co.')
    // Text (website, og:description): full county-equivalent types; only "County" is shortened
    expect(shortCountyName('Calcasieu Parish, LA')).toBe('Calcasieu Parish')
    expect(shortCountyName('Fairbanks North Star Borough, AK')).toBe('Fairbanks North Star Borough')
    expect(shortCountyName('Yukon-Koyukuk Census Area, AK')).toBe('Yukon-Koyukuk Census Area')
    expect(shortCountyName('Anchorage Municipality, AK')).toBe('Anchorage Municipality')
    expect(shortCountyName('Juneau City and Borough, AK')).toBe('Juneau City and Borough')
    // Images (share card, OG): abbreviated, never "C.A." (reads as California); "Parish" when it fits
    expect(imageCountyName('Buncombe County, NC')).toBe('Buncombe Co.')
    expect(imageCountyName('Bethel Census Area, AK')).toBe('Bethel area')
    expect(imageCountyName('Fairbanks North Star Borough, AK')).toBe('Fairbanks North Star Bor.')
    expect(imageCountyName('Juneau City and Borough, AK')).toBe('Juneau Bor.')
    expect(imageCountyName('Anchorage Municipality, AK')).toBe('Anchorage Muni.')
    expect(imageCountyName('Lafayette Parish, LA')).toBe('Lafayette Parish')
    expect(imageCountyName('St. John the Baptist Parish', (t) => t.length <= 25)).toBe('St. John the Baptist Par.')
    const cpi = (o: Partial<CpiData>) => ({ ...snap().cpi.data!, ...o }) as CpiData
    expect(cpiShortGeo(cpi({ tier: 2, metro: 'South Atlantic', areaCode: '0350' }))).toBe('South Atlantic div.')
    expect(cpiShortGeo(cpi({ tier: 1, metro: 'Chicago-Naperville-Elgin', areaCode: 'S23A' }))).toBe('Chicago metro')
    expect(cpiShortGeo(cpi({ tier: 1, metro: 'Urban Hawaii', areaCode: 'S49F' }))).toBe('Honolulu metro')
    expect(cpiShortGeo(cpi({ tier: 1, metro: 'Urban Alaska', areaCode: 'S49G' }))).toBe('Anchorage metro')
    expect(cpiShortGeo(cpi({ tier: 1, metro: 'Urban Hawaii' }))).toBe('Honolulu metro') // older payload without areaCode
    // never cut a CBSA title at the first hyphen ("Washington metro" would read as Washington State)
    expect(cpiShortGeo(cpi({ tier: 1, metro: 'Washington-Arlington-Alexandria', areaCode: 'S35A' }))).toBe('Washington DC metro')
    expect(cpiShortGeo(cpi({ tier: 1, metro: 'Washington-Arlington-Alexandria' }))).toBe('Washington DC metro')
    expect(cpiShortGeo(cpi({ tier: 1, metro: 'Dallas-Fort Worth-Arlington', areaCode: 'S37A' }))).toBe('Dallas-Fort Worth metro')
    expect(cpiShortGeo(cpi({ tier: 3, metro: 'South Urban', areaCode: '0300' }))).toBe('South region')
    expect(cpiShortGeo(cpi({ tier: 4, metro: 'National', areaCode: '0000' }))).toBe('U.S. avg')
    expect(cpiShortGeo(cpi({ fallback: 'national' }))).toBe('U.S. avg; local n/a')
    const gas = (o: Partial<GasPriceData>) => ({ ...snap().gas.data!, ...o }) as GasPriceData
    expect(gasShortGeo(gas({ geoLevel: 'Lower Atlantic (PADD 1C) avg', duoarea: 'R1Z' }))).toBe('Lower Atlantic avg')
    expect(gasShortGeo(gas({ geoLevel: 'West Coast excl. California (PADD 5) avg', duoarea: 'R5XCA' }))).toBe('West Coast excl. CA avg')
    // Native national series only for territories / unknown state; for a state with its own EIA
    // series (this fixture is Austin, TX) NUS is an outage stand-in even without `fallback: 'national'`.
    const nus = gas({ isNationalFallback: true, duoarea: 'NUS', geoLevel: 'National avg' })
    expect(gasShortGeo(nus, 'PR')).toBe('U.S. avg')
    expect(gasShortGeo(nus)).toBe('U.S. avg')
    expect(gasShortGeo(nus, snap().location.stateAbbr)).toBe('U.S. avg; local n/a')
    expect(gasShortGeo({ ...nus, fallback: 'national' }, 'PR')).toBe('U.S. avg; local n/a')
  })

  test('CPI national fallback is labeled "national (local data unavailable)"', () => {
    const c = { ...snap().cpi.data!, fallback: 'national' as const, tier: 4 as const }
    expect(cpiGeoLabel(c)).toBe('national (local data unavailable)')
  })

  test('electricity geography tag is the state (DC short)', () => {
    const s = snap()
    expect(buildHeroCards(s).find(c => c.id === 'electricity')!.geoTag).toBe('Texas')
    s.electricity.data = { ...s.electricity.data!, state: 'DC', stateName: 'District of Columbia' }
    expect(buildHeroCards(s).find(c => c.id === 'electricity')!.geoTag).toBe('DC')
  })

  test('Hawaii/Alaska gas: Honolulu/Anchorage metro label in the CBSA, an honest stand-in note outside; other states get none', () => {
    const s = snap()
    s.location = { ...s.location, stateAbbr: 'HI', countyFips: '15003', countyName: 'Honolulu County' }
    s.gas.data = blsGasData('S49F')
    expect(buildGasCard(s).caveat).toBeUndefined()
    expect(buildGasCard(s).geoTag).toBe('Honolulu metro')
    s.location = { ...s.location, countyFips: '15007', countyName: 'Kauai County' }
    s.gas.data = blsGasData('S49F', { standIn: true })
    const card = buildGasCard(s)
    expect(card.caveat).toBe(HI_AK_STANDIN_GAS_NOTE('Honolulu', 'Kauai County'))
    expect(card.caveat).toBe('Honolulu-area price — no BLS or EIA series for Kauai County; local prices are typically higher and may have changed differently.')
    expect(card.geoTag).toBe('Honolulu-area price*')
    s.location = { ...s.location, stateAbbr: 'AK', countyFips: '02110', countyName: 'Juneau City and Borough' }
    s.gas.data = blsGasData('S49G', { standIn: true })
    expect(buildGasCard(s).caveat).toBe('Anchorage-area price — no BLS or EIA series for Juneau City and Borough; local prices are typically higher and may have changed differently.')
    s.location = { ...s.location, stateAbbr: 'PA' }
    s.gas.data = blsGasData('S12B')
    expect(buildGasCard(s).caveat).toBeUndefined()
    s.location = { ...s.location, stateAbbr: 'NV' }
    s.gas.data = { ...snap().gas.data!, duoarea: 'R5XCA', geoLevel: 'West Coast excl. California (PADD 5) avg' }
    expect(buildGasCard(s).caveat).toBeUndefined()
  })


  test('bundled county rent carries outlier flags (Taylor Co., TX) → card caveat without the client shard', () => {
    const r = getCountyRent('48441')
    expect(r?.flagged).toBe(true)
    expect(getCountyRent('48453')?.flagged).toBeUndefined() // Travis: not flagged
    const s = snap()
    s.rent = r
    const card = buildRentCard(s)!
    expect(card.outlier).toBe(true)
    expect(card.caveat).toMatch(/^Unusual value/)
    expect(card.geoTag).toBe('Taylor Co.')
  })

  test('PR-style national CPI: no shelter dollars on local rent, and the detail says why', () => {
    const s = snap()
    s.rent = null
    s.cpi.data = { ...s.cpi.data!, tier: 4, metro: 'National', areaCode: '0000' }
    const card = buildShelterCard(s)
    expect(card.change).toBeUndefined()
    expect(card.detail).toMatch(/national figure/)
    expect(card.detail).not.toMatch(/No local rent figure/)
    s.cpi.data = { ...s.cpi.data!, tier: 2, metro: 'West South Central', areaCode: '0370', fallback: 'national' }
    expect(buildShelterCard(s).detail).toMatch(/local shelter CPI is unavailable/)
  })

  test('snapshot for 00601 (Puerto Rico, national CPI only): shelter dollar figure is null', async () => {
    clearMemCache()
    const s = await fetchSnapshot('00601')
    expect(s!.cpi.data?.tier).toBe(4)
    expect(s!.dollarImpact?.shelter ?? null).toBeNull()
    expect(s!.dollarImpact).toBeDefined()
  })

  test('the Energy (CPI) graph is gone; the Electricity graph says what its two lines are', () => {
    expect(CHART_CONFIGS.find(c => c.id === 'cpi-energy')).toBeUndefined()
    const elec = CHART_CONFIGS.find(c => c.id === 'electricity')!
    expect(elec.description).toMatch(/residential electricity price/)
    expect(elec.description).toMatch(/average of the latest 12 monthly prices/)
    expect(elec.series.map(x => x.dataKey)).toEqual(['avg12', 'price'])
  })
})

// ---------------------------------------------------------------- Misc logic / security lows

describe('misc', () => {
  test('firstParam normalizes string | string[]', () => {
    expect(firstParam(['a', 'b'])).toBe('a')
    expect(firstParam('x')).toBe('x')
    expect(firstParam(undefined)).toBeUndefined()
    expect(firstParam([])).toBeUndefined()
  })

  test('/api/city-search responses are CDN-cacheable', async () => {
    const { GET } = await import('@/app/api/city-search/route')
    const { NextRequest } = await import('next/server')
    for (const q of ['portland', 'p']) {
      const res = await GET(new NextRequest(`http://x/api/city-search?q=${q}`))
      expect(res.headers.get('Cache-Control')).toMatch(/s-maxage=\d+/)
    }
  })

  test('rent movers exclude counties flagged on rent', () => {
    const row = (rent: number, flags?: string[]) => ({ n: 'x', rent, emp: 100000, ...(flags ? { flags } : {}) })
    const data: CountyMap = {
      '00001': row(9, ['rent']),
      '00002': row(5),
      '00003': row(4),
      '00004': row(-3),
      '00005': row(-4),
      '00006': row(-9, ['rent']),
    }
    const { top, bottom } = moversFor(data, 'rent', 2)
    const ids = [...top, ...bottom].map(([f]) => f)
    expect(ids).not.toContain('00001')
    expect(ids).not.toContain('00006')
  })

  test('time-lapse uses rentMonths for rent when present', () => {
    expect(timelineMonths({ months: ['2025-01', '2025-02'], rentMonths: ['2025-01'] }, 'rent')).toEqual(['2025-01'])
    expect(timelineMonths({ months: ['2025-01', '2025-02'], rentMonths: ['2025-01'] }, 'hv')).toEqual(['2025-01', '2025-02'])
    expect(timelineMonths({ months: ['2025-01'] }, 'rent')).toEqual(['2025-01'])
  })

  test('weekly gas without a baseline week never uses the monthly baseline rule', () => {
    const weekly = [
      { date: '2025-01-27', price: 3.1 },
      { date: '2025-02-03', price: 3.2 },
    ]
    expect(filterByTimeframe(weekly, 'Jan 2025', true, 'price')).toEqual(weekly)
  })
})
