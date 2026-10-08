import { test, expect } from '@playwright/test'
import { mockDataApi, mockMapMetrics, enterZip } from './helpers'

// "Or explore a city" sits under the search box on the homepage; on a results page it moves to the very
// bottom (after the map) as a compact "Try another place" row.
test.describe('City shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page)
    await mockMapMetrics(page)
  })

  test('homepage: "Or explore a city" right under the search box', async ({ page }) => {
    await page.goto('/')
    const grid = page.getByTestId('city-grid')
    await expect(grid).toBeVisible()
    await expect(page.getByText('Or explore a city')).toBeVisible()
    await expect(page.getByTestId('city-grid-compact')).toHaveCount(0)
    // directly below the input, above the map
    const input = await page.getByTestId('zip-input').boundingBox()
    const g = await grid.boundingBox()
    expect(g!.y).toBeGreaterThan(input!.y)
    expect(g!.y - input!.y).toBeLessThan(400)
    const map = await page.getByTestId('national-map').boundingBox().catch(() => null)
    if (map) expect(g!.y).toBeLessThan(map.y)
  })

  test('results page: compact "Try another place" row after the map, before the footer', async ({ page }) => {
    await enterZip(page, '98683')
    await expect(page.getByTestId('city-grid')).toHaveCount(0)
    const row = page.getByTestId('city-grid-compact')
    await row.scrollIntoViewIfNeeded()
    await expect(row).toBeVisible()
    await expect(page.getByText('Try another place')).toBeVisible()
    await expect(page.getByText('Or explore a city')).toHaveCount(0)
    const map = page.getByTestId('national-map')
    await map.scrollIntoViewIfNeeded()
    const [r, m, f] = await Promise.all([
      row.boundingBox(), map.boundingBox(), page.getByRole('link', { name: 'About the data' }).boundingBox(),
    ])
    expect(r!.y).toBeGreaterThan(m!.y + m!.height - 1)
    expect(f!.y).toBeGreaterThan(r!.y + r!.height - 1)
  })

  test('results page: a city in the bottom row loads that place', async ({ page }) => {
    await enterZip(page, '98683')
    const row = page.getByTestId('city-grid-compact')
    await row.scrollIntoViewIfNeeded()
    await row.getByRole('button', { name: 'New York' }).click()
    await expect(page).toHaveURL(/zip=10001/, { timeout: 15000 })
    await expect(page.getByTestId('stat-cards')).toBeVisible()
  })
})
