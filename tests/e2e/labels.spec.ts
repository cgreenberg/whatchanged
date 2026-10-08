import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip, loadFixture } from './helpers'

test.describe('Geography and concept labels', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page)
  })

  test('78701: rent and shelter cards carry distinct concept labels', async ({ page }) => {
    await enterZip(page, '78701')
    const rent = page.getByTestId('stat-card-rent')
    await expect(rent).toContainText('Rent (new leases)')
    await expect(rent.getByTestId('stat-source')).toHaveText('Travis County · Zillow · Aug 2026')
    // full provenance is one tap away
    await expect(rent.getByTestId('provenance')).toBeHidden()
    await rent.getByTestId('stat-info-toggle').click()
    await expect(rent.getByTestId('provenance')).toBeVisible()
    await expect(rent.getByTestId('provenance')).toContainText('Zillow ZORI · Travis County, TX')
    const housing = page.getByTestId('housing-chart')
    await expect(housing).toHaveAttribute('data-tab', 'rent', { timeout: 15000 })
    await housing.getByTestId('housing-tab-shelter').click()
    await expect(housing).toContainText('Shelter (CPI)')
    await expect(housing.getByTestId('provenance').last()).toContainText('BLS CPI shelter · division: West South Central')
    // Distinct sources, distinct labels (the card face; its ⓘ explains how it differs from CPI shelter)
    await rent.getByTestId('stat-info-toggle').click()
    await expect(rent.getByTestId('stat-info')).toBeHidden()
    expect(await rent.innerText()).not.toContain('CPI')
  })

  test('every hero card: short source line visible, full provenance line in its ⓘ disclosure', async ({ page }) => {
    await enterZip(page, '10001')
    const cards = page.getByTestId('stat-cards').locator('[data-testid^="stat-card-"]')
    await expect(cards).toHaveCount(4)
    for (const card of await cards.all()) {
      await expect(card.getByTestId('stat-source')).toBeVisible()
      const toggle = card.getByTestId('stat-info-toggle')
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(card.getByTestId('stat-info')).toBeHidden()
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const line = card.getByTestId('stat-info').getByTestId('provenance').first()
      await expect(line).toBeVisible()
      expect((await line.textContent())!.split(' · ').length).toBeGreaterThanOrEqual(5)
    }
  })

  test('ⓘ works from the keyboard: Enter opens, Escape closes', async ({ page }) => {
    await enterZip(page, '10001')
    const card = page.getByTestId('stat-card-groceries')
    const toggle = card.getByTestId('stat-info-toggle')
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(card.getByTestId('stat-info')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(card.getByTestId('stat-info')).toBeHidden()
    await expect(toggle).toBeFocused()
  })

  for (const zip of ['10001', '06902']) {
    test(`card faces stay short (≤ 120 characters outside the ⓘ disclosure): ${zip}`, async ({ page }) => {
      await enterZip(page, zip)
      for (const card of await page.getByTestId('stat-cards').locator('[data-testid^="stat-card-"]').all()) {
        const visible = (await card.innerText()).replace(/\s+/g, ' ').trim()
        expect(visible.length, visible).toBeLessThanOrEqual(120)
      }
    })
  }

  test('electricity card: "{State} · EIA · {Mon YYYY}" source line; 12-month-average method in its ⓘ', async ({ page }) => {
    await enterZip(page, '06902')
    const card = page.getByTestId('stat-card-electricity')
    await expect(card.getByTestId('stat-source')).toHaveText(/^Connecticut · EIA · [A-Z][a-z]{2} \d{4}$/)
    // Change first: the % is the big number; the secondary line names the window and the 12-month average level
    await expect(card.getByTestId('stat-value')).toHaveText(/^[+−]?\d+\.\d%$/)
    await expect(card.getByTestId('stat-secondary')).toHaveText(/^since Jan 2025 · 12-mo avg \d+\.\d¢\/kWh$/)
    await card.getByTestId('stat-info-toggle').click()
    await expect(card.getByTestId('stat-info')).toContainText('Why 12-month averages')
    await expect(card.getByTestId('provenance')).toContainText('EIA average residential electricity price · Connecticut (statewide average)')
  })
})

test.describe('Data notes and explanations', () => {
  test('55334 (Sibley MN, no Zillow county or metro rent): Housing graph opens on Shelter (CPI) and explains CPI vs Zillow', async ({ page }) => {
    // Serve a recorded snapshot re-pointed at Sibley County; county shards come from /public/data
    await page.route('**/api/data/*', async route => {
      const snap = loadFixture('98683') as { zip: string; rent: unknown; location: Record<string, string> }
      snap.zip = '55334'
      snap.rent = null
      snap.location = { ...snap.location, zip: '55334', countyFips: '27143', countyName: 'Sibley County', stateAbbr: 'MN', stateName: 'Minnesota', cityName: 'Gaylord' }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snap) })
    })
    await enterZip(page, '55334')
    const housing = page.getByTestId('housing-chart')
    await expect(housing.getByTestId('housing-missing-note')).toContainText('No Zillow rent data for Sibley County, MN', { timeout: 15000 })
    await expect(housing).toHaveAttribute('data-tab', 'shelter')
    await expect(housing.getByTestId('housing-tab-rent')).toBeDisabled()
    await expect(housing.getByTestId('chart-note')).toContainText('trails new-lease rents by about a year')
  })
})
