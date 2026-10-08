/**
 * County map Gas / Groceries / Electricity layers: /api/map-metrics reads the cache ONLY (never
 * BLS/EIA, never the runtime budget), maps every county to its series through county-geo.json, and the
 * client turns that into per-county values with the area each number covers.
 */
import { server } from '../mocks/server'
import { clearMemCache, writeEnvelope, getCached, budgetKey, lastGoodKey, setCached, CACHE_SCHEMA_VERSION } from '@/lib/cache/kv'
import { buildMapMetrics, resetMapMetricsMemo } from '@/lib/api/map-metrics'
import { GET } from '@/app/api/map-metrics/route'
import { NextRequest } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { electricityCacheKey } from '@/lib/api/eia-electricity'
import { cpiCacheKey } from '@/lib/api/bls-cpi'
import countyGeo from '@/lib/data/county-geo.json'
import { lookupAkGas, akGasForCounty } from '@/lib/static-gas'
import { liveValue, liveFooter, LIVE_METRICS, MAP_METRIC_ORDER, isCountyMetric } from '@/lib/county-data'

function countUpstream() {
  const calls = { bls: 0, eia: 0 }
  server.events.on('request:start', ({ request }) => {
    if (request.url.includes('api.bls.gov')) calls.bls++
    if (request.url.includes('api.eia.gov')) calls.eia++
  })
  return calls
}

beforeEach(() => clearMemCache())
afterEach(() => server.events.removeAllListeners())

test('empty cache: every area is "no data", nothing is fetched and no budget is spent', async () => {
  const calls = countUpstream()
  const m = await buildMapMetrics()
  expect(calls).toEqual({ bls: 0, eia: 0 })
  expect(await getCached(budgetKey('bls'))).toBeNull()
  expect(await getCached(budgetKey('eia'))).toBeNull()
  // every cached gas area is "no data" (the bundled Alaska DCRA / Puerto Rico DACO areas never depend on the cache)
  expect(m.gas.filter((g) => g.source !== 'dcra' && g.source !== 'daco').every((g) => g.change === null)).toBe(true)
  expect(m.groceries.every((c) => c.pct === null)).toBe(true)
  expect(m.electricity).toEqual({})
  expect(m.missing).toBeGreaterThan(100)
  // every county in county-geo.json is mapped
  expect(Object.keys(m.counties)).toHaveLength(Object.keys(countyGeo).length)
})

test('values come from the same cache entries the cards use (warmed by real snapshots)', async () => {
  // Portland ME (PADD 1A gas, New England CPI division, Maine electricity) and Atlanta (BLS metro gas, Atlanta CPI)
  const me = (await fetchSnapshot('04101'))!
  const atl = (await fetchSnapshot('30303'))!
  const calls = countUpstream()
  const m = await buildMapMetrics()
  expect(calls).toEqual({ bls: 0, eia: 0 })

  // Cumberland County ME
  expect(liveValue(m, '23005', 'elec')).toMatchObject({ value: me.electricity.data!.change, area: 'Maine statewide' })
  expect(liveValue(m, '23005', 'gas')!.value).toBeCloseTo(me.gas.data!.change, 3)
  expect(liveValue(m, '23005', 'gas')!.area).toBe('New England (PADD 1A) avg')
  expect(liveValue(m, '23005', 'groceries')).toMatchObject({ value: Number(me.cpi.data!.groceriesChange.toFixed(2)), area: 'New England div.' })
  // Every Maine county shares the statewide value; every PADD 1A county the same gas value
  expect(liveValue(m, '23003', 'elec')!.value).toBe(me.electricity.data!.change)
  expect(liveValue(m, '50007', 'gas')!.value).toBe(liveValue(m, '23005', 'gas')!.value) // Chittenden VT
  // Fulton County GA: BLS monthly Atlanta gas, Atlanta CPI metro, Georgia electricity
  expect(liveValue(m, '13121', 'gas')).toMatchObject({ area: 'Atlanta-Sandy Springs-Roswell metro avg' })
  expect(liveValue(m, '13121', 'gas')!.value).toBeCloseTo(atl.gas.data!.change, 3)
  expect(liveValue(m, '13121', 'gas')!.detail).toMatch(/BLS monthly/)
  expect(liveValue(m, '13121', 'groceries')!.area).toBe('Atlanta metro')
  expect(liveValue(m, '13121', 'elec')!.area).toBe('Georgia statewide')
  // Not cached (e.g. Ohio) → null, shown as no data
  expect(liveValue(m, '39035', 'elec')).toBeNull()
  // Territories have no EIA electricity at all
  expect(liveValue(m, '72001', 'elec')).toBeNull()
})

