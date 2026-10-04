import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip } from './helpers'

test.describe('National county map', () => {
  test('renders on the landing page and switches metrics', async ({ page }) => {
    await page.goto('/')
    const map = page.getByTestId('national-map')
    await map.scrollIntoViewIfNeeded()
    await expect(map.locator('svg path').nth(1000)).toBeAttached({ timeout: 15000 })
    await page.getByRole('button', { name: 'Rent', exact: true }).click()
    await expect(page.getByTestId('map-source')).toContainText('Zillow ZORI')
    await expect(page.getByTestId('map-source')).toContainText('seasonally adjusted by whatchanged')
  })

  test('shows an error state instead of hanging when map data fails', async ({ page }) => {
    await page.route('**/data/counties-albers-10m.json', r => r.fulfill({ status: 500, body: 'nope' }))
    await page.goto('/')
    const map = page.getByTestId('national-map')
    await map.scrollIntoViewIfNeeded()
    await expect(map.getByTestId('map-error')).toBeVisible({ timeout: 15000 })
  })

  test('highlights the searched county on the map (local pulse hidden by flag)', async ({ page }) => {
    await mockDataApi(page)
    await enterZip(page, '98683')
    // SHOW_LOCAL_PULSE=false: the pulse section must not render
    await expect(page.getByTestId('location-banner')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('local-pulse')).toHaveCount(0)
    const map = page.getByTestId('national-map')
    await map.scrollIntoViewIfNeeded()
    await expect(map.getByText('Clark County, WA')).toBeVisible({ timeout: 15000 })
  })
})
