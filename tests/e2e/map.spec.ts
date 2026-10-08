import { test, expect, type Page } from '@playwright/test'
import { mockDataApi, mockMapMetrics, enterZip, loadFixture } from './helpers'

/** Wait for the county map to render (it lazy-loads near the viewport). */
async function mapReady(page: Page) {
  const map = page.getByTestId('national-map')
  await map.scrollIntoViewIfNeeded()
  await expect(map.locator('svg path[data-fips]').nth(1000)).toBeAttached({ timeout: 20000 })
  return map
}

/**
 * Click a county the way a user does: at a screen point inside its shape, letting the browser
 * hit-test (no element-targeted dispatch, so an overlay on top of the county would swallow it).
 */
async function clickCounty(page: Page, fips: string) {
  const path = page.locator(`[data-testid="national-map"] svg path[data-fips="${fips}"]`)
  await path.scrollIntoViewIfNeeded()
  const box = (await path.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

test.describe('National county map', () => {
  test('renders on the landing page with price metrics only', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    await expect(map.getByRole('button', { name: 'Home prices', exact: true })).toBeVisible()
    // Gas | Rent | Home prices | Groceries | Electricity
    const chips = await map.locator('button[aria-pressed]').allInnerTexts()
    expect(chips.map(c => c.trim())).toEqual(['Gas', 'Rent', 'Home prices', 'Groceries', 'Electricity'])
    for (const gone of ['Unemployment', 'Paycheck vs prices', 'New construction']) {
      await expect(map.getByRole('button', { name: gone })).toHaveCount(0)
    }
    await map.getByRole('button', { name: 'Rent', exact: true }).click()
    await expect(page.getByTestId('map-source')).toContainText('Zillow ZORI')
    await expect(page.getByTestId('map-source')).toContainText('seasonally adjusted by whatchanged')
  })

  test('regional metrics (gas, groceries, electricity): block note, no time-lapse, no movers; county metrics keep both', async ({ page }) => {
    await mockMapMetrics(page)
    await page.goto('/')
    const map = await mapReady(page)
    await expect(map.getByTestId('map-play')).toBeVisible()
    await expect(map.getByTestId('map-mover').first()).toBeVisible()
    for (const [name, note, source] of [
      ['Electricity', 'statewide averages', 'EIA average residential electricity price · statewide'],
      ['Gas', 'not by county', 'EIA weekly / BLS monthly regular gasoline'],
      ['Groceries', 'not by county', 'BLS CPI food at home'],
    ] as const) {
      await map.getByRole('button', { name, exact: true }).click()
      await expect(map.getByTestId('map-scope-note')).toContainText(note)
      await expect(map.getByTestId('map-source')).toContainText(source)
      await expect(map.getByTestId('map-play')).toHaveCount(0)
      await expect(map.getByTestId('map-mover')).toHaveCount(0)
      await expect(map.getByTestId('map-no-movers')).toContainText("isn't published county by county")
    }
    // Electricity: a whole recorded state is colored; a state not in the fixture is hatched (no data)
    await map.getByRole('button', { name: 'Electricity', exact: true }).click()
    const fill = (fips: string) => map.locator(`svg path[data-fips="${fips}"]`).getAttribute('fill')
    expect(await fill('23003')).toMatch(/^rgb\(/) // Aroostook ME
    expect(await fill('23005')).toBe(await fill('23003')) // same state, same color
    expect(await fill('39035')).toMatch(/^url\(#/) // Cuyahoga OH: not in the fixture
    await map.getByRole('button', { name: 'Rent', exact: true }).click()
    await expect(map.getByTestId('map-play')).toBeVisible()
    await expect(map.getByTestId('map-scope-note')).toHaveCount(0)
  })

  test('a selected county lists all five measures, each with the area its number covers', async ({ page }) => {
    await mockMapMetrics(page)
    await mockDataApi(page)
    await enterZip(page, '98683')
    const map = await mapReady(page)
    const sel = map.getByTestId('map-selection')
    await expect(sel).toHaveAttribute('data-fips', '53011')
    await expect(sel.getByTestId('map-value-hv')).toContainText('typical home')
    await expect(sel.getByTestId('map-value-rent')).toContainText('typical asking rent')
    await expect(sel.getByTestId('map-value-gas')).toContainText('/gal since Jan 2025')
    await expect(sel.getByTestId('map-value-gas')).toContainText('Washington state avg')
    await expect(sel.getByTestId('map-value-groceries')).toContainText('Pacific div.')
    await expect(sel.getByTestId('map-value-elec')).toContainText('Washington statewide')
    await expect(sel.getByTestId('map-value-elec')).toContainText('¢/kWh')
    // a county whose regional series isn't cached says so instead of showing a number
    await clickCounty(page, '39035')
    await expect(sel.getByTestId('map-value-elec')).toContainText('no data')
  })

  test('shows an error state instead of hanging when map data fails', async ({ page }) => {
    await page.route('**/data/counties-albers-10m.json', r => r.fulfill({ status: 500, body: 'nope' }))
    await page.goto('/')
    const map = page.getByTestId('national-map')
    await map.scrollIntoViewIfNeeded()
    await expect(map.getByTestId('map-error')).toBeVisible({ timeout: 15000 })
  })

  test('highlights the searched county on the map', async ({ page }) => {
    await mockDataApi(page)
    await enterZip(page, '98683')
    await expect(page.getByTestId('location-banner')).toBeVisible({ timeout: 20000 })
    const map = await mapReady(page)
    await expect(map.getByTestId('map-selection')).toHaveAttribute('data-fips', '53011')
    await expect(map.getByTestId('map-selection')).toContainText('Clark County, WA')
  })

  test('clicking a county selects it, even in the corner the Play button used to cover', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    // Aroostook County, ME: top-right corner of the map
    await clickCounty(page, '23003')
    await expect(map.getByTestId('map-selection')).toHaveAttribute('data-fips', '23003')
    await expect(map.getByTestId('map-selection')).toContainText('Aroostook County, ME')
    await expect(map.getByTestId('map-highlight')).toBeAttached()
    await expect(map.getByTestId('map-frame')).toHaveCount(0) // the click did not start the time-lapse
  })

  test('the movers list selects a county and brings the panel into view', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    const mover = map.getByTestId('map-mover').first()
    const name = (await mover.locator('span').first().textContent())!.trim()
    await mover.click()
    await expect(map.getByTestId('map-selection')).toContainText(name)
    await expect(map.getByTestId('map-selection')).toBeInViewport()
  })

  test('Play runs the time-lapse and counties stay clickable while it plays', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    await map.getByTestId('map-play').click()
    await expect(map.getByTestId('map-frame')).toBeVisible({ timeout: 10000 })
    await clickCounty(page, '04013')
    await expect(map.getByTestId('map-selection')).toContainText('Maricopa County, AZ')
    await map.getByTestId('map-play').click() // stop
    await expect(map.getByTestId('map-frame')).toHaveCount(0)
  })

  test('"See everything that changed here" loads the clicked county', async ({ page }) => {
    await mockDataApi(page)
    await enterZip(page, '98683')
    const requested: string[] = []
    // Any zip outside the fixtures: serve a recorded snapshot re-pointed at that zip's county (Maricopa)
    await page.route('**/api/data/*', async route => {
      const zip = new URL(route.request().url()).pathname.split('/').pop()!
      requested.push(zip)
      const snap = loadFixture('98683') as { zip: string; rent: unknown; location: Record<string, string> }
      snap.zip = zip
      snap.rent = null
      snap.location = { ...snap.location, zip, countyFips: '04013', countyName: 'Maricopa County', stateAbbr: 'AZ', stateName: 'Arizona', cityName: 'Chandler' }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snap) })
    })
    const map = await mapReady(page)
    await clickCounty(page, '04013')
    await expect(map.getByTestId('map-selection')).toContainText('Maricopa County, AZ')
    await map.getByTestId('map-see-place').click()
    await expect(page.getByTestId('location-banner')).toContainText('Maricopa County', { timeout: 15000 })
    expect(requested).toEqual(['85225'])
    await expect(page).toHaveURL(/zip=85225/)
    // The map now treats Maricopa as the searched place
    await expect(map.getByTestId('map-selection')).toHaveAttribute('data-fips', '04013')
    await expect(map.getByTestId('map-see-place')).toHaveCount(0)
    // ... and the Housing graph loads Maricopa's Zillow series
    await expect(page.getByTestId('housing-chart').getByTestId('provenance').last()).toContainText('Maricopa County, AZ', { timeout: 15000 })
  })
})

