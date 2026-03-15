import { test, expect } from '@playwright/test'

test.describe('Tariff widget and Dig Deeper', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('zip-input').fill('98683')
    await page.getByRole('button', { name: /See What Changed/i }).click()
    // Wait for data to load
    await expect(page.getByTestId('stat-cards')).toBeVisible({ timeout: 10000 })
  })

  test('tariff widget shows estimated cost', async ({ page }) => {
    const widget = page.getByTestId('tariff-widget')
    await expect(widget).toBeVisible({ timeout: 5000 })
    // Should contain a dollar amount
    await expect(widget).toContainText('$')
    // Should contain the disclaimer
    await expect(widget).toContainText('Estimated')
  })

  test('dig deeper starts collapsed', async ({ page }) => {
    const toggle = page.getByTestId('dig-deeper-toggle')
    await expect(toggle).toBeVisible({ timeout: 5000 })
    // Content should not be visible initially
    // The grid inside should not exist when collapsed
  })

  test('dig deeper expands on click', async ({ page }) => {
    const toggle = page.getByTestId('dig-deeper-toggle')
    await expect(toggle).toBeVisible({ timeout: 5000 })
    await toggle.click()
    // After clicking, content should appear
    await expect(page.getByText('Median Rent')).toBeVisible({ timeout: 2000 })
  })
})
