import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip, loadFixture } from './helpers'

// Rendered dollars must equal the stated formula applied to the API numbers.
const fx = loadFixture('98683') as {
  gas: { data: { current: number; change: number } }
  cpi: { data: { groceriesChange: number; shelterChange: number } }
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

  test('gas: price and signed $/gal change', async ({ page }) => {
    const card = page.getByTestId('stat-card-gas')
    await expect(card).toContainText(`$${fx.gas.data.current.toFixed(2)}/gal`)
    await expect(card).toContainText(`${usd(fx.gas.data.change, 2)}/gal`)
  })

  test('groceries: $6,000/yr × % change', async ({ page }) => {
    const expected = Math.round((6000 * fx.cpi.data.groceriesChange) / 100)
    await expect(page.getByTestId('stat-card-groceries')).toContainText(`${usd(expected)}/yr on $6,000/yr`)
  })

  test('rent: seasonally adjusted $/mo, raw rent shown only as a dated level', async ({ page }) => {
    const expected = Math.round(fx.rent.curRent - fx.rent.curRent / (1 + fx.rent.pct / 100))
    const card = page.getByTestId('stat-card-rent')
    await expect(card).toContainText(`≈ ${usd(expected)}/mo vs Jan 2025, after adjusting for the usual seasonal`)
    await expect(card.getByTestId('stat-detail')).toHaveText(/^Typical asking rent: \$[\d,]+\/mo \([A-Z][a-z]{2} \d{4}\)$/)
  })

  test('tariff: median income × 0.0205', async ({ page }) => {
    const expected = Math.round(fx.tariff.data.medianIncome * 0.0205)
    await expect(page.getByTestId('stat-card-tariff')).toContainText(`~$${expected.toLocaleString('en-US')}/yr`)
  })
})

test('CPI shelter fallback: local rent × 12 × % change', async ({ page }) => {
  await mockDataApi(page, { override: (_z, s) => ({ ...s, rent: null }) })
  await enterZip(page, '98683')
  const expected = Math.round((fx.census.data.medianRent * 12 * fx.cpi.data.shelterChange) / 100)
  const card = page.getByTestId('stat-card-shelter')
  await expect(card).toContainText("Shelter prices (CPI: mainly rents + owners' equivalent rent)")
  await expect(card).toContainText(`${usd(expected)}/yr on local median rent`)
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
