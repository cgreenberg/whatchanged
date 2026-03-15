import { test, expect } from '@playwright/test'

test.describe('Zip code entry flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('hero section renders with heading and input', async ({ page }) => {
    await expect(page.getByText('Enter your zip code.')).toBeVisible()
    await expect(page.getByTestId('zip-input')).toBeVisible()
  })

  test('invalid zip shows validation error', async ({ page }) => {
    await page.getByTestId('zip-input').fill('1234')
    await page.getByTestId('zip-input').press('Enter')
    const errorAlert = page.locator('p[role="alert"]')
    await expect(errorAlert).toBeVisible()
    await expect(errorAlert).toContainText('5-digit')
  })

  test('mobile viewport: all elements fit without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth)
  })

  test('entering zip shows skeleton cards immediately', async ({ page }) => {
    // Intercept the API to delay response
    await page.route('/api/data/*', async route => {
      await new Promise(r => setTimeout(r, 500))
      await route.continue()
    })

    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()

    // Skeletons should appear quickly
    await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 300 })
  })
})
