/**
 * /api/data `trace` for golden zips, end to end through fetchSnapshot (MSW serves recorded BLS/EIA
 * responses): one step per rung, most local first. Also checks that the winning step is exactly what
 * the card/graph cites, and the BLS-outage path.
 */
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { blsFixtureFor } from '../mocks/handlers'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache } from '@/lib/cache/kv'
import { buildHeroCards, TRACE_FOR_CARD } from '@/lib/hero-cards'
import { getChartInput } from '@/components/charts/chart-inputs'
import { homePricesTrace } from '@/components/charts/HousingChart'
import { isUsedStatus, type TraceStep } from '@/lib/resolution/types'
import { LADDERS } from '@/lib/resolution/ladders'
import type { EconomicSnapshot } from '@/types'

const NOW = new Date('2026-10-03T12:00:00Z')

beforeAll(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterAll(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})
beforeEach(() => clearMemCache())

const line = (s: TraceStep) =>
  [s.status, s.rungId, s.geography ? `${s.geography.name} [${s.geography.level}]` : '', s.asOf ?? '', s.seriesId ?? '', s.reason ?? '']
    .join(' | ').replace(/( \| )+$/, '')

const summary = (snap: EconomicSnapshot) =>
  Object.fromEntries(Object.entries(snap.trace ?? {}).map(([m, steps]) => [m, steps!.map(line)]))

const winner = (steps: TraceStep[] | undefined) => steps?.find((s) => isUsedStatus(s.status))

const GOLDEN = [
  ['04101', 'Portland ME: EIA PADD 1A gas, Zillow county rent, New England division CPI'],
  ['30303', 'Atlanta: BLS metro gas, Atlanta metro CPI'],
  ['96720', 'Hilo: Honolulu stand-in gas, no Zillow rent → Pacific division shelter'],
  ['00601', 'Adjuntas PR: national gas + CPI, no electricity'],
  ['10509', 'Brewster NY: no Zillow rent for Putnam County → NY metro shelter'],
  ['19103', 'Philadelphia: BLS metro gas'],
  ['98683', 'Vancouver WA: EIA Washington state gas'],
  ['04240', 'Lewiston ME: no Zillow rent for Androscoggin County → New England division shelter'],
] as const

describe('trace snapshots (golden zips)', () => {
  test.each(GOLDEN)('%s — %s', async (zip) => {
    const s = (await fetchSnapshot(zip))!
    expect(summary(s)).toMatchSnapshot()
  })
})

