/** "Where does this come from?" disclosure: accessible button, step flow, focus handling, Escape. */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SourceTrace, traceStatusText } from '@/components/SourceTrace'
import { StatCard } from '@/components/StatCard'
import type { TraceStep } from '@/lib/resolution/types'

const STEPS: TraceStep[] = [
  { rungId: 'rent.zillow-county', label: 'Zillow county rent (new leases)', source: 'Zillow Observed Rent Index (ZORI)', citationUrl: 'https://www.zillow.com/research/data/',
    geography: { name: 'Androscoggin County, ME', level: 'county' }, status: 'not-applicable',
    reason: 'Zillow has no rent series for Androscoggin County with enough history.' },
  { rungId: 'rent.bls-cpi-shelter', label: 'BLS shelter (CPI)', source: 'BLS CPI shelter', citationUrl: 'https://data.bls.gov/timeseries/CUUR0110SAH1',
    geography: { name: 'New England division', level: 'division' }, status: 'used', asOf: '2026-08', seriesId: 'CUUR0110SAH1' },
  { rungId: 'x.national', label: 'U.S. average', source: 'S', geography: { name: 'United States', level: 'national' }, status: 'not-needed' },
]

describe('SourceTrace', () => {
  test('closed by default; opens an ordered step flow with icons, geography, status, reason and source link', () => {
    render(<SourceTrace steps={STEPS} subject="rent" />)
    const button = screen.getByRole('button', { name: /Where does this come from\?/ })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    const panel = screen.getByTestId('source-trace-panel')
    expect(panel).not.toBeVisible()
    expect(button).toHaveAttribute('aria-controls', panel.id)

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(panel).toBeVisible()
    expect(panel).toHaveFocus()
    const rows = within(panel).getAllByTestId('source-trace-step')
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['not-applicable', 'used', 'not-needed'])
    expect(rows[0]).toHaveTextContent('No series here: Zillow has no rent series for Androscoggin County with enough history.')
    expect(rows[0]).toHaveTextContent('Zillow county rent (new leases) — Androscoggin County, ME')
    expect(within(rows[0]).queryByRole("link")).toBeNull()
    expect(rows[1]).toHaveTextContent('Used, Aug 2026')
    expect(within(rows[1]).getByRole('link', { name: 'BLS CPI shelter' })).toHaveAttribute('href', 'https://data.bls.gov/timeseries/CUUR0110SAH1')
    expect(rows[1]).toHaveTextContent('series CUUR0110SAH1')
    expect(rows[2]).toHaveTextContent('Not needed')
    expect(within(rows[2]).queryByRole('link')).toBeNull()
    // status words for screen readers (the icons are aria-hidden)
    expect(rows[1].querySelector('.sr-only')).toHaveTextContent('Used:')
  })

  test('Escape closes it and returns focus to the button, without closing an enclosing ⓘ panel', () => {
    render(
      <StatCard label="Rent" value="+3%" sourceLine="Androscoggin · BLS · Aug 2026" trace={STEPS}
        provenance={{ source: 's', geography: 'g', window: 'w', asOf: 'a', adjustment: 'n' }} />,
    )
    fireEvent.click(screen.getByTestId('stat-info-toggle'))
    const info = screen.getByTestId('stat-info')
    expect(info).not.toHaveAttribute('hidden')
    const button = within(info).getByRole('button', { name: /Where does this come from\?/ })
    fireEvent.click(button)
    fireEvent.keyDown(screen.getByTestId('source-trace-panel'), { key: 'Escape' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
    expect(info).not.toHaveAttribute('hidden')
  })

  test('nothing rendered without a trace (older payloads)', () => {
    const { container } = render(<SourceTrace steps={undefined} subject="gas" />)
    expect(container).toBeEmptyDOMElement()
  })

  test('status text formats weekly and monthly dates', () => {
    expect(traceStatusText({ status: 'used', asOf: '2026-09-28' })).toBe('Used, week of Sep 28, 2026')
    expect(traceStatusText({ status: 'stale', asOf: '2025-02' })).toBe('Used, but out of date, Feb 2025')
    expect(traceStatusText({ status: 'unavailable' })).toBe('Unavailable')
  })
})
