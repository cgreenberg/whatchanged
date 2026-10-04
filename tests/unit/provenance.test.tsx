import '@testing-library/jest-dom'
/**
 * Every card (hero, chart, unemployment headline, local pulse) renders a full provenance line:
 * source · geography · window · as-of · adjustment — with an as-of taken from the data.
 */
import fs from 'fs'
import path from 'path'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { HeroCards } from '@/components/HeroCards'
import { EraChart } from '@/components/charts/EraChart'
import { getChartInput, UnemploymentHeadline } from '@/components/charts/ChartsSection'
import { chartConfigs } from '@/lib/charts/chart-config'
import { buildHeroCards } from '@/lib/hero-cards'
import { isCompleteProvenance, cpiTierOf, cpiGeoLabel } from '@/lib/provenance'
import type { EconomicSnapshot } from '@/types'
import type { CountyPulse, PulseMeta } from '@/lib/local-pulse'
import austin from '../fixtures/snapshots/78701.json'
import stamford from '../fixtures/snapshots/06902.json'

const clone = (s: unknown): EconomicSnapshot => JSON.parse(JSON.stringify(s))
const root = path.join(__dirname, '..', '..')
const meta: PulseMeta = JSON.parse(fs.readFileSync(path.join(root, 'public/data/meta.json'), 'utf8'))
const txCounties: Record<string, CountyPulse> = JSON.parse(fs.readFileSync(path.join(root, 'public/data/county/48.json'), 'utf8'))
const zip787: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(root, 'public/data/zip/787.json'), 'utf8'))
const txCities: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(root, 'public/data/cities/TX.json'), 'utf8'))

jest.mock('@/lib/local-pulse', () => {
  const actual = jest.requireActual('@/lib/local-pulse')
  return {
    ...actual,
    fetchPulseMeta: jest.fn(),
    fetchCounty: jest.fn(),
    fetchZipPulse: jest.fn(),
    fetchCity: jest.fn(),
  }
})
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lp = require('@/lib/local-pulse')

// Recharts' ResponsiveContainer has no size in jsdom; silence its size warnings only
const warn = console.warn
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('of chart should be greater than 0')) return
    warn(...args)
  })
})
afterAll(() => (console.warn as jest.Mock).mockRestore())

const CURRENT_MONTH = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

/** A rendered provenance line has five non-empty parts. */
function expectFullLine(el: HTMLElement) {
  const parts = (el.textContent ?? '').split(' · ').map(s => s.trim())
  expect(parts.length).toBeGreaterThanOrEqual(5)
  parts.forEach(p => expect(p.length).toBeGreaterThan(0))
}

describe('hero card provenance', () => {
  test.each([['78701', austin], ['06902', stamford]])('%s: every hero card model has complete provenance', (_z, fx) => {
    for (const card of buildHeroCards(clone(fx))) {
      expect(isCompleteProvenance(card.provenance)).toBe(true)
    }
  })

  test('rendered hero cards each show a full provenance line', () => {
    render(<HeroCards snapshot={clone(austin)} />)
    const cards = within(screen.getByTestId('stat-cards')).getAllByTestId(/^stat-card-/)
    expect(cards).toHaveLength(4)
    for (const c of cards) expectFullLine(within(c).getByTestId('provenance'))
  })

  test('unavailable cards still carry provenance, with "date unavailable" not today', () => {
    const snap = clone(austin)
    snap.cpi = { ...snap.cpi, data: null }
    snap.gas = { ...snap.gas, data: null }
    snap.rent = null
    render(<HeroCards snapshot={snap} />)
    for (const id of ['gas', 'shelter', 'groceries']) {
      const line = within(screen.getByTestId(`stat-card-${id}`)).getByTestId('provenance')
      expectFullLine(line)
      expect(line).toHaveTextContent('date unavailable')
      expect(line).not.toHaveTextContent(CURRENT_MONTH)
    }
  })

  test('rent card provenance: Zillow ZORI · county · since baseline · as-of · SA by whatchanged', () => {
    const snap = clone(austin)
    render(<HeroCards snapshot={snap} />)
    const line = within(screen.getByTestId('stat-card-rent')).getByTestId('provenance')
    expect(line.textContent).toBe(
      `Zillow ZORI · ${snap.rent!.geoName} · since Jan 2025 · Aug 2026 · seasonally adjusted by whatchanged`
    )
  })
})

