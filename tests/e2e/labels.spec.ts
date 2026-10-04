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
    await expect(rent.getByTestId('provenance')).toContainText('Zillow ZORI · Travis County, TX')
    const housing = page.getByTestId('housing-chart')
    await expect(housing).toHaveAttribute('data-tab', 'rent', { timeout: 15000 })
    await housing.getByTestId('housing-tab-shelter').click()
    await expect(housing).toContainText('Shelter (CPI)')
    await expect(housing.getByTestId('provenance').last()).toContainText('BLS CPI shelter · division: West South Central')
    // Distinct sources, distinct labels
    expect(await rent.textContent()).not.toContain('CPI')
  })

  test('every hero card has a full provenance line', async ({ page }) => {
    await enterZip(page, '10001')
    const lines = page.getByTestId('stat-cards').getByTestId('provenance')
    await expect(lines).toHaveCount(4)
    for (const t of await lines.allTextContents()) expect(t.split(' · ').length).toBeGreaterThanOrEqual(5)
  })
})

test.describe('Data notes and explanations', () => {
  test('28601 (Catawba NC, no Zillow rent): Housing graph opens on Shelter (CPI) and explains CPI vs Zillow', async ({ page }) => {
    // Serve a recorded snapshot re-pointed at Catawba County; county shards come from /public/data
    await page.route('**/api/data/*', async route => {
      const snap = loadFixture('98683') as { zip: string; rent: unknown; location: Record<string, string> }
      snap.zip = '28601'
      snap.rent = null
      snap.location = { ...snap.location, zip: '28601', countyFips: '37035', countyName: 'Catawba County', stateAbbr: 'NC', stateName: 'North Carolina', cityName: 'Hickory' }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snap) })
    })
    await enterZip(page, '28601')
    const housing = page.getByTestId('housing-chart')
    await expect(housing.getByTestId('housing-missing-note')).toContainText('No Zillow rent data for Catawba County, NC', { timeout: 15000 })
    await expect(housing).toHaveAttribute('data-tab', 'shelter')
    await expect(housing.getByTestId('housing-tab-rent')).toBeDisabled()
    await expect(housing.getByTestId('chart-note')).toContainText('trails new-lease rents by about a year')
  })
})
