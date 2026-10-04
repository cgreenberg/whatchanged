import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import AboutPage from '@/app/about/page'

describe('About page', () => {
  beforeEach(() => render(<AboutPage />))

  test('shows a visible "Last updated" content-revision date and says data dates are on each card', () => {
    const el = screen.getByTestId('about-last-updated')
    expect(el).toHaveTextContent('Last updated: Oct 3, 2026')
    expect(el.querySelector('time')).toHaveAttribute('datetime', '2026-10-03')
    expect(document.body).toHaveTextContent("Each number's own data date")
    expect(document.body).toHaveTextContent('is shown on its card')
  })

  test('describes the current site: four cards, four graphs, county map', () => {
    const t = document.body.textContent ?? ''
    for (const s of ['Gas', 'Rent', 'Groceries', 'Electricity', 'Shelter (CPI)', 'Home prices', 'county map']) expect(t).toContain(s)
    expect(t).toContain('seasonally adjusted')
    expect(t).toContain('statewide')
    expect(t).toContain('rent of primary residence')
    expect(t).toContain('Honolulu-area*')
    expect(t).toContain('ⓘ')
  })

  test('nothing stale: no unemployment, federal cuts, local pulse, or a build-time date', () => {
    const t = (document.body.textContent ?? '').toLowerCase()
    for (const s of ['unemployment', 'federal cuts', 'usaspending', 'local pulse', 'laus', 'tariff', 'yale budget lab', 'energy costs']) expect(t).not.toContain(s)
  })
})
