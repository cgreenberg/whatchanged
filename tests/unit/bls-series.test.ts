// BLS series IDs + the REAL parsers (bls-common / bls / bls-cpi), driven by a
// recorded BLS API response (tests/fixtures/bls-recorded-2024-2026.json).

import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'
import { clearMemCache } from '@/lib/cache/kv'
import {
  buildSeriesId,
  fetchUnemployment,
  parseUnemploymentResponse,
  NATIONAL_UNEMPLOYMENT_SERIES,
} from '@/lib/api/bls'
import { parseCpiResponse, fetchCpiArea } from '@/lib/api/bls-cpi'
import { parseBlsMonthly, findBaseline, findLatest, pctChange, type BlsRawPoint } from '@/lib/api/bls-common'
import recorded from '../fixtures/bls-recorded-2024-2026.json'

describe('BLS LAUS series ID format', () => {
  test('5-digit FIPS 53011 produces correct series ID', () => {
    expect(buildSeriesId('53011')).toBe('LAUCN530110000000003')
  })

  test('short FIPS 1 gets padded to 5 digits (00001)', () => {
    const id = buildSeriesId('1')
    expect(id).toBe('LAUCN000010000000003')
    expect(id.slice(5, 10)).toBe('00001')
  })

  test('short FIPS 011 gets padded to 00011', () => {
    const id = buildSeriesId('011')
    expect(id).toBe('LAUCN000110000000003')
  })

  test('Manhattan FIPS 36061 produces correct ID', () => {
    expect(buildSeriesId('36061')).toBe('LAUCN360610000000003')
  })

  test('Chicago Cook County 17031 produces correct ID', () => {
    expect(buildSeriesId('17031')).toBe('LAUCN170310000000003')
  })

  test('FIPS with leading zeros preserved: 06001', () => {
    const id = buildSeriesId('06001')
    expect(id).toBe('LAUCN060010000000003')
    expect(id.slice(5, 10)).toBe('06001')
  })
})

// ---------------------------------------------------------------------------
// Recorded fixture helpers
// ---------------------------------------------------------------------------

const RECORDED: Record<string, BlsRawPoint[]> = Object.fromEntries(
  (recorded.Results.series as Array<{ seriesID: string; data: BlsRawPoint[] }>).map((s) => [s.seriesID, s.data])
)

function seriesMap(ids: string[], mutate?: (id: string, data: BlsRawPoint[]) => BlsRawPoint[]) {
  const out: Record<string, BlsRawPoint[]> = {}
  for (const id of ids) {
    const data = RECORDED[id].map((d) => ({ ...d }))
    out[id] = mutate ? mutate(id, data) : data
  }
  return out
}

const PACIFIC = { areaCode: '0490', areaName: 'Pacific', tier: 2 as const }
const PACIFIC_IDS = ['CUUR0490SAF11', 'CUUR0490SAH1', 'CUUR0490SA0E', 'CUUR0000SAF11', 'CUUR0000SAH1', 'CUUR0000SA0E']

describe('parseBlsMonthly (real parser, recorded data)', () => {
  test('drops "-" values (Oct 2025 shutdown gap) and sorts oldest first', () => {
    const pts = parseBlsMonthly(RECORDED['LAUCN530110000000003'])
    expect(pts.find((p) => p.date === '2025-10')).toBeUndefined()
    expect(pts[0].date).toBe('2024-01')
    for (let i = 1; i < pts.length; i++) expect(pts[i].date > pts[i - 1].date).toBe(true)
    expect(pts.every((p) => /^\d{4}-\d{2}$/.test(p.date))).toBe(true)
  })

  test('drops M13 annual averages and non-numeric values', () => {
    const pts = parseBlsMonthly([
      { year: '2025', period: 'M13', value: '4.5' },
      { year: '2025', period: 'M01', value: '4.1' },
      { year: '2025', period: 'M02', value: 'n/a' },
    ])
    expect(pts).toEqual([{ date: '2025-01', value: 4.1 }])
  })
})

