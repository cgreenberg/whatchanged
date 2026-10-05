import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import AboutPage from '@/app/about/page'
import { LADDERS, LADDER_ORDER } from '@/lib/resolution/ladders'
import { OTHER_SOURCES } from '@/lib/resolution/doc'
import type { AnyRung } from '@/lib/resolution/resolve'

describe('About page', () => {
  beforeEach(() => render(<AboutPage />))

  test('shows a visible "Last updated" content-revision date and says data dates are on each card', () => {
    const el = screen.getByTestId('about-last-updated')
    expect(el).toHaveTextContent('Last updated: Oct 4, 2026')
    expect(el.querySelector('time')).toHaveAttribute('datetime', '2026-10-04')
    expect(document.body).toHaveTextContent("Each number's own data date")
    expect(document.body).toHaveTextContent('is shown on its card')
  })

  test('describes the current site: four cards, four graphs (+ Home heating where it matters), county map', () => {
    const t = document.body.textContent ?? ''
    for (const s of ['Gas', 'Rent', 'Groceries', 'Electricity', 'Shelter (CPI)', 'Home prices', 'Home heating', 'county map']) expect(t).toContain(s)
    expect(t).toContain('seasonally adjusted by whatchanged')
    expect(t).toContain('12 months centered on January 2025 (August 2024–July 2025)')
    expect(t).toContain('county pattern blended with the state pattern based on history length')
    expect(t).toContain('statewide')
    expect(t).toContain('rent of primary residence')
    expect(t).toContain('Honolulu-area*')
    expect(t).toContain('ⓘ')
  })

  test('every ladder rung\'s source (and every non-ladder source) appears in the generated Data sources table', () => {
    const table = screen.getByTestId('about-sources').textContent ?? ''
    for (const metric of LADDER_ORDER) {
      for (const r of LADDERS[metric].rungs as AnyRung[]) expect([r.id, table.includes(r.sourceName)]).toEqual([r.id, true])
    }
    for (const o of OTHER_SOURCES) expect(table).toContain(o.name)
    // Named explicitly: sources added in round 10 that the hand-written table had missed
    for (const s of ['Alaska DCRA', 'DACO', 'SHOPP', 'NYSERDA', 'ZORI), metro']) expect(table).toContain(s)
  })

  test('required attributions: Alaska DCRA (CC BY 4.0) credit wording, GeoNames, Zillow', () => {
    const a = screen.getByTestId('about-attribution').textContent ?? ''
    expect(a).toContain('Alaska DCCED, Division of Community and Regional Affairs')
    expect(a).toContain('CC BY 4.0')
    expect(a).toContain('GeoNames')
    expect(a).toContain('Zillow')
  })

  test('methodology names every baseline the code uses', () => {
    const t = document.body.textContent ?? ''
    for (const s of ['January 2025 survey', 'last weekly reading on or before January 20, 2025', 'heating fuel', 'Puerto Rico DACO']) expect(t).toContain(s)
    expect(t).not.toContain('seasonally adjusted prices: residential')
  })

  test('nothing stale: no unemployment, federal cuts, local pulse, or a build-time date', () => {
    const t = (document.body.textContent ?? '').toLowerCase()
    for (const s of ['unemployment', 'federal cuts', 'usaspending', 'local pulse', 'laus', 'tariff', 'yale budget lab', 'energy costs']) expect(t).not.toContain(s)
  })
})