describe('trace semantics', () => {
  test.each(GOLDEN.map(([z]) => z))('%s: every ladder in order, at most one winner, not-needed after it', async (zip) => {
    const s = (await fetchSnapshot(zip))!
    for (const metric of ['gas', 'rent', 'groceries', 'shelter', 'electricity'] as const) {
      const steps = s.trace![metric]!
      expect(steps.map((st) => st.rungId)).toEqual(LADDERS[metric].rungs.map((r) => r.id))
      const wi = steps.findIndex((st) => isUsedStatus(st.status))
      expect(steps.filter((st) => isUsedStatus(st.status)).length).toBeLessThanOrEqual(1)
      if (wi >= 0) expect(steps.slice(wi + 1).every((st) => st.status === 'not-needed')).toBe(true)
    }
  })

  test.each(GOLDEN.map(([z]) => z))('%s: the winning step is exactly what each card and graph cites', async (zip) => {
    const s = (await fetchSnapshot(zip))!
    for (const card of buildHeroCards(s)) {
      const w = winner(s.trace![TRACE_FOR_CARD[card.id]])
      if (card.status !== 'ok') continue
      expect(w).toBeDefined()
      expect(w!.citationUrl).toBe(card.provenance.sourceUrl)
    }
    const g = winner(s.trace!.gas)
    expect(g?.seriesId).toBe(s.gas.data?.seriesId)
    expect(getChartInput('gas', s).provenance.sourceUrl).toBe(g?.citationUrl)
    const gr = winner(s.trace!.groceries)
    expect(gr?.seriesId).toBe(s.cpi.data?.seriesIds?.groceries)
    expect(getChartInput('cpi-groceries', s).provenance.sourceUrl).toBe(gr?.citationUrl)
    expect(getChartInput('cpi-shelter', s).provenance.sourceUrl).toBe(winner(s.trace!.shelter)?.citationUrl)
    const e = winner(s.trace!.electricity)
    expect(e?.seriesId).toBe(s.electricity.data?.seriesId)
  })

  test('rent: Zillow county wins where it has a series, otherwise CPI shelter with the reason', async () => {
    const portland = (await fetchSnapshot('04101'))!
    expect(portland.rent).not.toBeNull()
    expect(portland.trace!.rent!.map((x) => x.status)).toEqual(['used', 'not-needed'])
    expect(portland.trace!.rent![1].geography).toEqual({ name: 'New England division', level: 'division' })

    const brewster = (await fetchSnapshot('10509'))!
    expect(brewster.rent).toBeNull()
    const [z, cpi] = brewster.trace!.rent!
    expect(z).toMatchObject({ status: 'not-applicable', geography: { name: 'Putnam County, NY', level: 'county' } })
    expect(z.reason).toMatch(/^Zillow has no rent series for Putnam County/)
    expect(cpi).toMatchObject({ status: 'used', seriesId: 'CUURS12ASAH1', geography: { level: 'metro' } })
    expect(buildHeroCards(brewster)[1].id).toBe('shelter')
  })

  test('the trace keeps the response small', async () => {
    const s = (await fetchSnapshot('30303'))!
    const { trace, ...rest } = s
    const added = JSON.stringify(s).length - JSON.stringify(rest).length
    expect(added).toBeLessThan(6000)
    expect(JSON.stringify(trace)).not.toMatch(/"(undefined|null)"/)
  })

  test('home prices (client-side ladder over the county shard)', () => {
    const loc = { zip: '04101', countyFips: '23005', countyName: 'Cumberland County', stateName: 'Maine', stateAbbr: 'ME', cityName: 'Portland' }
    const used = homePricesTrace(loc, { n: 'Cumberland County, ME', hvS: { start: '2026-07', v: [1, 2] } } as never, NOW)
    expect(used).toEqual([expect.objectContaining({ rungId: 'homePrices.zillow-county', status: 'used', asOf: '2026-08' })])
    const none = homePricesTrace(loc, null, NOW)
    expect(none[0]).toMatchObject({ status: 'not-applicable', reason: 'Zillow has no home value series for Cumberland County back to Jan 2025.' })
  })
})

describe('trace during a BLS gas outage (19103)', () => {
  beforeEach(() => {
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        const body = (await request.json()) as { seriesid?: string[] }
        const ids = body?.seriesid ?? []
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED', responseTime: 1, message: [],
          Results: { series: ids.map((id) => ({ seriesID: id, data: id.startsWith('APU') ? [] : blsFixtureFor(id) })) },
        })
      })
    )
  })

  test('BLS metro unavailable → the EIA weekly tier (next source), labeled as a fallback', async () => {
    const s = (await fetchSnapshot('19103'))!
    expect(s.gas.data).toMatchObject({ source: 'eia', duoarea: 'R1Y', fallback: 'eia' })
    expect(s.trace!.gas!.map((x) => `${x.rungId}:${x.status}`)).toEqual([
      'gas.eia-city:not-applicable',
      'gas.bls-metro:unavailable',
      'gas.bls-hiak-standin:not-applicable',
      'gas.eia-state:not-applicable',
      expect.stringMatching(/^gas\.eia-padd:(used|stale)$/),
      'gas.eia-national:not-needed',
    ])
    expect(s.trace!.gas![4].reason).toMatch(/source above was unavailable|hasn't updated/)
  })

  test('Hilo: stand-in unavailable → EIA has no HI series → U.S. average, labeled', async () => {
    const s = (await fetchSnapshot('96720'))!
    expect(s.gas.data).toMatchObject({ duoarea: 'NUS', fallback: 'national' })
    expect(s.trace!.gas!.map((x) => `${x.rungId}:${x.status}`)).toEqual([
      'gas.eia-city:not-applicable',
      'gas.bls-metro:not-applicable',
      'gas.bls-hiak-standin:unavailable',
      'gas.eia-state:not-applicable',
      'gas.eia-padd:not-applicable',
      expect.stringMatching(/^gas\.eia-national:(used|stale)$/),
    ])
  })
})