test('HI/AK stand-in counties are labeled as such (same Honolulu value, not called local)', async () => {
  await fetchSnapshot('96813') // Honolulu: warms bls:gas:S49F
  const m = await buildMapMetrics()
  const honolulu = liveValue(m, '15003', 'gas')!
  const hilo = liveValue(m, '15001', 'gas')!
  expect(hilo.value).toBe(honolulu.value)
  expect(honolulu.area).toBe('Honolulu metro avg')
  expect(hilo.area).toMatch(/Honolulu-area price \(BLS\) \(no series for this county\)/)
})

test('Alaska outside Anchorage: the DCRA survey value the card uses, not the Anchorage stand-in', async () => {
  const calls = countUpstream()
  const m = await buildMapMetrics()
  expect(calls).toEqual({ bls: 0, eia: 0 })
  // Fairbanks North Star Borough: every zip resolves to the Fairbanks survey → exactly the card's figure
  const card = lookupAkGas('99701')
  expect(card.hit?.place).toBe('Fairbanks')
  const fbx = liveValue(m, '02090', 'gas')!
  expect(fbx.value).toBeCloseTo(card.hit!.data.change, 3)
  expect(fbx.area).toBe('Fairbanks survey price (Alaska DCRA)')
  expect(fbx.area).not.toMatch(/Anchorage|no series/)
  expect(fbx.detail).toMatch(/^\$\d+\.\d\d\/gal · Alaska DCRA survey \(twice yearly\), \w{3} \d{4} survey$/)
  expect(fbx.detail).toContain(`$${card.hit!.data.current.toFixed(2)}/gal`)
  // Bethel Census Area: many surveyed communities → their survey-by-survey median, labeled as such
  const bethel = akGasForCounty('02050', 'Bethel Census Area')!
  expect(bethel.match).toBe('median')
  expect(bethel.places.length).toBeGreaterThan(5)
  expect(bethel.data.change).toBeCloseTo(bethel.data.current - bethel.data.baseline, 3)
  const bv = liveValue(m, '02050', 'gas')!
  expect(bv.area).toBe(`Bethel Census Area: median of ${bethel.places.length} surveyed communities (Alaska DCRA)`)
  expect(bv.value).toBeCloseTo(bethel.data.change, 3)
  // Haines Borough: no surveyed community → the DCRA region average its zips fall back to (same as its card)
  const haines = liveValue(m, '02100', 'gas')!
  expect(haines.area).toBe('Southeast Alaska region avg (DCRA survey)')
  const hainesZip = Object.keys((await import('@/lib/data/ak-gas.json')).zips).find(
    (z) => (lookupAkGas(z).hit?.lookup.geoLevel ?? '') === haines.area,
  )!
  expect(haines.value).toBeCloseTo(lookupAkGas(hainesZip).hit!.data.change, 3)
  // Anchorage and Mat-Su keep the BLS Anchorage metro series (not cached here → no data); no AK borough is a stand-in
  expect(m.gas[m.counties['02020'][0]].id).toBe('b:S49G')
  const akStandIns = Object.keys(m.counties).filter((f) => f.startsWith('02') && m.gas[m.counties[f][0]].standIn)
  expect(akStandIns).toEqual([])
  // Static values are always present, so they never count as missing cache keys
  expect(m.gas.filter((g) => g.source === 'dcra').every((g) => g.change !== null)).toBe(true)
})

test('a last-good copy is used when the primary key expired; invalid data is ignored', async () => {
  await fetchSnapshot('04101')
  const key = electricityCacheKey('ME')
  const env = (await getCached<{ data: { change: number } }>(key))!
  await setCached(key, null, 60) // primary gone
  await setCached(lastGoodKey(key), env, 60)
  let m = await buildMapMetrics()
  expect(m.electricity.ME.pct).toBe(env.data.change)
  // out-of-range data is never shown
  await setCached(key, { __v: CACHE_SCHEMA_VERSION, fetchedAt: new Date().toISOString(), data: { ...env.data, change: 500 } }, 60)
  await setCached(lastGoodKey(key), null, 60)
  m = await buildMapMetrics()
  expect(m.electricity.ME).toBeUndefined()
})

const req = (url = 'https://www.whatchanged.us/api/map-metrics') => new NextRequest(url)