describe('findBaseline / findLatest', () => {
  test('baseline is 2025-M01 when published', () => {
    const b = findBaseline(parseBlsMonthly(RECORDED['CUUR0490SAF11']))
    expect(b).toEqual({ period: '2025-01', value: 133.145 })
  })

  test('bimonthly even-month area (no Jan) → Dec 2024 baseline', () => {
    const evenOnly = RECORDED['CUUR0490SAF11'].filter((d) => Number(d.period.slice(1)) % 2 === 0)
    expect(findBaseline(parseBlsMonthly(evenOnly))).toEqual({ period: '2024-12', value: 131.67 })
  })

  test('no value between Nov 2024 and Jan 2025 → null (never 0)', () => {
    const old = RECORDED['CUUR0490SAF11'].filter((d) => `${d.year}-${d.period}` <= '2024-M10' || d.year === '2026')
    expect(findBaseline(parseBlsMonthly(old))).toBeNull()
  })

  test('Jan 2025 "-" with no Dec/Nov fallback → null', () => {
    const pts = parseBlsMonthly([
      { year: '2025', period: 'M01', value: '-' },
      { year: '2025', period: 'M02', value: '5.0' },
    ])
    expect(findBaseline(pts)).toBeNull()
  })

  test('latest skips trailing "-"', () => {
    const data = [{ year: '2026', period: 'M09', value: '-' }, ...RECORDED['CUUR0490SAF11']]
    expect(findLatest(parseBlsMonthly(data))).toEqual({ period: '2026-08', value: 138.497 })
  })

  test('pctChange returns null for missing/zero baseline', () => {
    expect(pctChange(110, 100)).toBe(10)
    expect(pctChange(110, 0)).toBeNull()
    expect(pctChange(NaN, 100)).toBeNull()
  })
})

describe('parseUnemploymentResponse (recorded LAUS for Clark County, WA)', () => {
  const ids = ['LAUCN530110000000003', 'LNU04000000']

  test('baseline = 2025-M01, latest = most recent valid month', () => {
    const d = parseUnemploymentResponse(seriesMap(ids), '53011')
    expect(d.baseline).toBe(4.6)
    expect(d.baselinePeriod).toBe('2025-01')
    expect(d.current).toBe(4.8)
    expect(d.latestPeriod).toBe('2026-08')
    expect(d.change).toBe(0.2)
    expect(d.seriesId).toBe('LAUCN530110000000003')
  })

  test('national overlay is the NSA series LNU04000000', () => {
    const d = parseUnemploymentResponse(seriesMap(ids), '53011')
    expect(NATIONAL_UNEMPLOYMENT_SERIES).toBe('LNU04000000')
    expect(d.nationalSeriesId).toBe('LNU04000000')
    expect(d.nationalSeries?.find((p) => p.date === '2025-01')?.rate).toBe(4.4)
  })

  test('missing Jan 2025 → baseline and change are null (not 0 / not full rate)', () => {
    const d = parseUnemploymentResponse(
      seriesMap(ids, (id, data) => (id.startsWith('LAUCN') ? data.filter((x) => !(x.year === '2025' && x.period === 'M01')) : data)),
      '53011'
    )
    expect(d.baseline).toBeNull()
    expect(d.change).toBeNull()
    expect(d.current).toBe(4.8)
  })

  test('Jan 2025 "-" → baseline null', () => {
    const d = parseUnemploymentResponse(
      seriesMap(ids, (id, data) => data.map((x) => (id.startsWith('LAUCN') && x.year === '2025' && x.period === 'M01' ? { ...x, value: '-' } : x))),
      '53011'
    )
    expect(d.baseline).toBeNull()
  })

  test('throws when the county series has no valid values', () => {
    expect(() => parseUnemploymentResponse({ LAUCN530110000000003: [{ year: '2025', period: 'M01', value: '-' }] }, '53011')).toThrow()
  })
})

