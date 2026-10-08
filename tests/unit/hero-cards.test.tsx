import '@testing-library/jest-dom'
/**
 * Render-level check of the hero cards: the dollars a user SEES equal the stated
 * formulas applied to the API numbers, and bad/missing sources render "Data unavailable".
 */
import { render, screen, within, fireEvent } from '@testing-library/react'
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

  test('gas: the signed $ change is the big number; window + today\'s price on the secondary line', () => {
    const g = snap.gas.data!
    expect(text(card('gas'), 'stat-value')).toBe(`${fmtSignedDollars(g.change)}/gal`)
    expect(text(card('gas'), 'stat-secondary')).toBe(`since Jan 2025 · now $${g.current.toFixed(2)}`)
    expect(within(card('gas')).queryByTestId('stat-change')).toBeNull()
    // the full $/gal wording is one tap away
    expect(text(card('gas'), 'stat-info')).toContain(`${fmtSignedDollars(g.change)}/gal since`)
  })

  test('groceries: $6,000/yr × API % change', () => {
    const pct = snap.cpi.data!.groceriesChange
    const expected = Math.round((6000 * pct) / 100)
    expect(snap.dollarImpact!.groceries).toBe(expected)
    expect(text(card('groceries'), 'stat-value')).toBe(fmtSignedPct(pct))
    expect(text(card('groceries'), 'stat-inline')).toBe(`≈ ${fmtSignedDollars(expected, 0)}/yr`)
    expect(text(card('groceries'), 'stat-secondary')).toMatch(/^since (Jan 2025|Dec 2024)( · U\.S\. [+−]?\d+\.\d%)?$/)
    // the basis is in the ⓘ disclosure
    expect(text(card('groceries'), 'stat-info')).toContain(`${fmtSignedDollars(expected, 0)}/yr on $6,000/yr of groceries`)
  })

  test('rent: $/mo = curRent − curRent / (1 + pct/100)', () => {
    const r = snap.rent!
    const expected = Math.round(r.curRent - r.curRent / (1 + r.pct / 100))
    expect(text(card('rent'), 'stat-value')).toBe(fmtSignedPct(r.pct))
    expect(text(card('rent'), 'stat-inline')).toBe(`≈ ${fmtSignedDollars(expected, 0)}/mo`)
    expect(text(card('rent'), 'stat-secondary')).toContain('since Jan 2025')
    // ⓘ: $ is the seasonally adjusted change in dollars, worded so it can't be read as a raw then-vs-now gap;
    // the raw level is shown only as a level, with its month — never as a comparison
    const info = text(card('rent'), 'stat-info')
    expect(info).toContain(`≈ ${fmtSignedDollars(expected, 0)}/mo vs Jan 2025, after adjusting for the usual seasonal`)
    expect(info).toContain(`Typical asking rent: ${fmtDollars(r.curRent)}/mo (${fmtMonthYear(r.asOf)})`)
  })

  test('electricity: % change is the big number; $/mo = (change in 12-mo avg price ¢) × state monthly kWh ÷ 100', () => {
    const e = snap.electricity.data!
    const expected = Math.round(((e.current - e.baseline) * e.usageKwh!) / 100)
    expect(snap.dollarImpact!.electricity).toBe(expected)
    expect(text(card('electricity'), 'stat-value')).toBe(fmtSignedPct(e.change))
    expect(within(card('electricity')).queryByTestId('stat-value-note')).toBeNull()
    expect(text(card('electricity'), 'stat-inline')).toBe(`≈ ${fmtSignedDollars(expected, 0)}/mo`)
    expect(text(card('electricity'), 'stat-secondary')).toBe(
      `since Jan 2025 · now ${e.current.toFixed(1)}¢/kWh`)
    // the U.S. comparison is one tap away
    expect(text(card('electricity'), 'stat-info')).toContain(`National: ${fmtSignedPct(e.nationalChange!)}`)
    expect(text(card('electricity'), 'stat-source')).toBe(`${e.stateName} · EIA · ${fmtMonthYear(e.latestPeriod)}`)
    // ⓘ: the dollar basis, both 12-month windows, the latest single month and why full years are compared
    const info = text(card('electricity'), 'stat-info')
    expect(info).toContain(`× an average ${e.stateName} home's monthly use (${Math.round(e.usageKwh!).toLocaleString('en-US')} kWh, 12-mo avg`)
    expect(info).toContain(`Latest month as published: ${e.latestMonthPrice.toFixed(1)}¢/kWh`)
    expect(info).toContain('Why 12-month averages')
    expect(info).not.toContain('seasonally adjusted')
  })
})

