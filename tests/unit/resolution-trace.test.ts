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
import { heatingTabs } from '@/components/charts/HeatingChart'
import { getHeatingInput } from '@/components/charts/chart-inputs'
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
  ['10509', 'Brewster NY: Putnam County Zillow rent (own seasonal pattern blended with the state’s), NY metro CPI'],
  ['55334', 'Gaylord MN: no Zillow county or metro rent for Sibley County → Minneapolis metro shelter'],
  ['19103', 'Philadelphia: BLS metro gas'],
  ['98683', 'Vancouver WA: EIA Washington state gas'],
  ['04240', 'Lewiston ME: Androscoggin County Zillow rent (short series, state seasonal pattern only)'],
  ['04530', 'Bath ME: Sagadahoc county series too new → Portland-South Portland metro rent'],
  ['99701', 'Fairbanks AK: DCRA community survey gas (own community)'],
  ['99559', 'Bethel AK: DCRA community survey gas (own community)'],
  ['00901', 'San Juan PR: DACO island-wide monthly gas'],
  ['10950', 'Monroe NY (Orange County): NYSERDA Upper Hudson heating oil, EIA NY propane'],
  ['55401', 'Minneapolis: EIA weekly Minnesota state gas preferred over the BLS monthly metro'],
  ['35460', 'Epes AL: Census suppresses the zip rent → nearest zip in the county with a reliable Census rent (labeled)'],
] as const

const METRICS = ['gas', 'rent', 'groceries', 'shelter', 'electricity', 'heatingOil', 'propane', 'rentBase'] as const

describe('trace snapshots (golden zips)', () => {
  test.each(GOLDEN)('%s — %s', async (zip) => {
    const s = (await fetchSnapshot(zip))!
    expect(summary(s)).toMatchSnapshot()
  })
})

