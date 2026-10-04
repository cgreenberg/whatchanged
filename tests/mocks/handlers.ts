import { http, HttpResponse } from 'msw'
import blsRecorded from '../fixtures/bls-recorded-2024-2026.json'
import eiaGas from '../fixtures/eia-gas.json'
import eiaEpmrSWA from '../fixtures/eia-epmr-SWA.json'
import eiaEpmrNUS from '../fixtures/eia-epmr-NUS.json'

type RawPoint = { year: string; period: string; value: string }

// Recorded BLS series, keyed by series ID
const RECORDED = new Map<string, RawPoint[]>(
  (blsRecorded.Results.series as Array<{ seriesID: string; data: RawPoint[] }>).map((s) => [s.seriesID, s.data])
)

// Template for series IDs that weren't recorded: same measure, keyed by item —
// never by position in the request array.
const COUNTY_LAUS_TEMPLATE = 'LAUCN530110000000003'
const CPI_ITEM_TEMPLATE_AREA = '0490' // Pacific division

export function blsFixtureFor(seriesId: string): RawPoint[] {
  const recorded = RECORDED.get(seriesId)
  if (recorded) return recorded
  if (seriesId.startsWith('LAUCN')) return RECORDED.get(COUNTY_LAUS_TEMPLATE) ?? []
  const cpi = seriesId.match(/^CUUR(.{4})(SAF11|SAH1|SA0E)$/)
  if (cpi) return RECORDED.get(`CUUR${CPI_ITEM_TEMPLATE_AREA}${cpi[2]}`) ?? []
  return []
}

export const handlers = [
  // BLS API: each requested series ID gets its own fixture
  http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
    const body = (await request.json()) as { seriesid?: string[] }
    const seriesIds: string[] = body?.seriesid ?? []
    return HttpResponse.json({
      status: 'REQUEST_SUCCEEDED',
      responseTime: 1,
      message: [],
      Results: {
        series: seriesIds.map((id) => ({ seriesID: id, data: blsFixtureFor(id) })),
      },
    })
  }),
  // EIA: only product EPMR (regular gasoline) is served — any other product gets
  // no data, so a regression to EPM0 (all grades) fails tests. SWA and NUS
  // return real recorded EPMR responses; other areas get the small fixture.
  http.get('https://api.eia.gov/v2/petroleum/pri/gnd/data/', ({ request }) => {
    const url = new URL(request.url)
    if (url.searchParams.get('facets[product][]') !== 'EPMR') {
      return HttpResponse.json({ response: { total: 0, data: [] } })
    }
    const duoarea = url.searchParams.get('facets[duoarea][]')
    if (duoarea === 'SWA') return HttpResponse.json(eiaEpmrSWA)
    if (duoarea === 'NUS') return HttpResponse.json(eiaEpmrNUS)
    return HttpResponse.json(eiaGas)
  }),
]
