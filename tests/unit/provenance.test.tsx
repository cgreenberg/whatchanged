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
import { buildHeroCards, SHELTER_VS_RENT_NOTE } from '@/lib/hero-cards'
import { isCompleteProvenance, cpiTierOf, cpiGeoLabel } from '@/lib/provenance'
import type { EconomicSnapshot } from '@/types'
import type { CountyRecord, UsHousing } from '@/lib/county-data'
import austin from '../fixtures/snapshots/78701.json'
import stamford from '../fixtures/snapshots/06902.json'
import nyc from '../fixtures/snapshots/10001.json'
import vancouver from '../fixtures/snapshots/98683.json'

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

  test('rendered hero cards: short source line on the card, full provenance line in the ⓘ disclosure', () => {
    render(<HeroCards snapshot={clone(austin)} />)
    const cards = within(screen.getByTestId('stat-cards')).getAllByTestId(/^stat-card-/)
    expect(cards).toHaveLength(4)
    for (const c of cards) {
      const panel = within(c).getByTestId('stat-info')
      // the full line lives inside the disclosure (one tap away), never on the card face
      expectFullLine(within(panel).getAllByTestId('provenance')[0])
      expect(within(c).getAllByTestId('provenance').every(l => panel.contains(l))).toBe(true)
      // the card face has the short "{area} · {source} · {Mon YYYY}" line
      expect(within(c).getByTestId('stat-source').textContent!.length).toBeGreaterThan(0)
    }
    const src = (id: string) => within(screen.getByTestId(`stat-card-${id}`)).getByTestId('stat-source').textContent
    expect(src('gas')).toMatch(/ · (EIA|BLS) · [A-Z][a-z]{2} (\d{1,2}, )?\d{4}$/)
    expect(src('rent')).toBe('Travis County · Zillow · Aug 2026')
    expect(src('groceries')).toBe('West South Central div. · BLS · Aug 2026')
    expect(src('electricity')).toBe('Texas · EIA · Jul 2026')
  })

  test('ⓘ is an accessible disclosure: button with aria-expanded/aria-controls, toggles, Escape closes', () => {
    render(<HeroCards snapshot={clone(austin)} />)
    const c = screen.getByTestId('stat-card-rent')
    const btn = within(c).getByRole('button', { name: /sources and details for Rent/i })
    const panel = within(c).getByTestId('stat-info')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(btn.getAttribute('aria-controls')).toBe(panel.id)
    // (framer-motion's entry opacity hides everything from toBeVisible in jsdom: check the hidden attribute)
    expect(panel).toHaveAttribute('hidden')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(panel).not.toHaveAttribute('hidden')
    expect(within(panel).getByTestId('provenance')).toHaveTextContent('Zillow ZORI')
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveAttribute('hidden')
    expect(btn).toHaveFocus()
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

  test('rent card provenance (in ⓘ): Zillow ZORI · county · since baseline · as-of · SA by whatchanged', () => {
    const snap = clone(austin)
    render(<HeroCards snapshot={snap} />)
    const line = within(within(screen.getByTestId('stat-card-rent')).getByTestId('stat-info')).getByTestId('provenance')
    expect(line.textContent).toBe(
      `Zillow ZORI · ${snap.rent!.geoName} · since Jan 2025 · Aug 2026 · seasonally adjusted by whatchanged`
    )
    // the Zillow-vs-CPI note moved into the rent card's disclosure
    expect(within(screen.getByTestId('stat-card-rent')).getByTestId('stat-info')).toHaveTextContent(SHELTER_VS_RENT_NOTE)
  })
})

/** Visible card text (everything except the ⓘ disclosure). */
function visibleText(c: HTMLElement): string {
  const panel = within(c).getByTestId('stat-info')
  return (c.textContent ?? '').replace(panel.textContent ?? '', '').replace(/\s+/g, ' ').trim()
}
const CARD_TEXT_BUDGET = 120

