import '@testing-library/jest-dom'
/**
 * Render-level check of the hero cards: the dollars a user SEES equal the stated
 * formulas applied to the API numbers, and bad/missing sources render "Data unavailable".
 */
import { render, screen, within } from '@testing-library/react'
import { HeroCards } from '@/components/HeroCards'
import { fmtSignedDollars, fmtDollars, fmtSignedPct, fmtMonthYear } from '@/lib/format'
import type { EconomicSnapshot } from '@/types'
import austin from '../fixtures/snapshots/78701.json'
import vancouver from '../fixtures/snapshots/98683.json'

const clone = (s: unknown): EconomicSnapshot => JSON.parse(JSON.stringify(s))

function card(id: string) {
  return screen.getByTestId(`stat-card-${id}`)
}
const text = (el: HTMLElement, testId: string) => within(el).getByTestId(testId).textContent ?? ''

describe.each([
  ['78701', austin],
  ['98683', vancouver],
])('hero cards for %s render API numbers × stated formulas', (_zip, fixture) => {
  const snap = clone(fixture)

  beforeEach(() => {
    render(<HeroCards snapshot={snap} />)
  })

  test('always four cards, rent leads housing when county rent exists', () => {
    expect(screen.getByTestId('stat-cards').children).toHaveLength(4)
    expect(card('rent')).toBeInTheDocument()
    expect(screen.queryByTestId('stat-card-shelter')).toBeNull()
  })

  test('gas: price and signed $/gal change from the API', () => {
    const g = snap.gas.data!
    expect(text(card('gas'), 'stat-value')).toBe(`$${g.current.toFixed(2)}/gal`)
    expect(text(card('gas'), 'stat-change')).toContain(`${fmtSignedDollars(g.change)}/gal`)
  })

  test('groceries: $6,000/yr × API % change', () => {
    const pct = snap.cpi.data!.groceriesChange
    const expected = Math.round((6000 * pct) / 100)
    expect(snap.dollarImpact!.groceries).toBe(expected)
    expect(text(card('groceries'), 'stat-value')).toBe(fmtSignedPct(pct))
    expect(text(card('groceries'), 'stat-change')).toContain(`${fmtSignedDollars(expected, 0)}/yr on $6,000/yr`)
  })

  test('rent: $/mo = curRent − curRent / (1 + pct/100)', () => {
    const r = snap.rent!
    const expected = Math.round(r.curRent - r.curRent / (1 + r.pct / 100))
    expect(text(card('rent'), 'stat-value')).toBe(fmtSignedPct(r.pct))
    // $ is the seasonally adjusted change in dollars, worded so it can't be read as a raw then-vs-now gap
    expect(text(card('rent'), 'stat-change')).toContain(`≈ ${fmtSignedDollars(expected, 0)}/mo vs Jan 2025, after adjusting for the usual seasonal`)
    // the raw level is shown only as a level, with its month — never as a comparison
    expect(text(card('rent'), 'stat-detail')).toBe(`Typical asking rent: ${fmtDollars(r.curRent)}/mo (${fmtMonthYear(r.asOf)})`)
  })

  test('tariff: median income × 0.0205', () => {
    const income = snap.tariff.data!.medianIncome
    expect(text(card('tariff'), 'stat-value')).toBe(`~${fmtDollars(Math.round(income * 0.0205))}/yr`)
    expect(text(card('tariff'), 'stat-change')).toContain(fmtDollars(income))
  })
})