describe('parseCpiResponse (recorded CPI)', () => {
  test('Pacific division: groceries and shelter % change vs their own Jan 2025 baseline', () => {
    const d = parseCpiResponse(seriesMap(PACIFIC_IDS), PACIFIC)
    // (138.497 - 133.145) / 133.145 * 100 = 4.02
    expect(d.groceriesChange).toBe(4.0)
    expect(d.groceriesBaseline).toBe(133.145)
    expect(d.groceriesBaselinePeriod).toBe('2025-01')
    expect(d.groceriesLatestPeriod).toBe('2026-08')
    // (139.596 - 132.606) / 132.606 * 100 = 5.27
    expect(d.shelterChange).toBe(5.3)
    expect(d.shelterBaselinePeriod).toBe('2025-01')
    expect(d.seriesIds).toEqual({ groceries: 'CUUR0490SAF11', shelter: 'CUUR0490SAH1', energy: 'CUUR0490SA0E' })
    expect(d.nationalSeries?.length).toBeGreaterThan(0)
    expect(d.series.find((p) => p.date === '2025-10')).toBeUndefined()
  })

  test('each series uses its own latest month (no -100% when shelter lags groceries)', () => {
    const d = parseCpiResponse(
      seriesMap(PACIFIC_IDS, (id, data) => (id === 'CUUR0490SAH1' ? data.filter((x) => !(x.year === '2026' && x.period === 'M08')) : data)),
      PACIFIC
    )
    expect(d.groceriesLatestPeriod).toBe('2026-08')
    expect(d.shelterLatestPeriod).toBe('2026-07')
    expect(d.shelterChange).toBeGreaterThan(0)
  })

  test('Phoenix food (recorded gap 2026-M02..M07) still uses its latest valid month', () => {
    const ids = ['CUURS48ASAF11', 'CUURS48ASAH1', 'CUURS48ASA0E']
    const d = parseCpiResponse(seriesMap(ids), { areaCode: 'S48A', areaName: 'Phoenix', tier: 1 })
    expect(d.groceriesLatestPeriod).toBe('2026-08')
    expect(d.groceriesCurrent).toBe(191.162)
  })

  test('bimonthly even-month area → Dec 2024 baseline, period reported', () => {
    const d = parseCpiResponse(
      seriesMap(PACIFIC_IDS, (id, data) => (id.startsWith('CUUR0490') ? data.filter((x) => Number(x.period.slice(1)) % 2 === 0) : data)),
      PACIFIC
    )
    expect(d.groceriesBaselinePeriod).toBe('2024-12')
    expect(d.groceriesBaseline).toBe(131.67)
    expect(d.shelterBaselinePeriod).toBe('2024-12')
  })

  test('shelter missing → shelter fields omitted, groceries still returned', () => {
    const d = parseCpiResponse(seriesMap(PACIFIC_IDS, (id, data) => (id === 'CUUR0490SAH1' ? [] : data)), PACIFIC)
    expect(d.shelterChange).toBeUndefined()
    expect(d.groceriesChange).toBe(4.0)
  })

  test('groceries without a baseline → throws (source unavailable, never +0.0%)', () => {
    expect(() =>
      parseCpiResponse(
        seriesMap(PACIFIC_IDS, (id, data) => (id === 'CUUR0490SAF11' ? data.filter((x) => x.year === '2026') : data)),
        PACIFIC
      )
    ).toThrow(/baseline/)
  })
})

describe('fetchers request the right series (MSW, recorded fixture)', () => {
  beforeEach(() => clearMemCache())

  test('fetchUnemployment requests county LAUS + LNU04000000 in one call', async () => {
    let requested: string[] = []
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        const body = (await request.json()) as { seriesid: string[] }
        requested = body.seriesid
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED',
          Results: { series: body.seriesid.map((id) => ({ seriesID: id, data: RECORDED[id] ?? [] })) },
        })
      })
    )
    const d = await fetchUnemployment('53011')
    expect(requested).toEqual(['LAUCN530110000000003', 'LNU04000000'])
    expect(d.baseline).toBe(4.6)
  })

  test('fetchCpiArea batches area + national series in one call', async () => {
    let calls = 0
    let requested: string[] = []
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        calls++
        const body = (await request.json()) as { seriesid: string[] }
        requested = body.seriesid
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED',
          Results: { series: body.seriesid.map((id) => ({ seriesID: id, data: RECORDED[id] ?? [] })) },
        })
      })
    )
    const d = await fetchCpiArea(PACIFIC)
    expect(calls).toBe(1)
    expect(requested.sort()).toEqual([...PACIFIC_IDS].sort())
    expect(d.groceriesChange).toBe(4.0)
  })
})

describe('BLS preliminary footnotes', () => {
  test('footnote code P marks a point preliminary; others are unmarked', () => {
    const pts = parseBlsMonthly([
      { year: '2026', period: 'M08', value: '4.8', footnotes: [{ code: 'P', text: 'Preliminary.' }] },
      { year: '2026', period: 'M07', value: '3.9', footnotes: [{}] },
      { year: '2026', period: 'M06', value: '3.7' },
    ])
    expect(pts).toEqual([
      { date: '2026-06', value: 3.7 },
      { date: '2026-07', value: 3.9 },
      { date: '2026-08', value: 4.8, preliminary: true },
    ])
  })

  test('CPI point is preliminary when any item value at that date is', () => {
    const p = (period: string, value: string, prelim = false) => ({
      year: period.slice(0, 4), period: `M${period.slice(5)}`, value,
      footnotes: prelim ? [{ code: 'P' }] : [{}],
    })
    const cpi = parseCpiResponse(
      {
        CUUR0490SAF11: [p('2025-01', '100'), p('2026-08', '104')],
        CUUR0490SAH1: [p('2025-01', '100'), p('2026-08', '105', true)],
        CUUR0490SA0E: [p('2025-01', '100'), p('2026-08', '99')],
      },
      { areaCode: '0490', areaName: 'Pacific', tier: 2 }
    )
    expect(cpi.series.map((s) => s.preliminary)).toEqual([undefined, true])
  })
})
