import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip, loadFixture } from './helpers'

// Rendered dollars must equal the stated formula applied to the API numbers.
const fx = loadFixture('98683') as {
  gas: { data: { current: number; change: number } }
  cpi: { data: { groceriesChange: number; shelterChange: number; rentIndexChange: number } }
  rent: { pct: number; curRent: number }
  tariff: { data: { medianIncome: number } }
  census: { data: { medianRent: number } }
}
const usd = (v: number, d = 0) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`

test.describe('Dollar translation accuracy (98683 fixture)', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page)
    await enterZip(page, '98683')
  })

  test('gas: price and signed $ change since Jan 2025', async ({ page }) => {
    const card = page.getByTestId('stat-card-gas')
    await expect(card.getByTestId('stat-value')).toHaveText(`$${fx.gas.data.current.toFixed(2)}/gal`)
    await expect(card.getByTestId('stat-change')).toHaveText(`${usd(fx.gas.data.change, 2)} since Jan 2025`)
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

  test('tariff: median income × 0.0205', async ({ page }) => {
    const expected = Math.round(fx.tariff.data.medianIncome * 0.0205)
    await expect(page.getByTestId('stat-card-tariff')).toContainText(`~$${expected.toLocaleString('en-US')}/yr`)
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
