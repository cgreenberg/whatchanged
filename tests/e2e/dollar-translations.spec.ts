import { test, expect } from '@playwright/test'

const MOCK_SNAPSHOT = {
  zip: '98683',
  location: {
    zip: '98683',
    countyFips: '53011',
    countyName: 'Clark County',
    stateName: 'Washington',
    stateAbbr: 'WA',
    cityName: 'Vancouver',
  },
  gas: {
    data: {
      current: 3.45,
      baseline: 3.2,
      change: 0.25,
      region: 'Washington',
      geoLevel: 'Washington state avg',
      isNationalFallback: false,
      duoarea: 'SWA',
      series: [],
      nationalSeries: [],
    },
    error: null,
    fetchedAt: new Date().toISOString(),
    sourceId: 'eia',
  },
  cpi: {
    data: {
      groceriesCurrent: 330.5,
      groceriesBaseline: 320.0,
      groceriesChange: 3.3,
      shelterCurrent: 410.2,
      shelterBaseline: 400.0,
      shelterChange: 2.6,
      energyCurrent: 280.0,
      energyBaseline: 275.0,
      energyChange: 1.8,
      metro: 'Seattle-Tacoma-Bellevue',
      seriesIds: {
        groceries: 'CUURS49DSAF11',
        shelter: 'CUURS49DSAH1',
        energy: 'CUURS49DSA0E',
      },
      series: [],
      nationalSeries: [],
    },
    error: null,
    fetchedAt: new Date().toISOString(),
    sourceId: 'bls-cpi',
  },
  census: {
    data: {
      medianIncome: 82000,
      medianRent: 1500,
      zip: '98683',
      year: 2023,
    },
    error: null,
    fetchedAt: new Date().toISOString(),
    sourceId: 'census',
  },
  tariff: {
    data: {
      medianIncome: 82000,
      tariffRate: 0.0205,
      estimatedCost: 1681,
      source: 'Yale Budget Lab',
      incomeSource: 'Census ACS',
      isFallback: false,
    },
    error: null,
    fetchedAt: new Date().toISOString(),
    sourceId: 'tariff',
  },
  unemployment: {
    data: {
      current: 4.2,
      baseline: 3.8,
      change: 0.4,
      countyFips: '53011',
      seriesId: 'LAUCN530110000000003',
      series: [],
      nationalSeries: [],
    },
    error: null,
    fetchedAt: new Date().toISOString(),
    sourceId: 'bls-laus',
  },
  federal: {
    data: null,
    error: 'not displayed',
    fetchedAt: new Date().toISOString(),
    sourceId: 'usaspending',
  },
  fetchedAt: new Date().toISOString(),
  cacheStatus: {
    unemployment: 'hit',
    cpi: 'hit',
    gas: 'hit',
    federal: 'hit',
    census: 'hit',
  },
}

async function enterZipAndWaitForCards(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByTestId('zip-input').fill('98683')
  await page.getByRole('button', { name: /See What Changed/i }).click()
  await expect(page.getByTestId('stat-cards')).toBeVisible({ timeout: 10000 })
}

test.describe('Dollar translation accuracy', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/data/98683', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SNAPSHOT),
      })
    })
  })

  test('gas card shows correct dollar change and price', async ({ page }) => {
    await enterZipAndWaitForCards(page)

    const cards = page.getByTestId('stat-cards')
    // Gas: current = $3.45/gal, change = +$0.25
    await expect(cards).toContainText('$3.45/gal')
    await expect(cards).toContainText('+$0.25')
  })

  test('shelter card shows correct dollar impact from median rent', async ({ page }) => {
    await enterZipAndWaitForCards(page)

    const cards = page.getByTestId('stat-cards')
    // shelterChange = 2.6%, medianRent = 1500
    // annualRent = 1500 * 12 = 18000
    // dollarImpact = Math.round(18000 * 2.6 / 100) = Math.round(468) = 468
    await expect(cards).toContainText('+2.6%')
    await expect(cards).toContainText('$468/yr')
  })

  test('grocery card shows correct income-scaled dollar impact', async ({ page }) => {
    await enterZipAndWaitForCards(page)

    const cards = page.getByTestId('stat-cards')
    // groceriesChange = 3.3%, medianIncome = 82000
    // grocerySpend = 6000 * (82000 / 74580) ≈ 6596.94
    // dollarImpact = Math.round(6596.94 * 3.3 / 100) = Math.round(217.7) = 218
    await expect(cards).toContainText('+3.3%')
    await expect(cards).toContainText('$218/yr')
  })

  test('tariff card shows correct estimate from median income', async ({ page }) => {
    await enterZipAndWaitForCards(page)

    const cards = page.getByTestId('stat-cards')
    // medianIncome = 82000, tariffRate = 0.0205
    // cost = Math.round(82000 * 0.0205) = Math.round(1681) = 1681
    // formatDollars(1681) = "$1,681"
    await expect(cards).toContainText('$1,681/yr')
  })
})
