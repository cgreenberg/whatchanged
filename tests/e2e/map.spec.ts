import { test, expect } from '@playwright/test'

test.describe('Map section', () => {
  test('map section is present in the page', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()
    await expect(page.getByTestId('stat-cards')).toBeVisible({ timeout: 10000 })

    // Scroll to map
    const mapSection = page.getByTestId('map-section')
    await mapSection.scrollIntoViewIfNeeded()
    await expect(mapSection).toBeVisible()
  })

  test('map loads lazily on scroll', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()
    await expect(page.getByTestId('stat-cards')).toBeVisible({ timeout: 10000 })

    // Scroll map section into view to trigger IntersectionObserver
    const mapSection = page.getByTestId('map-section')
    await mapSection.scrollIntoViewIfNeeded()

    // Wait for Leaflet map container
    await expect(page.getByTestId('leaflet-map')).toBeVisible({ timeout: 10000 })
  })

  test('map renders without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()
    await expect(page.getByTestId('stat-cards')).toBeVisible({ timeout: 10000 })

    const mapSection = page.getByTestId('map-section')
    await mapSection.scrollIntoViewIfNeeded()
    await expect(page.getByTestId('leaflet-map')).toBeVisible({ timeout: 10000 })

    // Filter out known acceptable errors (like failed API calls to external services)
    const realErrors = errors.filter(e =>
      !e.includes('api.bls.gov') &&
      !e.includes('api.eia.gov') &&
      !e.includes('api.usaspending.gov') &&
      !e.includes('Failed to load resource')
    )
    expect(realErrors).toHaveLength(0)
  })
})