test('route: CDN-cached for an hour when complete, 5 minutes when any area is missing', async () => {
  resetMapMetricsMemo()
  let res = await GET(req())
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('public, s-maxage=300, stale-while-revalidate=300')
  // Write every key the map reads → complete → long cache
  const m0 = await buildMapMetrics()
  const elec = (await fetchSnapshot('04101'))!.electricity.data!
  const writes: Promise<unknown>[] = []
  const { ELECTRICITY_STATES } = await import('@/lib/api/eia-electricity')
  for (const st of ELECTRICITY_STATES) writes.push(writeEnvelope(electricityCacheKey(st), { ...elec, state: st }, 60))
  const cpi = (await fetchSnapshot('04101'))!.cpi.data!
  for (const c of m0.groceries) writes.push(writeEnvelope(cpiCacheKey(c.area), cpi, 60))
  const gas = (await fetchSnapshot('04101'))!.gas.data!
  const { describeDuoarea } = await import('@/lib/api/eia')
  const { describeBlsGasArea } = await import('@/lib/api/bls-gas')
  for (const g of m0.gas.filter((a) => a.source !== 'dcra' && a.source !== 'daco')) {
    const [src, code] = g.id.replace('*', '').split(':')
    const key = src === 'b' ? describeBlsGasArea(code).cacheKey : describeDuoarea(code).cacheKey
    writes.push(writeEnvelope(key, { ...gas, latestDate: gas.latestDate, baselineDate: gas.baselineDate, regionName: 'x' }, 60))
  }
  await Promise.all(writes)
  expect((await buildMapMetrics()).missing).toBe(0)
  // Memoized for 60 s: the route still serves the first (incomplete) build
  res = await GET(req())
  expect(res.headers.get('cache-control')).toBe('public, s-maxage=300, stale-while-revalidate=300')
  resetMapMetricsMemo()
  res = await GET(req())
  expect(res.headers.get('cache-control')).toBe('public, s-maxage=3600, stale-while-revalidate=86400')
})

test('route: a query string is redirected to the canonical path (never a CDN-bypassing rebuild)', async () => {
  resetMapMetricsMemo()
  const res = await GET(req('https://www.whatchanged.us/api/map-metrics?x=123'))
  expect(res.status).toBe(308)
  expect(res.headers.get('location')).toBe('https://www.whatchanged.us/api/map-metrics')
})

test('a last-good copy is marked stale, counted, and gets the short CDN lifetime', async () => {
  await fetchSnapshot('04101')
  const key = electricityCacheKey('ME')
  const env = (await getCached<{ data: { change: number } }>(key))!
  await setCached(key, null, 60)
  await setCached(lastGoodKey(key), env, 60)
  const m = await buildMapMetrics()
  expect(m.electricity.ME.stale).toBe(true)
  expect(m.stale).toBeGreaterThan(0)
})

test('Puerto Rico counties take the DACO island-wide series (the card\'s rung), not the U.S. average', async () => {
  const m = await buildMapMetrics()
  const g = m.gas[m.counties['72127'][0]]
  expect(g).toMatchObject({ id: 'p:PR', source: 'daco', frequency: 'monthly' })
  expect(g.change).not.toBeNull()
})

describe('client metric definitions', () => {
  test('chips: Gas | Rent | Home prices | Groceries | Electricity; only rent and home prices are county metrics', () => {
    expect(MAP_METRIC_ORDER).toEqual(['gas', 'rent', 'hv', 'groceries', 'elec'])
    expect(MAP_METRIC_ORDER.filter(isCountyMetric)).toEqual(['rent', 'hv'])
  })

  test('each regional metric explains why counties share a color', () => {
    const note = Object.fromEntries(LIVE_METRICS.map((d) => [d.key, d.scopeNote]))
    expect(note.gas).toMatch(/not by county/)
    expect(note.groceries).toMatch(/not by county/)
    expect(note.elec).toMatch(/statewide/)
    expect(LIVE_METRICS.find((d) => d.key === 'gas')!.unit).toBe('usd')
  })

  test('footers carry source · geography · window · as-of · adjustment', () => {
    expect(liveFooter('elec', null)).toBe('EIA average residential electricity price · statewide · latest 12-month average price vs the 12 months centered on Jan 2025 (Aug 2024–Jul 2025) · not loaded · no seasonal adjustment needed')
    expect(liveFooter('gas', null)).toMatch(/not seasonally adjusted$/)
  })
})