/** Move the mouse over a county's center (a real hover: the browser hit-tests the point). */
async function hoverCounty(page: Page, fips: string) {
  const path = page.locator(`[data-testid="national-map"] svg path[data-fips="${fips}"]`)
  await path.scrollIntoViewIfNeeded()
  const box = (await path.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

/** The tooltip lies entirely inside the map box. */
async function expectTooltipInsideMap(page: Page) {
  const tip = (await page.getByTestId('map-tooltip').boundingBox())!
  const map = (await page.getByTestId('map-box').boundingBox())!
  expect(tip.x).toBeGreaterThanOrEqual(map.x - 0.5)
  expect(tip.y).toBeGreaterThanOrEqual(map.y - 0.5)
  expect(tip.x + tip.width).toBeLessThanOrEqual(map.x + map.width + 0.5)
  expect(tip.y + tip.height).toBeLessThanOrEqual(map.y + map.height + 0.5)
}

test.describe('County map: hover tooltips, keyboard browsing, metro rent', () => {
  test('hover shows county + state, the signed value and its geography/source; "No data" when missing; stays inside the map', async ({ page }) => {
    await mockMapMetrics(page)
    await page.goto('/')
    const map = await mapReady(page)
    await map.getByRole('button', { name: 'Electricity', exact: true }).click()
    // Aroostook ME: top-right corner, so the tooltip has to flip left/down to stay inside
    await hoverCounty(page, '23003')
    const tip = map.getByTestId('map-tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toHaveAttribute('data-fips', '23003')
    await expect(tip).toContainText('Aroostook County, ME')
    await expect(tip).toContainText(/Electricity [+−]?\d+\.\d%/)
    await expect(tip).toContainText('Maine statewide (EIA)')
    await expectTooltipInsideMap(page)
    // not in the fixture → "No data"
    await hoverCounty(page, '39035')
    await expect(tip).toContainText('Cuyahoga County, OH')
    await expect(tip).toContainText('Electricity: No data')
    // gas: $/gal with its sign, area and publisher
    await map.getByRole('button', { name: 'Gas', exact: true }).click()
    await hoverCounty(page, '23003')
    await expect(tip).toContainText(/Gas [+−]\$\d\.\d{2}\/gal/)
    await expect(tip).toContainText('(EIA)')
    // leaving the map hides it; hovering never selects a county
    await page.mouse.move(2, 2)
    await expect(tip).toHaveCount(0)
    await expect(map.getByTestId('map-selection')).toHaveCount(0)
  })

  test('keyboard: focusing the map shows a tooltip, arrow keys move between counties, Enter selects', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    const box = map.getByTestId('map-box')
    await box.focus()
    const tip = map.getByTestId('map-tooltip')
    await expect(tip).toBeVisible()
    const first = await tip.getAttribute('data-fips')
    await page.keyboard.press('ArrowRight')
    await expect(tip).not.toHaveAttribute('data-fips', first!)
    const second = (await tip.getAttribute('data-fips'))!
    await expect(map.getByTestId('map-kbd-status')).toContainText(/Home prices/)
    await page.keyboard.press('Enter')
    await expect(map.getByTestId('map-selection')).toHaveAttribute('data-fips', second)
    await expectTooltipInsideMap(page)
  })

  test('Rent layer: a county with no Zillow county series takes its metro rent, hatched and labeled', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    await map.getByRole('button', { name: 'Rent', exact: true }).click()
    // Park County, CO: no Zillow county rent; Denver metro stands in (as on the Rent card)
    const park = map.locator('svg path[data-fips="08093"]')
    await expect(park).toHaveAttribute('fill', /^rgb\(/)
    await expect(map.locator('[data-testid="map-metro-hatch"] path[data-metro-fips="08093"]')).toBeAttached()
    await expect(map.getByTestId('map-legend-metro')).toContainText('metro rent')
    await expect(map.getByTestId('map-source')).toContainText('light stripes = metro rent')
    await hoverCounty(page, '08093')
    const tip = map.getByTestId('map-tooltip')
    await expect(tip).toContainText('Park County, CO')
    await expect(tip).toContainText(/Rent [+−]?\d+\.\d%/)
    await expect(tip).toContainText('Denver-Aurora-Lakewood, CO metro rent')
    await clickCounty(page, '08093')
    await expect(map.getByTestId('map-value-rent')).toContainText('metro rent: Denver-Aurora-Lakewood, CO metro')
    // other layers: no metro hatch
    await map.getByRole('button', { name: 'Home prices', exact: true }).click()
    await expect(map.getByTestId('map-metro-hatch')).toHaveCount(0)
    await expect(map.getByTestId('map-legend-metro')).toHaveCount(0)
  })
})
