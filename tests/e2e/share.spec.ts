import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip } from './helpers'

test.describe('Share functionality', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page)
  })

  test('share and copy buttons are visible after data loads', async ({ page }) => {
    await enterZip(page, '98683')
    await expect(page.getByTestId('share-button').first()).toContainText('Share')
    await expect(page.getByTestId('copy-link-button').first()).toBeVisible()
  })

  test('share-image failure shows an error instead of failing silently', async ({ page }) => {
    await page.route('**/api/share/**', r => r.fulfill({ status: 500, body: 'nope' }))
    await enterZip(page, '98683')
    await page.getByTestId('share-button').first().click()
    await expect(page.getByTestId('share-error').first()).toBeVisible()
  })

  test('landing page has a generic og:image', async ({ page }) => {
    await page.goto('/')
    const ogImage = await page.getAttribute('meta[property="og:image"]', 'content')
    expect(ogImage).toContain('/api/og')
  })
})