describe('compact hero cards: visible text budget', () => {
  const variants: Array<[string, () => EconomicSnapshot]> = [
    ['78701', () => clone(austin)],
    ['06902', () => clone(stamford)],
    ['10001', () => clone(nyc)],
    ['98683', () => clone(vancouver)],
    ['78701 shelter fallback', () => { const s = clone(austin); s.rent = null; return s }],
    ['10001 shelter fallback + stale', () => { const s = clone(nyc); s.rent = null; s.gas.stale = true; s.cpi.stale = true; return s }],
    ['flagged rent (long county name) + stale', () => {
      const s = clone(austin)
      s.rent = { ...s.rent!, geoName: 'Fairbanks North Star Borough, AK', flagged: true, monthlyChange: 1178, pct: 33.6 }
      s.gas.stale = true
      return s
    }],
    ['HI stand-in gas + national CPI fallback', () => {
      const s = clone(vancouver)
      s.rent = null
      s.location = { ...s.location, stateAbbr: 'HI', countyFips: '15001', countyName: 'Hawaii County' }
      s.gas.data = { ...s.gas.data!, source: 'bls', frequency: 'monthly', blsArea: 'S49F', areaName: 'Honolulu', standIn: true, latestDate: '2026-08', baselineDate: '2025-01' }
      s.cpi.data = { ...s.cpi.data!, fallback: 'national' }
      return s
    }],
  ]
  test.each(variants)('%s: each card shows ≤ 120 characters outside the ⓘ disclosure', (_name, make) => {
    render(<HeroCards snapshot={make()} />)
    for (const c of within(screen.getByTestId('stat-cards')).getAllByTestId(/^stat-card-/)) {
      const t = visibleText(c)
      if (t.length > CARD_TEXT_BUDGET) throw new Error(`${c.dataset.testid}: ${t.length} chars: "${t}"`)
      // one short source line and no full five-part provenance on the card face
      expect(t).not.toMatch(/not seasonally adjusted|seasonally adjusted by whatchanged/)
    }
  })

  test('caveats become short tags on the card, explanations stay one tap away', () => {
    const s = clone(austin)
    s.rent = { ...s.rent!, flagged: true }
    render(<HeroCards snapshot={s} />)
    const c = screen.getByTestId('stat-card-rent')
    expect(within(c).getByTestId('stat-tag')).toHaveTextContent('⚠ unusual')
    expect(visibleText(c)).not.toContain('far outside')
    expect(within(c).getByTestId('stat-info')).toHaveTextContent('Unusual value: far outside the range most U.S. counties show')
  })

  test('window stays visible on gas, rent, groceries and shelter; national comparison where it exists', () => {
    const s = clone(austin)
    render(<HeroCards snapshot={s} />)
    for (const id of ['gas', 'rent', 'groceries']) expect(visibleText(screen.getByTestId(`stat-card-${id}`))).toMatch(/since (Jan 2025|Dec 2024)/)
    expect(visibleText(screen.getByTestId('stat-card-gas'))).toMatch(/U\.S\. [+−]\$\d\.\d{2}/)
    expect(visibleText(screen.getByTestId('stat-card-groceries'))).toMatch(/U\.S\. [+−]?\d+\.\d%/)
  })

  test('shelter fallback card keeps window + national comparison visible', () => {
    const s = clone(austin)
    s.rent = null
    render(<HeroCards snapshot={s} />)
    expect(visibleText(screen.getByTestId('stat-card-shelter'))).toMatch(/since Jan 2025 · U\.S\. [+−]?\d+\.\d%/)
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

  test('CPI and gas charts are labeled not seasonally adjusted; electricity names both lines', () => {
    for (const id of ['gas', 'cpi-groceries', 'cpi-shelter']) {
      expect(getChartInput(id, clone(austin)).provenance.adjustment).toBe('not seasonally adjusted')
    }
    expect(getChartInput('electricity', clone(austin)).provenance.adjustment)
      .toBe('bold line seasonally adjusted by whatchanged; thin line as published')
  })

  test('electricity graph: ¢/kWh lines, statewide provenance, headline = the card %, U.S. line is the adjusted one only', () => {
    const snap = clone(austin)
    const config = chartConfigs.find(c => c.id === 'electricity')!
    const input = getChartInput('electricity', snap)
    const e = snap.electricity.data!
    expect(input.headline?.pct).toBe(e.change)
    expect(input.data[input.data.length - 1]).toEqual({ date: e.latestPeriod, sa: e.series[e.series.length - 1].sa, price: e.current })
    expect(Object.keys(input.nationalData[0]).sort()).toEqual(['date', 'sa'])
    render(<EraChart config={config} data={input.data} nationalData={input.nationalData} provenance={input.provenance}
      nationalLabel={input.nationalLabel} info={input.info} />)
    expect(screen.getByTestId('provenance')).toHaveTextContent('EIA average residential electricity price · Texas (statewide), monthly')
    expect(screen.getByTestId('provenance')).toHaveTextContent('Jul 2026')
    expect(screen.getByTestId('chart-info')).toHaveTextContent('seasonal')
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
    expect(cpiGeoLabel({ metro: 'Urban Hawaii', seriesIds: { groceries: 'CUURS49FSAF11', shelter: '' } } as never))
      .toBe('metro: Honolulu (BLS area: Urban Hawaii)')
  })
})
