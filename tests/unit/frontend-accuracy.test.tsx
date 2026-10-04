import '@testing-library/jest-dom'
/**
 * Render-level checks for the frontend data-accuracy fixes: flagged county metrics carry their note,
 * rent $ wording, preliminary unemployment months, census income provenance, the CPI-shelter vs Zillow
 * explanation, chart windows that end on the hero %, share-card geography/baselines, and paycheck colors.
 */
import fs from 'fs'
import path from 'path'
import { render, screen, waitFor, within } from '@testing-library/react'
import { HeroCards } from '@/components/HeroCards'
import { EraChart } from '@/components/charts/EraChart'
import { getChartInput, preliminaryMonths, UnemploymentHeadline } from '@/components/charts/ChartsSection'
import { chartConfigs } from '@/lib/charts/chart-config'
import { filterByTimeframe, splitPreliminary } from '@/lib/charts/chart-data'
import {
  buildRentCard, buildTariffCard, buildShelterCard, nationalChangeMatching, monthOlderThan,
  SHELTER_VS_RENT_NOTE, SHELTER_NOTE_NO_RENT, GAS_SOURCE, buildGasCard,
} from '@/lib/hero-cards'
import { computeDotX, computeDotY } from '@/lib/share-card/og-geometry'
import { cpiShareLabel, sinceLabel } from '@/lib/share-card/generate'
import { getCensusData } from '@/lib/data/census-acs'
import { estimateTariffCost, TARIFF_COST_RATE } from '@/lib/tariff'
import { fmtDollars, fmtMonthYear } from '@/lib/format'
import type { EconomicSnapshot } from '@/types'
import type { CountyPulse, PulseMeta } from '@/lib/local-pulse'
import austin from '../fixtures/snapshots/78701.json'

jest.mock('next/og', () => ({ ImageResponse: class {} }))
jest.mock('@/lib/api/snapshot', () => ({ fetchSnapshot: jest.fn() }))
jest.mock('@/lib/local-pulse', () => {
  const actual = jest.requireActual('@/lib/local-pulse')
  return { ...actual, fetchPulseMeta: jest.fn(), fetchCounty: jest.fn(), fetchZipPulse: jest.fn(), fetchCity: jest.fn() }
})
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lp = require('@/lib/local-pulse')

const warn = console.warn
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('of chart should be greater than 0')) return
    warn(...args)
  })
})
afterAll(() => (console.warn as jest.Mock).mockRestore())

const root = path.join(__dirname, '..', '..')
const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const meta = readJson<PulseMeta>('public/data/meta.json')
const nc = readJson<Record<string, CountyPulse>>('public/data/county/37.json')
const pr = readJson<Record<string, CountyPulse>>('public/data/county/72.json')
const al = readJson<Record<string, CountyPulse>>('public/data/county/01.json')
const clone = (): EconomicSnapshot => JSON.parse(JSON.stringify(austin))

beforeEach(() => {
  lp.fetchPulseMeta.mockResolvedValue(meta)
  lp.fetchCounty.mockResolvedValue(null)
  lp.fetchZipPulse.mockResolvedValue(null)
  lp.fetchCity.mockResolvedValue(null)
})

// ---------------------------------------------------------------- flags / notes
describe('flagged county metrics show their note', () => {
  test('Buncombe NC (37021): unemployment headline carries the Helene baseline note', () => {
    render(<UnemploymentHeadline county={nc['37021']} meta={meta} countyName="Buncombe County" />)
    const note = screen.getByTestId('flag-note')
    expect(note).toHaveTextContent('Unusual value')
    expect(note).toHaveTextContent('Hurricane Helene')
  })

  test('Adjuntas PR (00601 → 72001): flagged without a note gets the generic caveat', () => {
    expect(pr['72001'].flags).toContain('ur')
    render(<UnemploymentHeadline county={pr['72001']} meta={meta} countyName="Adjuntas Municipio" />)
    expect(screen.getByTestId('flag-note')).toHaveTextContent('Unusual value: far outside the range')
  })

  test('unflagged county: no caveat', () => {
    const c = { ...nc['37021'], flags: undefined, note: undefined }
    render(<UnemploymentHeadline county={c} meta={meta} countyName="Buncombe County" />)
    expect(screen.queryByTestId('flag-note')).toBeNull()
  })

  test('paychecks card shows the wage/real caveat (St. Clair AL, 01115)', async () => {
    lp.fetchCounty.mockResolvedValue(al['01115'])
    const { LocalPulse } = await import('@/components/pulse/LocalPulse')
    render(<LocalPulse zip="35120" countyFips="01115" countyName="St. Clair County" stateAbbr="AL" />)
    const card = await screen.findByTestId('pulse-paychecks')
    expect(within(card).getByTestId('flag-note')).toHaveTextContent('Unusual value')
  })

  test('hero rent card shows a caveat when the county rent is flagged', () => {
    const m = buildRentCard(clone(), { flags: ['rent'] })!
    expect(m.caveat).toMatch(/^Unusual value/)
    expect(buildRentCard(clone(), { flags: ['hv'] })!.caveat).toBeUndefined()
  })
})

