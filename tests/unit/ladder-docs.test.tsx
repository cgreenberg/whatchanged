/**
 * Docs and the About page are generated from the ladder config: docs/DATA_RESOLUTION.md must match
 * `npm run docs:ladders` output, and the About page's pills must list every rung in order.
 */
import fs from 'fs'
import path from 'path'
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { renderLadderDoc, ladderPills, RESOLUTION_RULES } from '@/lib/resolution/doc'
import { LADDERS, LADDER_ORDER } from '@/lib/resolution/ladders'
import AboutPage from '@/app/about/page'

describe('docs/DATA_RESOLUTION.md', () => {
  test('is up to date with the ladder config (run `npm run docs:ladders` if this fails)', () => {
    const committed = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'DATA_RESOLUTION.md'), 'utf8')
    expect(committed).toBe(renderLadderDoc())
  })

  test('lists every rung of every ladder, and explains how to add a rung', () => {
    const doc = renderLadderDoc()
    for (const m of LADDER_ORDER) for (const r of LADDERS[m].rungs) expect(doc).toContain(`\`${r.id}\``)
    expect(doc).toContain('## How to add a rung')
    expect(doc).toContain('## How to add a metric')
  })
})

describe('About page: How we pick your numbers', () => {
  beforeEach(() => render(<AboutPage />))

  test('one ladder per metric, pills in rung order (most local first), plus the rules sentence', () => {
    expect(screen.getByRole('heading', { name: 'How we pick your numbers' })).toBeInTheDocument()
    expect(screen.getByTestId('resolution-rules')).toHaveTextContent(RESOLUTION_RULES)
    for (const m of LADDER_ORDER) {
      const pills = within(screen.getByTestId(`ladder-${m}`)).getAllByTestId('ladder-pill')
      expect(pills.map((p) => p.querySelector('span')?.textContent)).toEqual(
        ladderPills(m).map((p) => `${p.level}${p.source}`),
      )
    }
    expect(within(screen.getByTestId('ladder-gas')).getAllByTestId('ladder-pill')[0]).toHaveTextContent('CityEIA · weekly')
  })

  test('the rules say: Jan 2025 baseline, same source, never mixed, national fallback labeled', () => {
    const t = screen.getByTestId('resolution-rules').textContent ?? ''
    expect(t).toMatch(/January 2025/)
    expect(t).toMatch(/same source for the baseline and today/)
    expect(t).toMatch(/never mixed/)
    expect(t).toMatch(/U\.S\.-average fallback is always labeled/)
  })
})
