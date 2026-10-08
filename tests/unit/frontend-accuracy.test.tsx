import '@testing-library/jest-dom'
/**
 * Render-level checks for the frontend data-accuracy fixes: flagged county metrics carry their note,
 * rent $ wording, preliminary points, census income provenance, the CPI-shelter vs Zillow explanation,
 * chart windows that end on the hero %, share-card geography/baselines, and the Housing graph tabs.
 */
import fs from 'fs'
import path from 'path'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { HeroCards } from '@/components/HeroCards'
import { EraChart } from '@/components/charts/EraChart'
import { getChartInput } from '@/components/charts/ChartsSection'
import { HousingChart } from '@/components/charts/HousingChart'
import { chartConfigs } from '@/lib/charts/chart-config'
import { filterByTimeframe, splitPreliminary } from '@/lib/charts/chart-data'
import {
  buildRentCard, buildShelterCard, nationalChangeMatching, monthOlderThan,
  SHELTER_VS_RENT_NOTE, HOUSING_NOTE, SHELTER_SHORT_NOTE, GAS_SOURCE, buildGasCard,
} from '@/lib/hero-cards'
import { computeDotX, computeDotY } from '@/lib/share-card/og-geometry'
import { getCensusData } from '@/lib/data/census-acs'
import { fmtDollars, fmtMonthYear, fmtSignedPct } from '@/lib/format'
import type { EconomicSnapshot } from '@/types'
import type { CountyRecord, UsHousing } from '@/lib/county-data'
import austin from '../fixtures/snapshots/78701.json'

jest.mock('next/og', () => ({ ImageResponse: class {} }))
jest.mock('@/lib/api/snapshot', () => ({ fetchSnapshot: jest.fn() }))
jest.mock('@/lib/county-data', () => {
  const actual = jest.requireActual('@/lib/county-data')
  return { ...actual, fetchLocalMeta: jest.fn(), fetchCounty: jest.fn(), fetchUsHousing: jest.fn() }
})
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cd = require('@/lib/county-data')

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
const tx = readJson<Record<string, CountyRecord>>('public/data/county/48.json')
const us = readJson<UsHousing>('public/data/us-housing.json')
const clone = (): EconomicSnapshot => JSON.parse(JSON.stringify(austin))

beforeEach(() => {
  cd.fetchLocalMeta.mockResolvedValue(readJson('public/data/meta.json'))
  cd.fetchCounty.mockResolvedValue(null)
  cd.fetchUsHousing.mockResolvedValue(us)
})
const shelterConfig = chartConfigs.find(c => c.id === 'cpi-shelter')!

