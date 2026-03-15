import { http, HttpResponse } from 'msw'
import blsUnemployment from '../fixtures/bls-unemployment.json'
import blsCpi from '../fixtures/bls-cpi.json'
import eiaGas from '../fixtures/eia-gas.json'
import usaSpending from '../fixtures/usaspending.json'

export const handlers = [
  // BLS API handles both unemployment (LAUCN series) and CPI (CUUR series)
  http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
    const body = await request.json() as { seriesid?: string[] }
    const seriesIds: string[] = body?.seriesid ?? []
    // If any series ID starts with CUUR, return CPI fixture
    if (seriesIds.some((id: string) => id.startsWith('CUUR'))) {
      return HttpResponse.json(blsCpi)
    }
    return HttpResponse.json(blsUnemployment)
  }),
  http.get('https://api.eia.gov/v2/petroleum/pri/gnd/data/', () => {
    return HttpResponse.json(eiaGas)
  }),
  http.post('https://api.usaspending.gov/api/v2/search/spending_by_award/', () => {
    return HttpResponse.json(usaSpending)
  }),
]
