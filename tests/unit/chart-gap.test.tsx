import '@testing-library/jest-dom'
/**
 * A CPI series with unpublished months (Phoenix food at home, CUURS48ASAF11: no 2026-M02..M07 in the
 * recorded BLS response) must still show its latest point, draw the gap as a dashed connector, and
 * say which months are missing.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
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
    expect(findGaps(rows, 'groceries')).toEqual([{ from: '2026-02', to: '2026-07', before: '2026-01', after: '2026-08' }])
    // Aug 2026 is isolated (both neighbors empty/absent) and the latest point
    expect(dotDates(rows, 'groceries').has('2026-08')).toBe(true)
  })

  test('renders the note, a dashed connector and a dot on the latest point', () => {
    const { container } = renderItem('groceries')
    expect(screen.getByTestId('chart-gap-note')).toHaveTextContent('No BLS data for Feb 2026–Jul 2026')
    const connector = container.querySelector('.gap-connector path, path.gap-connector')
    expect(connector).not.toBeNull()
    expect(connector!.getAttribute('stroke-dasharray')).toBe('2 4')
    expect(container.querySelectorAll('[data-testid="point-dot"]').length).toBeGreaterThanOrEqual(1)
  })

  test('shelter (no gap) has no gap note or connector', () => {
    const { container } = renderItem('shelter')
    expect(screen.queryByTestId('chart-gap-note')).toBeNull()
    expect(container.querySelector('.gap-connector')).toBeNull()
  })
})
