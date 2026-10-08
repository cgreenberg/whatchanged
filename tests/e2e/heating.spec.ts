import { test, expect } from '@playwright/test'
import { enterZip, loadFixture } from './helpers'

// Home heating graph: a recorded snapshot re-pointed at Portland ME with heating data attached
// (EIA SHOPP heating oil + propane, off-season), and one with no heating source (no graph).
const weekly = (from: string, n: number, start: number, step: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 7 * i)
    return { date: d.toISOString().slice(0, 10), price: Number((start + step * i).toFixed(3)) }
  })

const OFF = 'Heating-season survey (Oct–Mar) · latest Mar 30, 2026 · next update mid-Oct'
const heatingFor = (product: 'oil' | 'propane') => {
  const series = [...weekly('2024-10-07', 26, 3.5, 0.01), ...weekly('2025-10-06', 26, 4.2, 0.04)]
  const base = series.find((p) => p.date === '2025-01-20')!
  const last = series[series.length - 1]
  return {
    data: {
      product, source: 'eia', seriesId: `W_${product === 'oil' ? 'EPD2F' : 'EPLLPA'}_PRS_SME_DPG`, geography: 'Maine (statewide)',
      current: last.price, latestDate: last.date, baseline: base.price, baselineDate: base.date,
      change: Number((((last.price - base.price) / base.price) * 100).toFixed(2)), series,
      nationalSeries: series.map((p) => ({ ...p, price: p.price - 0.4 })), nationalLabel: 'U.S. avg, EIA weekly', offSeasonNote: OFF,
    },
    error: null, fetchedAt: '2026-10-03T00:00:00Z', sourceId: `eia-heating-${product}`,
  }
}

/** The recorded Vancouver WA snapshot, re-pointed at Maine (50% of homes heat with oil, 16% propane: ACS B25040). */
const asMaine = (snap: Record<string, unknown>) => {
  const loc = snap.location as Record<string, unknown>
  snap.location = { ...loc, stateAbbr: 'ME', stateName: 'Maine' }
  return snap
}

test('Home heating graph: tabs where data exists and the fuel matters, off-season labeled as last season, gap drawn', async ({ page }) => {
  await page.route('**/api/data/*', async (route) => {
    const snap = asMaine(loadFixture('98683') as Record<string, unknown>)
    snap.heating = { oil: heatingFor('oil'), propane: heatingFor('propane') }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snap) })
  })
  await enterZip(page, '98683')
  const heating = page.getByTestId('heating-chart')
  await expect(heating).toBeVisible({ timeout: 15000 })
  await expect(heating).toHaveAttribute('data-tab', 'oil')
  await expect(heating.getByTestId('heating-tab-propane')).toBeVisible()
  await expect(heating.getByTestId('chart-note')).toHaveText(OFF)
  // Off-season: the headline names both dates and says it is last season's figure
  await expect(heating.getByTestId('heating-headline-window')).toHaveText(/^Jan 20, 2025 → Mar \d+, 2026 \(last heating season\)$/)
  await heating.getByTestId('chart-info-toggle').click()
  await expect(heating.getByTestId('chart-info')).toContainText('In Maine, 50.3% of homes heat with fuel oil or kerosene')
  await expect(heating.getByTestId('stale-badge')).toHaveCount(0)
  await heating.getByTestId('timeframe-3Y').click()
  await expect(heating.getByTestId('chart-gap-note')).toContainText('No EIA data')
  await heating.getByTestId('heating-tab-propane').click()
  await expect(heating).toHaveAttribute('data-tab', 'propane')
})

test('fuel data exists but few homes use it (Washington: under 5% oil and propane): no Home heating graph', async ({ page }) => {
  await page.route('**/api/data/*', async (route) => {
    const snap = loadFixture('98683') as Record<string, unknown>
    snap.heating = { oil: heatingFor('oil'), propane: heatingFor('propane') }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snap) })
  })
  await enterZip(page, '98683')
  await expect(page.getByTestId('charts-section')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('heating-chart')).toHaveCount(0)
})

test('no heating source for the place: no Home heating graph', async ({ page }) => {
  await page.route('**/api/data/*', async (route) => {
    const snap = loadFixture('98683') as Record<string, unknown>
    snap.heating = { oil: null, propane: null }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snap) })
  })
  await enterZip(page, '98683')
  await expect(page.getByTestId('charts-section')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('heating-chart')).toHaveCount(0)
})