describe('CPI shelter fallback when the county has no Zillow rent', () => {
  test('headline % is CPI shelter; $ = local Census rent × 12 × BLS rent-of-primary-residence %', () => {
    const snap = clone(austin)
    snap.rent = null
    render(<HeroCards snapshot={snap} />)
    const c = card('shelter')
    expect(within(c).getByText('Shelter (CPI)')).toBeInTheDocument()
    const pct = snap.cpi.data!.shelterChange!
    const rentIdx = snap.cpi.data!.rentIndexChange!
    expect(rentIdx).not.toBe(pct)
    const rent = snap.census.data!.medianRent
    const expected = Math.round((rent * 12 * rentIdx) / 100)
    expect(snap.dollarImpact!.shelter).toBe(expected)
    expect(text(c, 'stat-value')).toBe(fmtSignedPct(pct))
    expect(text(c, 'stat-inline')).toBe(`≈ ${fmtSignedDollars(expected, 0)}/yr in rent`)
    const info = text(c, 'stat-info')
    expect(info).toContain('rent of primary residence (BLS) applied to local median rent')
    expect(info).toContain(`${fmtDollars(rent)}/mo median rent`)
    expect(info).toContain(`rent of primary residence (BLS) ${fmtSignedPct(rentIdx)}`)
    // both series are cited with links: CPI shelter (headline) and CPI rent of primary residence ($)
    fireEvent.click(within(c).getByTestId('stat-info-toggle'))
    const lines = within(within(c).getByTestId('stat-info')).getAllByTestId('provenance')
    expect(lines.map(l => l.textContent)).toEqual([
      expect.stringMatching(/^BLS CPI shelter · /),
      expect.stringMatching(/^BLS CPI rent of primary residence · /),
    ])
    expect(within(lines[1]).getByRole('link')).toHaveAttribute('href', 'https://data.bls.gov/timeseries/CUUR0370SEHA')
  })

  test('rent index missing (e.g. an older cached payload) → no $ at all, never the shelter % on rent', () => {
    const snap = clone(austin)
    snap.rent = null
    delete snap.cpi.data!.rentIndexChange
    // even if a stale API response still carries an old-method figure
    snap.dollarImpact!.shelter = Math.round((snap.census.data!.medianRent * 12 * snap.cpi.data!.shelterChange!) / 100)
    render(<HeroCards snapshot={snap} />)
    expect(within(card('shelter')).queryByTestId('stat-inline')).toBeNull()
    expect(card('shelter')).not.toHaveTextContent('/yr')
    expect(text(card('shelter'), 'stat-info')).toContain('rent-of-primary-residence index for this area is unavailable')
  })

  test('no local rent → no dollar figure (never a national stand-in)', () => {
    const snap = clone(austin)
    snap.rent = null
    snap.dollarImpact!.shelter = null
    snap.census.data!.isRentFallback = true
    render(<HeroCards snapshot={snap} />)
    expect(within(card('shelter')).queryByTestId('stat-inline')).toBeNull()
    expect(text(card('shelter'), 'stat-info')).toContain('No local rent figure for a dollar estimate')
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

  test('null electricity → unavailable', () => {
    const snap = clone(austin)
    snap.electricity = { ...snap.electricity, data: null }
    render(<HeroCards snapshot={snap} />)
    expect(text(card('electricity'), 'stat-value')).toBe('Data unavailable')
  })

  test('electricity outside the sanity range (price or % change) → unavailable', () => {
    for (const patch of [{ current: 80 }, { change: 140 }]) {
      const snap = clone(austin)
      Object.assign(snap.electricity.data!, patch)
      const { unmount } = render(<HeroCards snapshot={snap} />)
      expect(text(card('electricity'), 'stat-value')).toBe('Data unavailable')
      unmount()
    }
  })

  test('falling electricity price → "−" and direction down; no usage → no $ figure', () => {
    const snap = clone(vancouver)
    snap.electricity.data!.change = -3.2
    snap.dollarImpact!.electricity = null
    render(<HeroCards snapshot={snap} />)
    expect(text(card('electricity'), 'stat-value')).toBe('−3.2%')
    expect(card('electricity')).toHaveAttribute('data-direction', 'down')
    expect(within(card('electricity')).queryByTestId('stat-inline')).toBeNull()
  })
})

describe('signs and direction', () => {
  test('negative gas change renders "−$" (minus sign), never "$-"', () => {
    const snap = clone(austin)
    snap.gas.data!.change = -0.12
    render(<HeroCards snapshot={snap} />)
    const t = text(card('gas'), 'stat-value')
    expect(t).toBe('−$0.12/gal')
    expect(t).not.toContain('$-')
    expect(card('gas')).toHaveAttribute('data-direction', 'down')
  })

  test('zero change is neutral', () => {
    const snap = clone(austin)
    snap.cpi.data!.groceriesChange = 0.04
    render(<HeroCards snapshot={snap} />)
    expect(text(card('groceries'), 'stat-value')).toBe('0.0%')
    expect(card('groceries')).toHaveAttribute('data-direction', 'neutral')
  })

  test('stale source shows a stale badge', () => {
    const snap = clone(austin)
    snap.gas.stale = true
    render(<HeroCards snapshot={snap} />)
    expect(within(card('gas')).getByTestId('stale-badge')).toBeInTheDocument()
    expect(within(card('groceries')).queryByTestId('stale-badge')).toBeNull()
  })
})
