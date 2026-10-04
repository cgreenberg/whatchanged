import { http, HttpResponse } from 'msw'
import blsRecorded from '../fixtures/bls-recorded-2024-2026.json'
import blsGasRecorded from '../fixtures/bls-gas-ap-2024-2026.json'
import blsRentRecorded from '../fixtures/bls-cpi-rent-seha.json'
import eiaGas from '../fixtures/eia-gas.json'
import eiaEpmrSWA from '../fixtures/eia-epmr-SWA.json'
import eiaEpmrNUS from '../fixtures/eia-epmr-NUS.json'
import eiaElectricity from '../fixtures/eia-electricity-res.json'

type RawPoint = { year: string; period: string; value: string }

// Recorded BLS series (CPI, CPI rent of primary residence SEHA for all 37 areas, APU…74714 average gas
// prices), keyed by series ID
const RECORDED = new Map<string, RawPoint[]>(
  [...blsRecorded.Results.series, ...blsGasRecorded.Results.series, ...blsRentRecorded.Results.series]
    .map((s) => [(s as { seriesID: string }).seriesID, (s as { data: RawPoint[] }).data] as [string, RawPoint[]])
)

// Template for series IDs that weren't recorded: same measure, keyed by item —
// never by position in the request array.
const CPI_ITEM_TEMPLATE_AREA = '0490' // Pacific division

export function blsFixtureFor(seriesId: string): RawPoint[] {
  const recorded = RECORDED.get(seriesId)
  if (recorded) return recorded
  const cpi = seriesId.match(/^CUUR(.{4})(SAF11|SAH1|SEHA)$/)
  if (cpi) return RECORDED.get(`CUUR${CPI_ITEM_TEMPLATE_AREA}${cpi[2]}`) ?? []
  return []
}

type ElecRow = (typeof eiaElectricity.response.data)[number]
const ELEC_ROWS = eiaElectricity.response.data as ElecRow[]
const ELEC_RECORDED = new Set(ELEC_ROWS.map((r) => r.stateid))
/** States not in the recorded fixture reuse Washington's recorded rows (same measure, relabeled). */
const ELEC_TEMPLATE_STATE = 'WA'

/** Recorded residential electricity rows for these states (period asc, then state), like the real API's sort. */
export function electricityRowsFor(states: string[]): ElecRow[] {
  const out: ElecRow[] = []
  for (const st of states) {
    const src = ELEC_RECORDED.has(st) ? st : ELEC_TEMPLATE_STATE
    for (const r of ELEC_ROWS) if (r.stateid === src) out.push({ ...r, stateid: st, stateDescription: src === st ? r.stateDescription : st })
  }
  return out.sort((a, b) => a.period.localeCompare(b.period) || a.stateid.localeCompare(b.stateid))
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
  // EIA residential electricity (retail-sales): recorded rows for the requested states, paged like the
  // real API (offset/length, `total`). Only sector RES with price/sales/customers is served.
  http.get('https://api.eia.gov/v2/electricity/retail-sales/data/', ({ request }) => {
    const url = new URL(request.url)
    if (url.searchParams.get('facets[sectorid][]') !== 'RES') return HttpResponse.json({ response: { total: '0', data: [] } })
    const rows = electricityRowsFor(url.searchParams.getAll('facets[stateid][]'))
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const length = Number(url.searchParams.get('length') ?? 5000)
    return HttpResponse.json({ response: { total: String(rows.length), data: rows.slice(offset, offset + Math.min(length, 5000)) } })
  }),
]
