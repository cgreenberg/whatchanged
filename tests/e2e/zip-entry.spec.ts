import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip } from './helpers'

test.describe('Zip code entry flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page, { delayMs: 300 })
  })

  test('hero section renders with heading and input', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Enter your zip code' })).toBeVisible()
    await expect(page.getByTestId('zip-input')).toBeVisible()
  })

  test('invalid zip shows validation error', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('zip-input').fill('1234')
    await page.getByTestId('zip-input').press('Enter')
    const errorAlert = page.locator('p[role="alert"]')
    await expect(errorAlert).toBeVisible()
    await expect(errorAlert).toContainText('5-digit')
  })

  test('typing a zip does not prefetch the data API', async ({ page }) => {
    const calls: string[] = []
    page.on('request', r => { if (r.url().includes('/api/data/')) calls.push(r.url()) })
    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.waitForTimeout(500)
    expect(calls).toEqual([])
  })

  test('entering a zip shows skeletons, then four cards, and keeps the zip in the URL', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()
    await expect(page.getByTestId('stat-cards-loading')).toBeVisible()
    await expect(page.getByTestId('stat-cards').locator('[data-testid^="stat-card-"]')).toHaveCount(4, { timeout: 15000 })
    await expect(page).toHaveURL(/\?zip=98683$/)
  })

  test('a slow earlier request never overwrites a later one', async ({ page }) => {
    await page.unroute('**/api/data/*')
    await mockDataApi(page) // fast default
    await page.route('**/api/data/10001', async route => {
      await new Promise(r => setTimeout(r, 1500))
      await route.fallback()
    })
    await page.goto('/')
    await page.getByTestId('zip-input').fill('10001')
    await page.getByTestId('zip-input').press('Enter')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByTestId('zip-input').press('Enter')
    await expect(page.getByTestId('stat-cards')).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(2000)
    await expect(page.getByText('Vancouver, WA', { exact: false }).first()).toBeVisible()
    await expect(page).toHaveURL(/zip=98683/)
  })

  test('mobile viewport: no horizontal scroll with results', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await enterZip(page, '78701')
    const [bodyWidth, viewportWidth] = await page.evaluate(() => [document.body.scrollWidth, window.innerWidth])
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth)
  })
})