describe('chart provenance', () => {
  test.each(chartConfigs.map(c => [c.id, c] as const))('%s chart shows a full provenance line', (id, config) => {
    const input = getChartInput(id, clone(austin))
    render(<EraChart config={config} data={input.data} nationalData={input.nationalData} provenance={input.provenance} />)
    expectFullLine(screen.getByTestId('provenance'))
  })

  test('CPI charts say "% change since {first visible month}"', () => {
    const config = chartConfigs.find(c => c.id === 'cpi-shelter')!
    const input = getChartInput('cpi-shelter', clone(austin))
    render(<EraChart config={config} data={input.data} nationalData={input.nationalData} provenance={input.provenance} />)
    expect(screen.getByTestId('chart-window')).toHaveTextContent('% change since Jan 2025')
  })

  test('unemployment chart is labeled not seasonally adjusted', () => {
    const input = getChartInput('unemployment', clone(austin))
    expect(input.provenance.adjustment).toBe('not seasonally adjusted')
  })

  test('unemployment headline uses the 3-month SA averages and full provenance', () => {
    render(<UnemploymentHeadline county={txCounties['48453']} meta={meta} countyName="Travis County" />)
    const h = screen.getByTestId('unemployment-headline')
    expect(h).toHaveTextContent('3-month avg, seasonally adjusted by whatchanged')
    expect(h).toHaveTextContent(`${txCounties['48453'].urBase!.toFixed(1)}% → ${txCounties['48453'].urCur!.toFixed(1)}%`)
    expectFullLine(within(h).getByTestId('provenance'))
  })

  test('unemployment chart mentions the dashed U.S. line only while it is shown', () => {
    const config = chartConfigs.find(c => c.id === 'unemployment')!
    const input = getChartInput('unemployment', clone(austin))
    expect(input.provenance.geography).not.toContain('dashed')
    render(<EraChart config={config} data={input.data} nationalData={input.nationalData}
      provenance={input.provenance} nationalLabel={input.nationalLabel} />)
    expect(screen.getByTestId('provenance')).not.toHaveTextContent('dashed')
    if (input.nationalData.length && config.showNationalToggle) {
      fireEvent.click(screen.getByLabelText('Show national'))
      expect(screen.getByTestId('provenance')).toHaveTextContent('dashed: U.S.')
    }
  })

  test('CT chart names the planning region, not the legacy county', () => {
    const s = clone(stamford)
    s.unemployment.data = { ...s.unemployment.data!, lausFips: '09190', lausAreaName: 'Western Connecticut Planning Region' }
    expect(getChartInput('unemployment', s).provenance.geography).toBe('Western Connecticut planning region, monthly')
  })

  test('CT headline is labeled as an approximation and names both areas when they differ', () => {
    const ct: Record<string, CountyPulse> = JSON.parse(fs.readFileSync(path.join(root, 'public/data/county/09.json'), 'utf8'))
    render(<UnemploymentHeadline county={ct['09001']} meta={meta} countyName="Fairfield County"
      chartArea="Greater Bridgeport planning region, CT" />)
    const h = screen.getByTestId('unemployment-headline')
    expect(within(h).getByTestId('unemployment-approx-note')).toHaveTextContent('Western Connecticut planning region')
    expect(within(h).getByTestId('unemployment-approx-note')).toHaveTextContent('Greater Bridgeport planning region, CT')
    expect(within(h).getByTestId('provenance')).toHaveTextContent('Western Connecticut planning region (approximates Fairfield County, CT)')
  })
})

describe('stale CPI tier inference (entries cached before `tier` existed)', () => {
  const base = { metro: 'X', seriesIds: undefined, areaCode: undefined, tier: undefined } as never
  test.each([
    ['0000', 4], ['0300', 3], ['0480', 2], ['0110', 2], ['S12A', 1], ['S49F', 1],
  ])('area %s → tier %i', (code, tier) => {
    expect(cpiTierOf({ ...(base as object), areaCode: code } as never)).toBe(tier)
  })
  test('Urban Hawaii (metro S49F) is not mislabeled as a region', () => {
    expect(cpiGeoLabel({ metro: 'Urban Hawaii', seriesIds: { groceries: 'CUURS49FSAF11', shelter: '', energy: '' } } as never))
      .toBe('metro: Urban Hawaii')
  })
})

describe('local pulse provenance', () => {
  beforeEach(() => {
    lp.fetchPulseMeta.mockResolvedValue(meta)
    lp.fetchCounty.mockResolvedValue(txCounties['48453'])
    lp.fetchZipPulse.mockResolvedValue(zip787['78701'] ?? null)
    lp.fetchCity.mockResolvedValue(Object.values(txCities).find((c) => (c as { n: string }).n === 'Austin') ?? null)
  })

  test('every pulse card renders a full provenance line', async () => {
    const { LocalPulse } = await import('@/components/pulse/LocalPulse')
    render(<LocalPulse zip="78701" countyFips="48453" countyName="Travis County" cityName="Austin" stateAbbr="TX" heroShowsCountyRent />)
    await waitFor(() => expect(screen.getByTestId('local-pulse')).toBeInTheDocument())
    const cards = screen.getAllByTestId(/^pulse-/)
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) expectFullLine(within(c).getByTestId('provenance'))
  })

  test('with the county rent in the hero, the pulse rent card shows only finer-grained detail', async () => {
    const { LocalPulse } = await import('@/components/pulse/LocalPulse')
    render(<LocalPulse zip="78701" countyFips="48453" countyName="Travis County" cityName="Austin" stateAbbr="TX" heroShowsCountyRent />)
    await waitFor(() => expect(screen.getByTestId('local-pulse')).toBeInTheDocument())
    const rentCard = screen.queryByTestId('pulse-rent')
    if (rentCard) {
      expect(rentCard).not.toHaveTextContent('Rent on new leases · Travis County')
      expect(rentCard).not.toHaveTextContent('used elsewhere on this site')
    }
  })
})