// ---------------------------------------------------------------- rent wording + staleness
describe('rent hero', () => {
  test('dollar line is the SA change in dollars; raw level shown only as a dated level', () => {
    const s = clone()
    const m = buildRentCard(s, null, new Date('2026-10-02'))!
    expect(m.change).toMatch(/^≈ [+−]\$\d+\/mo vs Jan 2025, after adjusting for the usual seasonal (rise|swing)$/)
    expect(m.detail).toBe(`Typical asking rent: ${fmtDollars(s.rent!.curRent)}/mo (${fmtMonthYear(s.rent!.asOf)})`)
    expect(m.detail).not.toMatch(/now|then|was/)
  })

  test('stale badge when the as-of month ended more than 60 days ago', () => {
    const s = clone()
    s.rent!.asOf = '2026-08'
    expect(buildRentCard(s, null, new Date('2026-10-02'))!.stale).toBe(false)
    expect(buildRentCard(s, null, new Date('2026-11-15'))!.stale).toBe(true)
    expect(monthOlderThan('bad', 60)).toBe(false)
  })
})

// ---------------------------------------------------------------- preliminary unemployment
describe('preliminary unemployment months', () => {
  const withSeries = (pts: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => {
    const s = clone()
    s.unemployment.data = { ...s.unemployment.data!, series: pts as never, latestPeriod: pts[pts.length - 1].date as string, ...extra }
    return s
  }

  test('per-point flags mark those months; provenance says (preliminary)', () => {
    const s = withSeries([{ date: '2026-06', rate: 4 }, { date: '2026-07', rate: 4.1 }, { date: '2026-08', rate: 3.9, preliminary: true }])
    expect(preliminaryMonths(s.unemployment.data)).toEqual(['2026-08'])
    const input = getChartInput('unemployment', s)
    expect(input.data[2]).toMatchObject({ date: '2026-08', preliminary: true })
    expect(input.data[1].preliminary).toBeUndefined()
    expect(input.provenance.asOf).toBe('Aug 2026 (preliminary)')
  })

  test('latestPreliminary marks the last point; absent fields fall back to the meta month', () => {
    const a = withSeries([{ date: '2026-07', rate: 4 }, { date: '2026-08', rate: 4 }], { latestPreliminary: true })
    expect(preliminaryMonths(a.unemployment.data)).toEqual(['2026-08'])
    const b = withSeries([{ date: '2026-07', rate: 4 }, { date: '2026-08', rate: 4 }])
    expect(preliminaryMonths(b.unemployment.data, '2026-08')).toEqual(['2026-08'])
    const c = withSeries([{ date: '2026-07', rate: 4, preliminary: false }, { date: '2026-08', rate: 4, preliminary: false }])
    expect(preliminaryMonths(c.unemployment.data, '2026-08')).toEqual([])
  })

  test('chart splits preliminary points into a dashed series that connects to the last final point', () => {
    const { rows, hasPreliminary } = splitPreliminary([
      { date: '2026-06', rate: 4 }, { date: '2026-07', rate: 4.1 }, { date: '2026-08', rate: 3.9, preliminary: true },
    ], 'rate')
    expect(hasPreliminary).toBe(true)
    expect(rows[0].rate_prelim).toBeUndefined()
    expect(rows[1]).toMatchObject({ rate: 4.1, rate_prelim: 4.1 })
    expect(rows[2]).toMatchObject({ rate: null, rate_prelim: 3.9 })
  })

  test('headline says it excludes the preliminary month', () => {
    render(<UnemploymentHeadline county={nc['37021']} meta={meta} countyName="Buncombe County" chartPreliminary={['2026-08']} />)
    expect(screen.getByTestId('unemployment-prelim-note')).toHaveTextContent('excludes the preliminary Aug 2026 figure')
  })
})

// ---------------------------------------------------------------- census provenance
describe('tariff income provenance', () => {
  test('PO-box donor: "borrowed from zip X (largest residential zip in the city)"', () => {
    const s = clone()
    s.census.data = { ...s.census.data!, source: 'acs', donorZip: '10025', donorScope: 'city' } as never
    const m = buildTariffCard(s)
    expect(m.provenance.asOf).toContain('borrowed from zip 10025 (largest residential zip in the city)')
    expect(m.provenance.asOf).not.toContain('nearest')
    expect(m.provenance.geography).toContain('(estimate)')
  })

  test('legacy approxFromZip without a scope never claims "nearest"', () => {
    const s = clone()
    s.census.data = { ...s.census.data!, approxFromZip: '98682' }
    expect(buildTariffCard(s).provenance.asOf).toContain('borrowed from zip 98682 (largest residential zip in the area)')
    const shelter = buildShelterCard(s)
    expect(shelter.detail ?? '').not.toContain('nearest')
  })

  const withCensus = (census: ReturnType<typeof getCensusData>) => {
    const s = clone()
    s.census.data = census
    const income = census.medianIncome
    s.tariff.data = {
      medianIncome: income, tariffRate: TARIFF_COST_RATE, estimatedCost: estimateTariffCost(income),
      source: 'Yale', incomeSource: 'x', isFallback: census.isFallback === true,
    }
    return s
  }

  test('98687 (PO box) labels the actual donor zip and how it was chosen', () => {
    const m = buildTariffCard(withCensus(getCensusData('98687')))
    expect(m.provenance.asOf).toMatch(/^income: Census ACS \d{4}, borrowed from zip \d{5} \(largest residential zip in the (city|county)\)$/)
  })

  test('10020 (no zip income) is labeled with whatever source the lookup used — never as zip ACS', () => {
    const census = getCensusData('10020')
    const m = buildTariffCard(withCensus(census))
    if (census.incomeGeo === 'county') {
      expect(m.provenance.geography).toBe('New York County, NY median income (no zip figure)')
      expect(m.provenance.asOf).toBe(`income: Census ACS ${census.year} county median`)
    } else {
      expect(m.provenance.geography).toBe('national')
    }
    expect(m.provenance.geography).not.toContain('zip 10020 median')
  })

  test('national fallback → geography "national", labeled U.S. median (real source) with no local data', () => {
    const census = {
      ...getCensusData('10020'), source: 'national' as const, incomeGeo: 'national' as const, isFallback: true,
      year: 2022, sourceLabel: 'U.S. median household income, Census CPS ASEC 2022', medianIncome: 74580,
    }
    const m = buildTariffCard(withCensus(census))
    expect(m.provenance.geography).toBe('national')
    expect(m.provenance.asOf).toBe('U.S. median income (Census CPS ASEC 2022) — no local data')
  })
})

// ---------------------------------------------------------------- shelter vs rent explanation
describe('CPI shelter vs Zillow rent explanation', () => {
  test('shelter chart carries the note (rent-aware wording) and renders it', () => {
    const s = clone()
    const input = getChartInput('cpi-shelter', s)
    expect(input.note).toBe(SHELTER_VS_RENT_NOTE)
    s.rent = null
    expect(getChartInput('cpi-shelter', s).note).toBe(SHELTER_NOTE_NO_RENT)
    const config = chartConfigs.find(c => c.id === 'cpi-shelter')!
    render(<EraChart config={config} data={input.data} nationalData={input.nationalData} provenance={input.provenance} note={input.note} />)
    expect(screen.getByTestId('chart-note')).toHaveTextContent('lags market rents by about a year')
  })

  test('hero cards show the note when the Rent card is shown', () => {
    render(<HeroCards snapshot={clone()} />)
    expect(screen.getByTestId('rent-vs-cpi-note')).toHaveTextContent(SHELTER_VS_RENT_NOTE)
  })
})

// ---------------------------------------------------------------- chart window + national months
describe('chart windows match the hero baseline', () => {
  test('bimonthly area (no Jan 2025 value) starts the Jan 2025 view at its Dec 2024 baseline', () => {
    const rows = [
      { date: '2024-10', groceries: 100 }, { date: '2024-12', groceries: 101 },
      { date: '2025-02', groceries: 102 }, { date: '2025-04', groceries: 103 },
    ]
    expect(filterByTimeframe(rows, 'Jan 2025', false, 'groceries')[0].date).toBe('2024-12')
    // without a value key (legacy callers) the old month filter still applies
    expect(filterByTimeframe(rows, 'Jan 2025')[0].date).toBe('2025-02')
  })

  test('chart endpoint equals the hero % for a Dec-2024-baseline area', () => {
    const s = clone()
    const c = s.cpi.data!
    c.series = [
      { date: '2024-12', groceries: 200, shelter: 300, energy: 100 },
      { date: '2025-02', groceries: 202, shelter: 303, energy: 100 },
      { date: '2025-04', groceries: 206, shelter: 306, energy: 100 },
    ]
    const shown = filterByTimeframe(getChartInput('cpi-groceries', s).data, 'Jan 2025', false, 'groceries')
    const first = shown[0].groceries as number
    const last = shown[shown.length - 1].groceries as number
    expect(((last - first) / first) * 100).toBeCloseTo(3)
  })

  test('national change never covers a later month than the local figure', () => {
    const nat = [
      { date: '2025-01', v: 100 }, { date: '2026-07', v: 103 }, { date: '2026-08', v: 104 },
    ]
    const r = nationalChangeMatching(nat, p => p.v, '2025-01', '2026-07')!
    expect(r.latestPeriod).toBe('2026-07')
    expect(r.pct).toBeCloseTo(3)
    const dec = nationalChangeMatching([{ date: '2024-12', v: 50 }, ...nat], p => p.v, '2024-12', '2026-08')!
    expect(dec.baselinePeriod).toBe('2024-12')
  })
})

// ---------------------------------------------------------------- share card helpers + OG geometry
describe('share card labels and OG geometry', () => {
  test('CPI label names the geography type', () => {
    const c = clone().cpi.data!
    expect(cpiShareLabel(c)).toBe('CPI: West South Central (Census division)')
    expect(cpiShareLabel({ ...c, tier: 1, metro: 'Chicago-Naperville-Elgin' })).toBe('CPI: Chicago-Naperville-Elgin (metro)')
    expect(cpiShareLabel({ ...c, tier: 4, metro: 'National' })).toBe('CPI: national')
  })

  test('since-label uses the actual baseline month', () => {
    expect(sinceLabel('2024-12')).toBe('since Dec 2024')
    expect(sinceLabel(undefined)).toBe('since Jan 2025')
  })

  test('computeDotX/Y never return NaN or Infinity for 0/1-point series', () => {
    for (const series of [[], [{ value: 3 }]]) {
      for (const i of [0, -1]) {
        expect(Number.isFinite(computeDotX(series, i, 265))).toBe(true)
        expect(Number.isFinite(computeDotY(series, i, 120))).toBe(true)
      }
    }
    expect(computeDotX([{ value: 1 }, { value: 2 }], -1, 265)).toBe(255)
  })

  test('gas provenance names regular gasoline', () => {
    expect(buildGasCard(clone()).provenance.source).toBe(GAS_SOURCE)
    expect(GAS_SOURCE).toContain('regular')
  })
})

// ---------------------------------------------------------------- pulse colors + asOf + rent caption
describe('local pulse', () => {
  test('paychecks: price change colored by sign (a fall is not red)', async () => {
    lp.fetchCounty.mockResolvedValue({ ...al['01115'], flags: undefined, cpi: -1.2, wage: 2, real: 3.2 })
    const { LocalPulse } = await import('@/components/pulse/LocalPulse')
    render(<LocalPulse zip="35120" countyFips="01115" countyName="St. Clair County" stateAbbr="AL" />)
    const card = await screen.findByTestId('pulse-paychecks')
    const prices = within(card).getByText('-1.2%')
    expect(prices).toHaveStyle({ color: '#22C55E' })
    expect(within(card).getByText('+2.0%')).toHaveStyle({ color: '#22C55E' })
  })

  test('zip rent sparkline is captioned and provenance uses the row as-of month', async () => {
    const zip = readJson<Record<string, { rent?: { asOf: string } }>>('public/data/zip/787.json')['78701']
    lp.fetchZipPulse.mockResolvedValue({ ...zip, rent: { ...zip.rent!, asOf: '2026-06' } })
    lp.fetchCounty.mockResolvedValue(null)
    const { LocalPulse } = await import('@/components/pulse/LocalPulse')
    render(<LocalPulse zip="78701" countyFips="48453" countyName="Travis County" stateAbbr="TX" heroShowsCountyRent />)
    const card = await screen.findByTestId('pulse-rent')
    expect(card).toHaveTextContent('Trend line: zip 78701 estimate')
    await waitFor(() => expect(within(card).getByTestId('provenance')).toHaveTextContent('Jun 2026'))
    expect(card).toHaveTextContent('Typical asking rent: $3,104/mo (Jun 2026)')
  })
})
