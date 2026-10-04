import '@testing-library/jest-dom'
/**
 * A CPI series with unpublished months (Phoenix food at home, CUURS48ASAF11: no 2026-M02..M07 in the
 * recorded BLS response) must still show its latest point, draw the gap as a dashed connector, and
 * say which months are missing.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { EraChart } from '@/components/charts/EraChart'
import { chartConfigs } from '@/lib/charts/chart-config'
import { parseCpiResponse } from '@/lib/api/bls-cpi'
import { findGaps, dotDates } from '@/lib/charts/chart-data'
import type { BlsRawPoint } from '@/lib/api/bls-common'
import recorded from '../fixtures/bls-recorded-2024-2026.json'

// Give Recharts a real size in jsdom so the SVG (lines, dots) renders
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children as React.ReactElement<{ width: number; height: number }>, { width: 800, height: 300 }),
  }
})

const RECORDED: Record<string, BlsRawPoint[]> = Object.fromEntries(
  (recorded.Results.series as Array<{ seriesID: string; data: BlsRawPoint[] }>).map(s => [s.seriesID, s.data])
)
const ids = ['CUURS48ASAF11', 'CUURS48ASAH1', 'CUURS48ASA0E']
const phoenix = parseCpiResponse(Object.fromEntries(ids.map(id => [id, RECORDED[id]])), { areaCode: 'S48A', areaName: 'Phoenix', tier: 1 })

function renderItem(item: 'groceries' | 'shelter') {
  const config = chartConfigs.find(c => c.id === `cpi-${item}`)!
  const data = phoenix.series.map(p => ({ date: p.date, [item]: p[item] }))
  return render(
    <EraChart config={config} data={data} provenance={{ source: 'BLS CPI food at home', geography: 'Phoenix', adjustment: 'not seasonally adjusted' }} />
  )
}

describe('CPI chart with a data gap (recorded Phoenix food at home)', () => {
  test('gap is found from the data', () => {
    const rows = phoenix.series.map(p => ({ date: p.date, groceries: p.groceries }))
    // Oct 2025: BLS lists the month with "-" (shutdown) → kept as an empty row, so it is a gap too
    expect(findGaps(rows, 'groceries')).toEqual([
      { from: '2025-10', to: '2025-10', before: '2025-09', after: '2025-11' },
      { from: '2026-02', to: '2026-07', before: '2026-01', after: '2026-08' },
    ])
    // Aug 2026 is isolated (both neighbors empty/absent) and the latest point
    expect(dotDates(rows, 'groceries').has('2026-08')).toBe(true)
  })

  test('renders the note, a dashed connector and a dot on the latest point', () => {
    const { container } = renderItem('groceries')
    expect(screen.getByTestId('chart-gap-note')).toHaveTextContent('No BLS data for Oct 2025, Feb 2026–Jul 2026')
    const connector = container.querySelector('.gap-connector path, path.gap-connector')
    expect(connector).not.toBeNull()
    expect(connector!.getAttribute('stroke-dasharray')).toBe('2 4')
    expect(container.querySelectorAll('[data-testid="point-dot"]').length).toBeGreaterThanOrEqual(1)
  })

  test('shelter: only the unpublished Oct 2025 month is a gap', () => {
    renderItem('shelter')
    expect(screen.getByTestId('chart-gap-note')).toHaveTextContent(/^No BLS data for Oct 2025$/)
  })

  test('a month BLS never lists (bimonthly off-month) is not a gap', () => {
    const raw = RECORDED['CUURS48ASAH1'].filter(d => !(d.year === '2025' && (d.period === 'M10' || d.period === 'M06')))
    const s = parseCpiResponse({ ...Object.fromEntries(ids.map(id => [id, RECORDED[id]])), CUURS48ASAH1: raw, CUURS48ASAF11: raw.map(d => ({ ...d })), CUURS48ASA0E: raw.map(d => ({ ...d })) }, { areaCode: 'S48A', areaName: 'Phoenix', tier: 1 })
    expect(s.series.some(p => p.date === '2025-06')).toBe(false)
    expect(findGaps(s.series.map(p => ({ date: p.date, shelter: p.shelter })), 'shelter')).toEqual([])
  })
})

describe('national overlay', () => {
  const config = chartConfigs.find(c => c.id === 'cpi-groceries')!
  const months = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']
  const local = months.map((date, i) => ({ date, groceries: 100 + i }))
  // U.S. series is missing 2025-04: the dashed U.S. line must mark the gap, not silently bridge it
  const national = months.filter(d => d !== '2025-04').map((date, i) => ({ date, groceries: 100 + i * 0.5 }))
  const prov = { source: 'BLS CPI food at home', geography: 'Phoenix', adjustment: 'not seasonally adjusted' }

  test('legend names the national series with the supplied national label', () => {
    const { container } = render(<EraChart config={config} data={local} nationalData={national} provenance={prov} nationalLabel="U.S. city avg, BLS monthly" />)
    fireEvent.click(screen.getByLabelText('Show national'))
    expect(container.querySelector('.recharts-legend-wrapper')).toHaveTextContent('Groceries (U.S. city avg, BLS monthly)')
    expect(container.querySelector('.recharts-legend-wrapper')).not.toHaveTextContent('Groceries (U.S.)')
  })

  test('legend falls back to "(U.S.)" without a national label', () => {
    const { container } = render(<EraChart config={config} data={local} nationalData={national} provenance={prov} />)
    fireEvent.click(screen.getByLabelText('Show national'))
    expect(container.querySelector('.recharts-legend-wrapper')).toHaveTextContent('Groceries (U.S.)')
  })

  test('a month missing only from the national series is marked with a connector and named', () => {
    const { container } = render(<EraChart config={config} data={local} nationalData={national} provenance={prov} />)
    expect(container.querySelector('.national-gap-connector')).toBeNull()
    expect(screen.queryByTestId('chart-gap-note')).toBeNull()
    fireEvent.click(screen.getByLabelText('Show national'))
    expect(container.querySelector('.national-gap-connector path, path.national-gap-connector')).not.toBeNull()
    expect(screen.getByTestId('chart-gap-note')).toHaveTextContent(/^No U\.S\. data for Apr 2025$/)
  })
})
