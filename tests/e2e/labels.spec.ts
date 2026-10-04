import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip, loadFixture } from './helpers'

test.describe('Geography and concept labels', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page)
  })

  for (const zip of ['78701', '98683', '06902']) {
    // Local Pulse is hidden behind SHOW_LOCAL_PULSE (src/lib/features.ts); re-enable with the flag.
    test.skip(`${zip}: local pulse county equals the banner county`, async ({ page }) => {
      await enterZip(page, zip)
      const banner = (await page.getByTestId('location-banner').textContent()) ?? ''
      const county = banner.split('—').pop()!.split(',')[0].trim()
      expect(county).toMatch(/County|Parish|Borough/)
      const pulse = page.getByTestId('local-pulse')
      await expect(pulse.locator('h2')).toContainText(county, { timeout: 15000 })
    })
  }

  test('78701: rent and shelter cards carry distinct concept labels', async ({ page }) => {
    await enterZip(page, '78701')
    const rent = page.getByTestId('stat-card-rent')
    await expect(rent).toContainText('Rent (new leases)')
    await expect(rent.getByTestId('provenance')).toContainText('Zillow ZORI · Travis County, TX')
    const shelter = page.getByTestId('chart-cpi-shelter')
    await expect(shelter).toContainText('Shelter prices (CPI)')
    await expect(shelter.getByTestId('provenance')).toContainText('BLS CPI shelter · division: West South Central')
    // Distinct sources, distinct labels, and the pulse doesn't repeat the county rent
    expect(await rent.textContent()).not.toContain('CPI')
    await expect(page.getByTestId('local-pulse')).toHaveCount(0)
  })

  test('every hero card has a full provenance line', async ({ page }) => {
    await enterZip(page, '10001')
    const lines = page.getByTestId('stat-cards').getByTestId('provenance')
    await expect(lines).toHaveCount(4)
    for (const t of await lines.allTextContents()) expect(t.split(' · ').length).toBeGreaterThanOrEqual(5)
  })
})

test.describe('Data notes and explanations', () => {
  test('28801 (Buncombe NC): unemployment headline shows the Helene note; shelter chart explains CPI vs Zillow', async ({ page }) => {
    // Serve a recorded snapshot re-pointed at Buncombe County; county shards come from /public/data
    await page.route('**/api/data/*', async route => {
      const snap = loadFixture('98683') as { zip: string; location: Record<string, string> }
      snap.zip = '28801'
      snap.location = { ...snap.location, zip: '28801', countyFips: '37021', countyName: 'Buncombe County', stateAbbr: 'NC', stateName: 'North Carolina', cityName: 'Asheville' }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snap) })
    })
    await enterZip(page, '28801')
    const headline = page.getByTestId('unemployment-headline')
    await expect(headline.getByTestId('flag-note')).toContainText('Hurricane Helene', { timeout: 15000 })
    await expect(page.getByTestId('chart-cpi-shelter').getByTestId('chart-note')).toContainText('lags market rents by about a year')
    await expect(page.getByTestId('rent-vs-cpi-note')).toBeVisible()
  })
})