describe('CPI shelter fallback when the county has no Zillow rent', () => {
  test('labels the concept and uses local Census rent × 12 × %', () => {
    const snap = clone(austin)
    snap.rent = null
    render(<HeroCards snapshot={snap} />)
    const c = card('shelter')
    expect(c).toHaveTextContent("Shelter prices (CPI: rents + owners' equivalent rent)")
    const pct = snap.cpi.data!.shelterChange!
    const rent = snap.census.data!.medianRent
    const expected = Math.round((rent * 12 * pct) / 100)
    expect(snap.dollarImpact!.shelter).toBe(expected)
    expect(text(c, 'stat-value')).toBe(fmtSignedPct(pct))
    expect(text(c, 'stat-change')).toContain(`${fmtSignedDollars(expected, 0)}/yr`)
    expect(text(c, 'stat-detail')).toContain(`${fmtDollars(rent)}/mo median rent`)
  })

  test('no local rent → no dollar figure (never a national stand-in)', () => {
    const snap = clone(austin)
    snap.rent = null
    snap.dollarImpact!.shelter = null
    snap.census.data!.isRentFallback = true
    render(<HeroCards snapshot={snap} />)
    expect(within(card('shelter')).queryByTestId('stat-change')).toBeNull()
    expect(text(card('shelter'), 'stat-detail')).toContain('No local rent figure for a dollar estimate')
    expect(card('shelter')).not.toHaveTextContent('/yr')
  })
})

describe('missing or out-of-range sources render "Data unavailable"', () => {
  test('null CPI → grocery and shelter cards unavailable; grid still has 4 cards', () => {
    const snap = clone(austin)
    snap.rent = null
    snap.cpi = { ...snap.cpi, data: null, error: 'Data unavailable' }
    render(<HeroCards snapshot={snap} />)
    expect(screen.getByTestId('stat-cards').children).toHaveLength(4)
    expect(text(card('groceries'), 'stat-value')).toBe('Data unavailable')
    expect(text(card('shelter'), 'stat-value')).toBe('Data unavailable')
    expect(card('groceries')).not.toHaveTextContent('0.0%')
  })

  test('null gas → gas card unavailable', () => {
    const snap = clone(austin)
    snap.gas = { ...snap.gas, data: null, error: 'Data unavailable' }
    render(<HeroCards snapshot={snap} />)
    expect(text(card('gas'), 'stat-value')).toBe('Data unavailable')
  })

  test('gas price outside $1–$10 → unavailable', () => {
    const snap = clone(austin)
    snap.gas.data!.current = 14.2
    render(<HeroCards snapshot={snap} />)
    expect(text(card('gas'), 'stat-value')).toBe('Data unavailable')
  })

  test('CPI change outside −20%…+50% → unavailable', () => {
    const snap = clone(austin)
    snap.cpi.data!.groceriesChange = 75
    render(<HeroCards snapshot={snap} />)
    expect(text(card('groceries'), 'stat-value')).toBe('Data unavailable')
  })

  test('shelterChange missing → unavailable, not "0.0%"', () => {
    const snap = clone(austin)
    snap.rent = null
    delete snap.cpi.data!.shelterChange
    render(<HeroCards snapshot={snap} />)
    expect(text(card('shelter'), 'stat-value')).toBe('Data unavailable')
  })

  test('null tariff → unavailable', () => {
    const snap = clone(austin)
    snap.tariff = { ...snap.tariff, data: null }
    render(<HeroCards snapshot={snap} />)
    expect(text(card('tariff'), 'stat-value')).toBe('Data unavailable')
  })
})

describe('signs and arrows', () => {
  test('negative gas change renders "−$" (minus sign), never "$-"', () => {
    const snap = clone(austin)
    snap.gas.data!.change = -0.12
    render(<HeroCards snapshot={snap} />)
    const t = text(card('gas'), 'stat-change')
    expect(t).toContain('−$0.12/gal')
    expect(t).not.toContain('$-')
    expect(t.startsWith('↓')).toBe(true)
  })

  test('zero change shows no arrow', () => {
    const snap = clone(austin)
    snap.cpi.data!.groceriesChange = 0.04
    render(<HeroCards snapshot={snap} />)
    expect(text(card('groceries'), 'stat-value')).toBe('0.0%')
    expect(text(card('groceries'), 'stat-change')).not.toMatch(/^[↑↓]/)
  })

  test('stale source shows a stale badge', () => {
    const snap = clone(austin)
    snap.gas.stale = true
    render(<HeroCards snapshot={snap} />)
    expect(within(card('gas')).getByTestId('stale-badge')).toBeInTheDocument()
    expect(within(card('groceries')).queryByTestId('stale-badge')).toBeNull()
  })
})
