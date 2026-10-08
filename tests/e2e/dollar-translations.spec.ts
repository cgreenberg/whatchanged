import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip, loadFixture } from './helpers'

// Rendered dollars must equal the stated formula applied to the API numbers.
const fx = loadFixture('98683') as {
  gas: { data: { current: number; change: number } }
  cpi: { data: { groceriesChange: number; shelterChange: number; rentIndexChange: number } }
  rent: { pct: number; curRent: number }
  electricity: { data: { current: number; baseline: number; usageKwh: number; change: number; stateName: string } }
  census: { data: { medianRent: number } }
}
const usd = (v: number, d = 0) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`

test.describe('Dollar translation accuracy (98683 fixture)', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page)
    await enterZip(page, '98683')
  })

  test('gas: signed $ change since Jan 2025 is the big number; today\'s price on the secondary line', async ({ page }) => {
    const card = page.getByTestId('stat-card-gas')
    await expect(card.getByTestId('stat-value')).toHaveText(`${usd(fx.gas.data.change, 2)}/gal`)
    await expect(card.getByTestId('stat-secondary')).toHaveText(`since Jan 2025 · now $${fx.gas.data.current.toFixed(2)}`)
    await card.getByTestId('stat-info-toggle').click()
    await expect(card.getByTestId('stat-info')).toContainText(`${usd(fx.gas.data.change, 2)}/gal since`)
  })

  test('groceries: $6,000/yr × % change', async ({ page }) => {
    const expected = Math.round((6000 * fx.cpi.data.groceriesChange) / 100)
    const card = page.getByTestId('stat-card-groceries')
    await expect(card.getByTestId('stat-inline')).toHaveText(`≈ ${usd(expected)}/yr`)
    await card.getByTestId('stat-info-toggle').click()
    await expect(card.getByTestId('stat-info')).toContainText(`${usd(expected)}/yr on $6,000/yr`)
  })

  test('rent: seasonally adjusted $/mo, raw rent shown only as a dated level', async ({ page }) => {
    const expected = Math.round(fx.rent.curRent - fx.rent.curRent / (1 + fx.rent.pct / 100))
    const card = page.getByTestId('stat-card-rent')
    await expect(card.getByTestId('stat-inline')).toHaveText(`≈ ${usd(expected)}/mo`)
    await card.getByTestId('stat-info-toggle').click()
    const info = card.getByTestId('stat-info')
    await expect(info).toContainText(`≈ ${usd(expected)}/mo vs Jan 2025, after adjusting for the usual seasonal`)
    await expect(info.getByTestId('stat-info-line').nth(1)).toHaveText(/^Typical asking rent: \$[\d,]+\/mo \([A-Z][a-z]{2} \d{4}\)$/)
  })

  test('electricity: % change of the 12-month average price; $/mo = change in 12-mo avg ¢ × state kWh/month ÷ 100', async ({ page }) => {
    const e = fx.electricity.data
    const expected = Math.round(((e.current - e.baseline) * e.usageKwh) / 100)
    const card = page.getByTestId('stat-card-electricity')
    await expect(card.getByTestId('stat-value')).toHaveText(`${e.change > 0 ? '+' : e.change < 0 ? '−' : ''}${Math.abs(e.change).toFixed(1)}%`)
    await expect(card.getByTestId('stat-secondary')).toHaveText(`vs yr centered on Jan '25 · now ${e.current.toFixed(1)}¢/kWh (12-mo avg)`)
    await expect(card.getByTestId('stat-inline')).toHaveText(`≈ ${usd(expected)}/mo`)
    await expect(card.getByTestId('stat-source')).toHaveText(/^Washington · EIA · [A-Z][a-z]{2} \d{4}$/)
    await card.getByTestId('stat-info-toggle').click()
    await expect(card.getByTestId('stat-info')).toContainText(`average Washington home's monthly use (${Math.round(e.usageKwh)} kWh, 12-mo avg`)
    await expect(page.getByTestId('stat-cards')).not.toContainText(/tariff/i)
  })
})

test('CPI shelter fallback: local rent × 12 × rent-of-primary-residence % change', async ({ page }) => {
  await mockDataApi(page, { override: (_z, s) => ({ ...s, rent: null }) })
  await enterZip(page, '98683')
  const expected = Math.round((fx.census.data.medianRent * 12 * fx.cpi.data.rentIndexChange) / 100)
  const card = page.getByTestId('stat-card-shelter')
  await expect(card).toContainText('Shelter (CPI)')
  await expect(card.getByTestId('stat-inline')).toHaveText(`≈ ${usd(expected)}/yr in rent`)
  await card.getByTestId('stat-info-toggle').click()
  await expect(card.getByTestId('stat-info')).toContainText('rent of primary residence (BLS) applied to local median rent')
})

test('missing CPI renders "Data unavailable" cards, not 0%', async ({ page }) => {
  await mockDataApi(page, {
    override: (_z, s) => ({ ...s, rent: null, cpi: { data: null, error: 'Data unavailable', fetchedAt: '', sourceId: 'bls-cpi' } }),
  })
  await enterZip(page, '98683')
  await expect(page.getByTestId('stat-card-groceries')).toContainText('Data unavailable')
  await expect(page.getByTestId('stat-card-shelter')).toContainText('Data unavailable')
  await expect(page.getByTestId('stat-cards')).not.toContainText('0.0%')
})