test('the refresh plan writes every cache key the map reads (no key mismatch between county-geo.json and the plan)', async () => {
  const { planRefresh } = await import('@/lib/api/refresh')
  const { describeDuoarea } = await import('@/lib/api/eia')
  const { describeBlsGasArea } = await import('@/lib/api/bls-gas')
  const { ELECTRICITY_STATES } = await import('@/lib/api/eia-electricity')
  const plan = planRefresh()
  const planKeys = new Set([...plan.cpiAreas.map((a) => cpiCacheKey(a.areaCode)), ...plan.gasLookups.map((l) => l.cacheKey)])
  const unplanned = new Set<string>()
  for (const g of Object.values(countyGeo as Record<string, { state: string; cpiArea: string; gasSource: string; gasDuoarea: string; gasTier: number }>)) {
    if (!planKeys.has(cpiCacheKey(g.cpiArea))) unplanned.add(cpiCacheKey(g.cpiArea))
    // Puerto Rico's gas is the bundled DACO series (never cached)
    if (g.state === 'PR') continue
    const gasKey = g.gasSource === 'bls'
      ? describeBlsGasArea(g.gasDuoarea, { standIn: g.gasTier === 2 }).cacheKey
      : describeDuoarea(g.gasDuoarea).cacheKey
    if (!planKeys.has(gasKey)) unplanned.add(gasKey)
  }
  expect([...unplanned]).toEqual([])
  const elecPlanned = new Set(plan.electricityStates ?? [])
  expect(ELECTRICITY_STATES.filter((st) => !elecPlanned.has(st)).map(electricityCacheKey)).toEqual([])
})

describe('round 15: per-area values, never a national stand-in', () => {
  /** Write every per-area key the map reads, each with its own value; `national` also writes the U.S. keys. */
  async function warmDistinct(national: boolean, perArea: boolean) {
    const m0 = await buildMapMetrics()
    const snap = (await fetchSnapshot('04101'))!
    const cpi = snap.cpi.data!
    const gas = snap.gas.data!
    const { describeDuoarea } = await import('@/lib/api/eia')
    const { describeBlsGasArea } = await import('@/lib/api/bls-gas')
    clearMemCache() // only what this test writes
    const writes: Promise<unknown>[] = []
    if (perArea) {
      m0.groceries.forEach((c, i) => writes.push(writeEnvelope(cpiCacheKey(c.area), { ...cpi, groceriesChange: 1 + i * 0.1 }, 60)))
      m0.gas.filter((a) => a.source !== 'dcra' && a.source !== 'daco').forEach((g, i) => {
        const [src, code] = g.id.replace('*', '').split(':')
        const key = src === 'b' ? describeBlsGasArea(code).cacheKey : describeDuoarea(code).cacheKey
        writes.push(writeEnvelope(key, { ...gas, change: 0.5 + i * 0.01, regionName: 'x' }, 60))
      })
    }
    if (national) {
      writes.push(writeEnvelope(cpiCacheKey('0000'), { ...cpi, groceriesChange: 9.9 }, 60))
      writes.push(writeEnvelope(describeDuoarea('NUS').cacheKey, { ...gas, change: 2.22, regionName: 'U.S.' }, 60))
    }
    await Promise.all(writes)
    return buildMapMetrics()
  }
  const states = Object.keys(countyGeo).filter((f) => Number(f.slice(0, 2)) <= 56)

  test('with the per-area keys cached, counties get many distinct gas and grocery values (not one for all)', async () => {
    const m = await warmDistinct(true, true)
    const gasVals = new Set(states.map((f) => liveValue(m, f, 'gas')?.value).filter((v) => v != null))
    const groVals = new Set(states.map((f) => liveValue(m, f, 'groceries')?.value).filter((v) => v != null))
    expect(gasVals.size).toBeGreaterThanOrEqual(30)
    expect(groVals.size).toBeGreaterThanOrEqual(25)
    // the U.S. values never appear on a county
    expect(gasVals.has(2.22)).toBe(false)
    expect(groVals.has(9.9)).toBe(false)
  })

  test('per-area keys missing: counties are no data even when the national keys are cached', async () => {
    const m = await warmDistinct(true, false)
    for (const f of states) {
      expect([f, liveValue(m, f, 'groceries')]).toEqual([f, null])
      const g = liveValue(m, f, 'gas')
      if (g) expect([f, g.source]).toEqual([f, 'Alaska DCRA']) // bundled survey values only
    }
    // Territories with only U.S.-average series (Guam): no data, not the national figure
    expect(liveValue(m, '66010', 'gas')).toBeNull()
    expect(liveValue(m, '66010', 'groceries')).toBeNull()
    expect(m.counties['66010']).toEqual([-1, -1])
  })
})
