import '@testing-library/jest-dom'
/**
 * Every card (hero, chart, each Housing graph tab) renders a full provenance line:
 * source · geography · window · as-of · adjustment — with an as-of taken from the data.
 */
import fs from 'fs'
import path from 'path'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { HeroCards } from '@/components/HeroCards'
import { EraChart } from '@/components/charts/EraChart'
import { getChartInput } from '@/components/charts/ChartsSection'
import { HousingChart } from '@/components/charts/HousingChart'
import { chartConfigs } from '@/lib/charts/chart-config'
import { buildHeroCards } from '@/lib/hero-cards'
import { isCompleteProvenance, cpiTierOf, cpiGeoLabel } from '@/lib/provenance'
import type { EconomicSnapshot } from '@/types'
import type { CountyRecord, UsHousing } from '@/lib/county-data'
import austin from '../fixtures/snapshots/78701.json'
import stamford from '../fixtures/snapshots/06902.json'

const clone = (s: unknown): EconomicSnapshot => JSON.parse(JSON.stringify(s))
const root = path.join(__dirname, '..', '..')
const txCounties: Record<string, CountyRecord> = JSON.parse(fs.readFileSync(path.join(root, 'public/data/county/48.json'), 'utf8'))
const usHousing: UsHousing = JSON.parse(fs.readFileSync(path.join(root, 'public/data/us-housing.json'), 'utf8'))

jest.mock('@/lib/county-data', () => {
  const actual = jest.requireActual('@/lib/county-data')
  return { ...actual, fetchCounty: jest.fn(), fetchUsHousing: jest.fn(), fetchLocalMeta: jest.fn() }
})
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cd = require('@/lib/county-data')

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

  test('CPI and gas charts are labeled not seasonally adjusted', () => {
    for (const id of ['gas', 'cpi-groceries', 'cpi-shelter', 'cpi-energy']) {
      expect(getChartInput(id, clone(austin)).provenance.adjustment).toBe('not seasonally adjusted')
    }
  })

  test('gas chart mentions the dashed U.S. line only while it is shown', () => {
    const config = chartConfigs.find(c => c.id === 'gas')!
    const input = getChartInput('gas', clone(austin))
    render(<EraChart config={config} data={input.data} nationalData={input.nationalData}
      provenance={input.provenance} nationalLabel="U.S." />)
    expect(screen.getByTestId('provenance')).not.toHaveTextContent('dashed')
    if (input.nationalData.length && config.showNationalToggle) {
      fireEvent.click(screen.getByLabelText('Show national'))
      expect(screen.getByTestId('provenance')).toHaveTextContent('dashed: U.S.')
    }
  })
})

describe('Housing graph provenance', () => {
  beforeEach(() => {
    cd.fetchCounty.mockResolvedValue(txCounties['48453'])
    cd.fetchUsHousing.mockResolvedValue(usHousing)
  })
  const shelterConfig = chartConfigs.find(c => c.id === 'cpi-shelter')!

  test.each(['rent', 'homePrices', 'shelter'])('%s tab shows a full provenance line', async tab => {
    render(<HousingChart snapshot={clone(austin)} shelterConfig={shelterConfig} />)
    await screen.findByTestId('housing-headline-pct')
    fireEvent.click(screen.getByTestId(`housing-tab-${tab}`))
    expect(screen.getByTestId('housing-chart')).toHaveAttribute('data-tab', tab)
    expectFullLine(screen.getByTestId('provenance'))
    expect(screen.getByTestId('chart-window')).toHaveTextContent('% change since Jan 2025')
  })

  test('Zillow tabs offer the U.S. comparison line and name it only while shown', async () => {
    render(<HousingChart snapshot={clone(austin)} shelterConfig={shelterConfig} />)
    await screen.findByTestId('housing-headline-pct')
    expect(screen.getByTestId('provenance')).not.toHaveTextContent('dashed')
    fireEvent.click(screen.getByLabelText('Show national'))
    expect(screen.getByTestId('provenance')).toHaveTextContent('dashed: U.S. ZORI')
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
      .toBe('metro: Honolulu (BLS area: Urban Hawaii)')
  })
})
