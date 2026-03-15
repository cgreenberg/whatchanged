import { test, expect } from '@playwright/test'

test.describe('Charts section', () => {
  test('charts render after zip entry', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()

    // Wait for charts section to appear
    await expect(page.getByTestId('charts-section')).toBeVisible({ timeout: 10000 })

    // At least one chart should render
    const charts = page.locator('[data-testid^="chart-"]')
    await expect(charts.first()).toBeVisible()
  })

  test('5Y is selected by default', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()

    await expect(page.getByTestId('charts-section')).toBeVisible({ timeout: 10000 })

    // The 5Y button should have the active styling
    const fiveYButton = page.getByTestId('timeframe-5Y').first()
    await expect(fiveYButton).toBeVisible()
    // Check it has the active class (bg-zinc-700)
    await expect(fiveYButton).toHaveClass(/bg-zinc-700/)
  })

  test('clicking 1Y changes displayed data', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()

    await expect(page.getByTestId('charts-section')).toBeVisible({ timeout: 10000 })

    // Click the 1Y button on the first chart
    await page.getByTestId('timeframe-1Y').first().click()

    // The 1Y button should now be active
    await expect(page.getByTestId('timeframe-1Y').first()).toHaveClass(/bg-zinc-700/)
  })
})
