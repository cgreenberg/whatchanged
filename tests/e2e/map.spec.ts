import { test, expect } from '@playwright/test'

test.describe('National county map', () => {
  test('renders on the landing page and switches metrics', async ({ page }) => {
    await page.goto('/')
    const map = page.getByTestId('national-map')
    await map.scrollIntoViewIfNeeded()
    await expect(map.locator('svg path').nth(1000)).toBeAttached({ timeout: 15000 })
    await page.getByRole('button', { name: 'Rent' }).click()
    await expect(page.getByText(/Zillow Observed Rent Index/)).toBeVisible()
  })

  test('highlights the searched county and shows local pulse', async ({ page }) => {
    await page.goto('/?zip=98683')
    await expect(page.getByTestId('local-pulse')).toBeVisible({ timeout: 20000 })
    const map = page.getByTestId('national-map')
    await map.scrollIntoViewIfNeeded()
    await expect(map.getByText('Clark County, WA')).toBeVisible({ timeout: 15000 })
  })
})