describe('trace semantics', () => {
  test.each(GOLDEN.map(([z]) => z))('%s: every ladder in order, at most one winner, not-needed after it', async (zip) => {
    const s = (await fetchSnapshot(zip))!
    for (const metric of METRICS) {
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
    expect(portland.trace!.rent!.map((x) => x.status)).toEqual(['used', 'not-needed', 'not-needed'])
    expect(portland.trace!.rent![2].geography).toEqual({ name: 'New England division', level: 'division' })

    const gaylord = (await fetchSnapshot('55334'))!
    expect(gaylord.rent).toBeNull()
    const [z, metro, cpi] = gaylord.trace!.rent!
    expect(z).toMatchObject({ status: 'not-applicable', geography: { name: 'Sibley County, MN', level: 'county' } })
    expect(z.reason).toMatch(/^Zillow publishes no rent series for Sibley County/)
    expect(metro).toMatchObject({ rungId: 'rent.zillow-metro', status: 'not-applicable' })
    expect(metro.reason).toMatch(/^Sibley County isn't in a metro with a Zillow rent series/)
    expect(cpi).toMatchObject({ status: 'used', seriesId: 'CUURS24ASAH1', geography: { level: 'metro' } })
    expect(buildHeroCards(gaylord)[1].id).toBe('shelter')
  })

  test('rent: Zillow metro rent where the county has no series (Sagadahoc ME → Portland metro), labeled on the card', async () => {
    const bath = (await fetchSnapshot('04530'))!
    expect(bath.rent).toMatchObject({ level: 'metro', cbsa: '38860', geoName: 'Portland-South Portland, ME metro', countyFips: '23023' })
    expect(bath.trace!.rent!.map((x) => `${x.rungId}:${x.status}`)).toEqual([
      'rent.zillow-county:not-applicable', 'rent.zillow-metro:used', 'rent.bls-cpi-shelter:not-needed',
    ])
    expect(bath.trace!.rent![1].geography).toEqual({ name: 'Portland-South Portland, ME metro', level: 'metro' })
    const card = buildHeroCards(bath)[1]
    expect(card).toMatchObject({ id: 'rent', status: 'ok', geoTag: 'Portland-South Portland metro' })
    expect(card.sourceLine).toMatch(/^Portland-South Portland metro · Zillow · /)
    expect(card.info.join(' ')).toMatch(/series for Sagadahoc County is too new .* to measure since Jan 2025; this is the Portland-South Portland, ME metro series/)
    // Androscoggin: a short county series, adjusted with its state's (here U.S.) seasonal pattern only and said so
    const lewiston = (await fetchSnapshot('04240'))!
    expect(lewiston.rent).toMatchObject({ level: 'county', countyFips: '23001', saPool: expect.stringMatching(/counties$/), saW: 0 })
    expect(buildHeroCards(lewiston)[1].info.join(' ')).toMatch(
      /Seasonally adjusted by whatchanged \(county pattern blended with the state pattern based on history length\): this series is too short to estimate its own pattern, so it uses the typical pattern of .* counties/)
    // A county with a full 2016-2024 history: half its own pattern, half its state's (n / (n + 8), n = 8)
    const austin = (await fetchSnapshot('78701'))!
    expect(austin.rent).toMatchObject({ level: 'county', saPool: 'Texas counties', saW: 0.5 })
    expect(buildHeroCards(austin)[1].info.join(' ')).toContain('50% the county’s own pattern, 50% the typical pattern of Texas counties.')
  })

  test('rent: a county series with data before Jan 2024 but no Jan 2025 value says so, not "too new" (Burnet TX)', async () => {
    const burnet = (await fetchSnapshot('78611'))!
    expect(burnet.location.countyFips).toBe('48053')
    const county = burnet.trace!.rent![0]
    expect(county).toMatchObject({ rungId: 'rent.zillow-county', status: 'not-applicable' })
    expect(county.reason).toMatch(/^Zillow's series for Burnet County has no Jan 2025 value/)
    expect(county.reason).not.toMatch(/too new/)
    if (burnet.rent?.level === 'metro') {
      expect(burnet.rent.countyWhy).toBe('no-baseline')
      expect(buildHeroCards(burnet)[1].info.join(' ')).toMatch(/series for Burnet County has no Jan 2025 value/)
    }
  })

  test('gas: Alaska DCRA community survey (own community / nearest / region), no U.S. comparison, CC BY credit', async () => {
    for (const zip of ['99701', '99559']) {
      const s = (await fetchSnapshot(zip))!
      expect(s.gas.data).toMatchObject({ source: 'dcra', frequency: 'semiannual', baselineDate: '2025-01', staticSource: { kind: 'dcra', match: 'community' } })
      expect(s.gas.data!.nationalSeries).toBeUndefined()
      const steps = s.trace!.gas!
      expect(steps.find((x) => isUsedStatus(x.status))).toMatchObject({ rungId: 'gas.dcra-community', geography: { level: 'community' } })
      expect(steps.find((x) => x.rungId === 'gas.bls-hiak-standin')!.status).toBe('not-needed')
      const card = buildHeroCards(s)[0]
      expect(card.sourceLine).toMatch(/ survey · DCRA(, 1 station)? · Jul 2026$/)
      expect(card.nationalValue).toBeUndefined()
      expect(card.info.join(' ')).toMatch(/CC BY 4\.0/)
    }
    // Nome has no surveyed community of its own: the nearest surveyed one in Nome Census Area, labeled
    const nome = (await fetchSnapshot('99762'))!
    expect(nome.gas.data!.staticSource).toMatchObject({ kind: 'dcra', match: 'nearest' })
    expect(buildHeroCards(nome)[0].caveat).toMatch(/nearest surveyed community in Nome Census Area/)
    // Anchorage stays on BLS's monthly Anchorage price
    const anc = (await fetchSnapshot('99501'))!
    expect(anc.gas.data).toMatchObject({ source: 'bls', blsArea: 'S49G' })
  })

  test('gas: Puerto Rico DACO island-wide monthly (before the U.S. average), no U.S. comparison', async () => {
    const s = (await fetchSnapshot('00901'))!
    expect(s.gas.data).toMatchObject({ source: 'daco', frequency: 'monthly', baselineDate: '2025-01', region: 'Puerto Rico' })
    expect(s.trace!.gas!.map((x) => `${x.rungId}:${x.status}`).slice(-2)).toEqual([
      expect.stringMatching(/^gas\.daco-pr:(used|stale)$/), 'gas.eia-national:not-needed',
    ])
    const card = buildHeroCards(s)[0]
    expect(card.sourceLine).toMatch(/^Puerto Rico avg · DACO · /)
    expect(card.caveat).toBeUndefined()
  })

  test('home heating: SHOPP off-season labeled honestly; NYSERDA region for NY; tabs only where data exists', async () => {
    const portland = (await fetchSnapshot('04101'))!
    const oil = portland.heating!.oil!.data!
    expect(oil).toMatchObject({ source: 'eia', seriesId: 'W_EPD2F_PRS_SME_DPG', baselineDate: '2025-01-20', latestDate: '2026-03-30' })
    expect(oil.offSeasonNote).toBe('Heating-season survey (Oct–Mar) · latest Mar 30, 2026 · next update mid-Oct')
    expect(portland.heating!.oil!.stale).toBeFalsy()
    expect(portland.trace!.heatingOil!.map((x) => `${x.rungId}:${x.status}`)).toEqual([
      'heatingOil.nyserda-region:not-applicable', 'heatingOil.eia-shopp-state:stale',
    ])
    // Off-season is the survey's schedule: flagged so the traceback says "between survey seasons", not "out of date"
    expect(portland.trace!.heatingOil![1]).toMatchObject({ seasonal: true, reason: oil.offSeasonNote })
    expect(heatingTabs(portland)).toEqual(['oil', 'propane'])
    expect(getHeatingInput('oil', portland).provenance.sourceUrl).toBe(winner(portland.trace!.heatingOil)!.citationUrl)

    const monroe = (await fetchSnapshot('10950'))!
    expect(monroe.heating!.oil!.data).toMatchObject({ source: 'nyserda', geography: 'Upper Hudson region (NY)', nationalLabel: 'NY statewide avg, NYSERDA' })
    expect(monroe.trace!.heatingOil!.map((x) => `${x.rungId}:${x.status}`)).toEqual([
      'heatingOil.nyserda-region:used', 'heatingOil.eia-shopp-state:not-needed',
    ])

    // Georgia: no SHOPP heating oil; SHOPP propane exists, but only 3.6% of Georgia homes use it (ACS B25040,
    // under the 5% bar) → no Home heating graph. Maine (50% oil, 16% propane) keeps both tabs.
    const atl = (await fetchSnapshot('30303'))!
    expect(atl.heating!.oil).toBeNull()
    expect(atl.heating!.propane!.data).toMatchObject({ seriesId: 'W_EPLLPA_PRS_SGA_DPG' })
    expect(heatingTabs(atl)).toEqual([])
    expect(heatingTabs(portland)).toEqual(['oil', 'propane'])
    // No source at all (Alaska, Puerto Rico): no graph
    expect(heatingTabs((await fetchSnapshot('99701'))!)).toEqual([])
    expect(heatingTabs((await fetchSnapshot('00901'))!)).toEqual([])
  })

  test('the trace keeps the response small', async () => {
    const s = (await fetchSnapshot('30303'))!
    const { trace, ...rest } = s
    const added = JSON.stringify(s).length - JSON.stringify(rest).length
    // 9 ladders incl. the Shelter $ rent base (5 short rungs)
    expect(added).toBeLessThan(7500)
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
      'gas.dcra-community:not-applicable',
      'gas.bls-hiak-standin:not-applicable',
      'gas.eia-state:not-applicable',
      expect.stringMatching(/^gas\.eia-padd:(used|stale)$/),
      'gas.daco-pr:not-needed',
      'gas.eia-national:not-needed',
    ])
    expect(s.trace!.gas!.find((x) => x.rungId === 'gas.eia-padd')!.reason).toMatch(/source above was unavailable|hasn't updated/)
  })

  test('Hilo: stand-in unavailable → EIA has no HI series → U.S. average, labeled', async () => {
    const s = (await fetchSnapshot('96720'))!
    expect(s.gas.data).toMatchObject({ duoarea: 'NUS', fallback: 'national' })
    expect(s.trace!.gas!.map((x) => `${x.rungId}:${x.status}`)).toEqual([
      'gas.eia-city:not-applicable',
      'gas.bls-metro:not-applicable',
      'gas.dcra-community:not-applicable',
      'gas.bls-hiak-standin:unavailable',
      'gas.eia-state:not-applicable',
      'gas.eia-padd:not-applicable',
      'gas.daco-pr:not-applicable',
      expect.stringMatching(/^gas\.eia-national:(used|stale)$/),
    ])
  })
})
