import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip } from './helpers'

test.describe('Charts section', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page)
    await enterZip(page, '98683')
    await expect(page.getByTestId('charts-section')).toBeVisible({ timeout: 10000 })
  })

  test('five charts, each with a provenance line', async ({ page }) => {
    for (const id of ['gas', 'cpi-groceries', 'cpi-shelter', 'cpi-energy', 'unemployment']) {
      const chart = page.getByTestId(`chart-${id}`)
      await expect(chart).toBeVisible()
      const line = chart.getByTestId('provenance').last()
      await expect(line).toBeVisible()
      expect(((await line.textContent()) ?? '').split(' · ').length).toBeGreaterThanOrEqual(5)
    }
  })

  test('"Jan 2025" is the default view and CPI charts say what the % is relative to', async ({ page }) => {
    await expect(page.getByTestId('timeframe-Jan 2025').first()).toHaveClass(/bg-zinc-700/)
    await expect(page.getByTestId('chart-cpi-groceries').getByTestId('chart-window')).toHaveText('% change since Jan 2025')
  })

  test('switching to 3Y re-bases the % label', async ({ page }) => {
    const chart = page.getByTestId('chart-cpi-groceries')
    await chart.getByTestId('timeframe-3Y').click()
    await expect(chart.getByTestId('timeframe-3Y')).toHaveClass(/bg-zinc-700/)
    await expect(chart.getByTestId('chart-window')).not.toHaveText('% change since Jan 2025')
    await expect(chart.getByTestId('chart-window')).toHaveText(/^% change since \w{3} \d{4}$/)
  })

  test('unemployment: SA 3-month headline and NSA chart label', async ({ page }) => {
    const chart = page.getByTestId('chart-unemployment')
    await expect(chart.getByTestId('unemployment-headline')).toContainText('3-month avg, seasonally adjusted by whatchanged', { timeout: 10000 })
    await expect(chart.getByTestId('provenance').last()).toContainText('not seasonally adjusted')
  })

  test('unemployment provenance mentions the dashed U.S. line only when shown', async ({ page }) => {
    const chart = page.getByTestId('chart-unemployment')
    const line = chart.getByTestId('provenance').last()
    await expect(line).not.toContainText('dashed')
    await chart.getByLabel('Show national').check()
    await expect(line).toContainText('dashed: U.S.')
  })
})

test.describe('Charts section — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('"Jan 2025" timeframe button stays on one line at 390px', async ({ page }) => {
    await mockDataApi(page)
    await enterZip(page, '98683')
    const btn = page.getByTestId('chart-cpi-groceries').getByTestId('timeframe-Jan 2025')
    await expect(btn).toBeVisible({ timeout: 10000 })
    const other = page.getByTestId('chart-cpi-groceries').getByTestId('timeframe-3Y')
    const [a, b] = [await btn.boundingBox(), await other.boundingBox()]
    expect(a!.height).toBeLessThanOrEqual(b!.height + 1)
  })
})
