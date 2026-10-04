/**
 * County map Gas / Groceries / Electricity layers: /api/map-metrics reads the cache ONLY (never
 * BLS/EIA, never the runtime budget), maps every county to its series through county-geo.json, and the
 * client turns that into per-county values with the area each number covers.
 */
import { server } from '../mocks/server'
import { clearMemCache, writeEnvelope, getCached, budgetKey, lastGoodKey, setCached, CACHE_SCHEMA_VERSION } from '@/lib/cache/kv'
import { buildMapMetrics } from '@/lib/api/map-metrics'
import { GET } from '@/app/api/map-metrics/route'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { electricityCacheKey } from '@/lib/api/eia-electricity'
import { cpiCacheKey } from '@/lib/api/bls-cpi'
import countyGeo from '@/lib/data/county-geo.json'
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
  expect(m.gas.every((g) => g.change === null)).toBe(true)
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

test('route: CDN-cached for an hour when complete, 5 minutes when any area is missing', async () => {
  let res = await GET()
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
  for (const g of m0.gas) {
    const [src, code] = g.id.replace('*', '').split(':')
    const key = src === 'b' ? describeBlsGasArea(code).cacheKey : describeDuoarea(code).cacheKey
    writes.push(writeEnvelope(key, { ...gas, latestDate: gas.latestDate, baselineDate: gas.baselineDate, regionName: 'x' }, 60))
  }
  await Promise.all(writes)
  expect((await buildMapMetrics()).missing).toBe(0)
  res = await GET()
  expect(res.headers.get('cache-control')).toBe('public, s-maxage=3600, stale-while-revalidate=86400')
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
    expect(liveFooter('elec', null)).toBe('EIA average residential electricity price · statewide · since Jan 2025 · not loaded · seasonally adjusted by whatchanged')
    expect(liveFooter('gas', null)).toMatch(/not seasonally adjusted$/)
  })
})