// ---------------------------------------------------------------- flags / notes
describe('flagged county metrics show their note', () => {
  test('Housing graph Rent tab carries the flag caveat for a flagged county rent', async () => {
    cd.fetchCounty.mockResolvedValue({ ...tx['48453'], flags: ['rent'] })
    render(<HousingChart snapshot={clone()} shelterConfig={shelterConfig} />)
    expect(await screen.findByTestId('flag-note')).toHaveTextContent('Unusual value: far outside the range')
  })

  test('unflagged county: no caveat', async () => {
    cd.fetchCounty.mockResolvedValue({ ...tx['48453'], flags: undefined, note: undefined })
    render(<HousingChart snapshot={clone()} shelterConfig={shelterConfig} />)
    await screen.findByTestId('housing-headline')
    expect(screen.queryByTestId('flag-note')).toBeNull()
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
    expect(m.inline).toMatch(/^≈ [+−]\$\d+\/mo$/)
    expect(m.dollarNote).toMatch(/^≈ [+−]\$\d+\/mo vs Jan 2025, after adjusting for the usual seasonal (rise|swing)$/)
    expect(m.info).toContain(`${m.dollarNote}.`)
    expect(m.info).toContain(m.detail)
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

// ---------------------------------------------------------------- preliminary points
describe('preliminary points', () => {
  test('chart splits preliminary points into a dashed series that connects to the last final point', () => {
    const { rows, hasPreliminary } = splitPreliminary([
      { date: '2026-06', rate: 4 }, { date: '2026-07', rate: 4.1 }, { date: '2026-08', rate: 3.9, preliminary: true },
    ], 'rate')
    expect(hasPreliminary).toBe(true)
    expect(rows[0].rate_prelim).toBeUndefined()
    expect(rows[1]).toMatchObject({ rate: 4.1, rate_prelim: 4.1 })
    expect(rows[2]).toMatchObject({ rate: null, rate_prelim: 3.9 })
  })

})

// ---------------------------------------------------------------- census rent provenance (shelter $ base)
describe('census rent provenance on the shelter card', () => {
  const shelterOnly = (census: ReturnType<typeof getCensusData>) => {
    const s = clone()
    s.rent = null
    s.census.data = census
    return s
  }

  test('98687 (PO box) labels the actual donor zip and how it was chosen', () => {
    const census = getCensusData('98687')
    const m = buildShelterCard(shelterOnly(census))
    expect(m.detail).toMatch(new RegExp(`borrowed from zip ${census.donorZip} \\(largest residential zip in the (same )?(city|county)\\)`))
  })

  test('legacy approxFromZip without a scope never claims "nearest"', () => {
    const s = clone()
    s.census.data = { ...s.census.data!, approxFromZip: '98682' }
    const shelter = buildShelterCard(s)
    expect(shelter.detail ?? '').not.toContain('nearest')
  })

  test('no Census rent at any level (Guam 96910) → no dollar estimate, said plainly', () => {
    const m = buildShelterCard(shelterOnly(getCensusData('96910')))
    expect(m.inline).toBeUndefined()
    expect(m.detail).toBe('No local rent figure for a dollar estimate.')
  })
})

// ---------------------------------------------------------------- shelter vs rent explanation
describe('CPI shelter vs Zillow rent explanation', () => {
  test('shelter tab: one short line under the graph, the full CPI-vs-Zillow note in its ⓘ disclosure', () => {
    const s = clone()
    const input = getChartInput('cpi-shelter', s)
    expect(input.note).toBe(SHELTER_SHORT_NOTE)
    expect(input.info).toEqual([HOUSING_NOTE])
    render(<EraChart config={shelterConfig} data={input.data} nationalData={input.nationalData} provenance={input.provenance} note={input.note} info={input.info} />)
    expect(screen.getByTestId('chart-note')).toHaveTextContent('trails new-lease rents by about a year')
    expect(screen.getByTestId('chart-note').textContent!.length).toBeLessThanOrEqual(100)
    const btn = screen.getByTestId('chart-info-toggle')
    const panel = screen.getByTestId('chart-info')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(btn.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel).toHaveAttribute('hidden')
    expect(panel).toHaveTextContent('not mortgage payments or home prices')
    fireEvent.click(btn)
    expect(panel).not.toHaveAttribute('hidden')
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(panel).toHaveAttribute('hidden')
    expect(btn).toHaveFocus()
  })

  test('the Rent card carries the CPI-vs-Zillow note in its ⓘ disclosure', () => {
    render(<HeroCards snapshot={clone()} />)
    expect(within(screen.getByTestId('stat-card-rent')).getByTestId('stat-info')).toHaveTextContent(SHELTER_VS_RENT_NOTE)
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
      { date: '2024-12', groceries: 200, shelter: 300 },
      { date: '2025-02', groceries: 202, shelter: 303 },
      { date: '2025-04', groceries: 206, shelter: 306 },
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

// ---------------------------------------------------------------- Housing graph tabs
describe('Housing graph', () => {
  test('defaults to Rent when the county has Zillow rent; its latest % equals the Rent card %', async () => {
    const s = clone()
    cd.fetchCounty.mockResolvedValue(tx['48453'])
    render(<HousingChart snapshot={s} shelterConfig={shelterConfig} />)
    const pct = await screen.findByTestId('housing-headline-pct')
    expect(screen.getByTestId('housing-chart')).toHaveAttribute('data-tab', 'rent')
    expect(pct).toHaveTextContent(fmtSignedPct(s.rent!.pct))
    expect(buildRentCard(s)!.value).toBe(pct.textContent)
    expect(screen.getByTestId('provenance')).toHaveTextContent('Zillow ZORI · Travis County, TX, monthly')
    expect(screen.getByTestId('provenance')).toHaveTextContent('seasonally adjusted by whatchanged')
    expect(screen.getByTestId('chart-note')).toHaveTextContent('same series as the Rent card')
    // the long CPI-vs-Zillow explanation is in the ⓘ, not under the graph
    expect(screen.getByTestId('chart-info')).toHaveTextContent(HOUSING_NOTE)
    expect(screen.getByTestId('chart-note')).not.toHaveTextContent('owners')
  })

  test('Home prices tab: ZHVI series, labeled smoothed and seasonally adjusted by Zillow', async () => {
    cd.fetchCounty.mockResolvedValue(tx['48453'])
    render(<HousingChart snapshot={clone()} shelterConfig={shelterConfig} />)
    await screen.findByTestId('housing-headline-pct')
    fireEvent.click(screen.getByTestId('housing-tab-homePrices'))
    expect(screen.getByTestId('housing-chart')).toHaveAttribute('data-tab', 'homePrices')
    expect(screen.getByTestId('housing-headline-pct')).toHaveTextContent(fmtSignedPct(tx['48453'].hv!))
    expect(screen.getByTestId('provenance')).toHaveTextContent('Zillow Home Value Index (ZHVI)')
    expect(screen.getByTestId('provenance')).toHaveTextContent('smoothed and seasonally adjusted by Zillow')
    expect(screen.getByTestId('chart-info')).toHaveTextContent("Zillow's smoothed, seasonally adjusted")
    expect(screen.getByTestId('chart-note')).toHaveTextContent('smoothed and seasonally adjusted')
  })

  test('Shelter (CPI) tab shows the BLS CPI shelter series', async () => {
    cd.fetchCounty.mockResolvedValue(tx['48453'])
    render(<HousingChart snapshot={clone()} shelterConfig={shelterConfig} />)
    await screen.findByTestId('housing-headline-pct')
    fireEvent.click(screen.getByTestId('housing-tab-shelter'))
    expect(screen.getByTestId('provenance')).toHaveTextContent('BLS CPI shelter')
  })

  test('no Zillow rent: defaults to Shelter (CPI), Rent tab disabled with a note', async () => {
    const s = clone()
    s.rent = null
    const { rentS: _r, rent: _p, ...noRent } = tx['48453']
    void _r; void _p
    cd.fetchCounty.mockResolvedValue(noRent)
    render(<HousingChart snapshot={s} shelterConfig={shelterConfig} />)
    expect(await screen.findByTestId('housing-missing-note')).toHaveTextContent('No Zillow rent data for Travis County, TX')
    expect(screen.getByTestId('housing-tab-rent')).toBeDisabled()
    expect(screen.getByTestId('housing-tab-homePrices')).not.toBeDisabled()
    expect(screen.getByTestId('housing-chart')).toHaveAttribute('data-tab', 'shelter')
  })

  test('county shard failure: Zillow tabs disabled, Shelter (CPI) still shown', async () => {
    cd.fetchCounty.mockRejectedValue(new Error('HTTP 500'))
    render(<HousingChart snapshot={clone()} shelterConfig={shelterConfig} />)
    expect(await screen.findByTestId('housing-missing-note')).toHaveTextContent('Zillow data is unavailable right now')
    await waitFor(() => expect(screen.getByTestId('housing-chart')).toHaveAttribute('data-tab', 'shelter'))
  })
})

describe('round 7: housing note wording and Zillow stale badge', () => {
  test('HOUSING_NOTE says what CPI shelter measures (OER, not mortgages or home prices)', () => {
    expect(HOUSING_NOTE).toContain("owners' equivalent rent")
    expect(HOUSING_NOTE).toContain('not mortgage payments or home prices')
    expect(HOUSING_NOTE).not.toContain('what all renters and homeowners pay')
  })

  test('Zillow tabs get the stale badge when the shard series ended more than 60 days ago', async () => {
    const { zillowTabInput } = await import('@/components/charts/HousingChart')
    const county = { n: 'Travis County, TX', rentS: { start: '2025-01', v: [1600, 1610, 1620] } } as unknown as CountyRecord
    // series ends Mar 2025 (month end Mar 31)
    expect(zillowTabInput('rent', county, null, 'Travis', new Date('2025-05-15T00:00:00Z')).stale).toBe(false)
    expect(zillowTabInput('rent', county, null, 'Travis', new Date('2025-06-15T00:00:00Z')).stale).toBe(true)
    expect(zillowTabInput('homePrices', county, null, 'Travis', new Date('2026-06-15T00:00:00Z')).stale).toBe(false) // no data → no badge
  })
})
