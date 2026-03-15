import { test, expect } from '@playwright/test'

test.describe('Share functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()
    await expect(page.getByTestId('stat-cards')).toBeVisible({ timeout: 10000 })
  })

  test('share button is visible after data loads', async ({ page }) => {
    await expect(page.getByTestId('share-button')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('share-button')).toContainText('Share')
  })

  test('OG image endpoint returns PNG', async ({ page }) => {
    const response = await page.request.get('/api/og?zip=98683&location=Clark%20County%2C%20WA&unemployment=5.0%25')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
    const body = await response.body()
    expect(body.length).toBeGreaterThan(1000)
  })

  test('page has og:image meta tag', async ({ page }) => {
    const ogImage = await page.getAttribute('meta[property="og:image"]', 'content')
    expect(ogImage).toContain('/api/og')
  })
})
