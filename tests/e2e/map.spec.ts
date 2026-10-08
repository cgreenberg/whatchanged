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
    // Electricity: a whole recorded state is colored; a state not in the fixture is solid gray (no data)
    await map.getByRole('button', { name: 'Electricity', exact: true }).click()
    const fill = (fips: string) => map.locator(`svg path[data-fips="${fips}"]`).getAttribute('fill')
    expect(await fill('23003')).toMatch(/^rgb\(/) // Aroostook ME
    expect(await fill('23005')).toBe(await fill('23003')) // same state, same color
    expect(await fill('39035')).toBe('#5f6268') // Cuyahoga OH: not in the fixture → NO_DATA_COLOR (quiet solid gray)
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
    await expect(sel.getByTestId('map-value-gas')).toContainText('/gal, Jan 2025 → ')
    await expect(sel.getByTestId('map-value-gas')).toContainText('Washington state average (EIA)')
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

  test('Rent time-lapse says it plays Zillow county series only (other counties go gray)', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    await map.getByRole('button', { name: 'Rent', exact: true }).click()
    await map.getByTestId('map-play').click()
    await expect(map.getByTestId('map-timelapse-note')).toHaveText('Time-lapse shows Zillow county series only', { timeout: 10000 })
    await expect(map.getByTestId('map-legend-nodata')).toContainText('no Zillow county series (time-lapse)')
    await map.getByTestId('map-play').click() // stop
    await expect(map.getByTestId('map-timelapse-note')).toHaveCount(0)
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
    await expect(tip).toContainText('New England region average · shared across 5 states (EIA PADD 1A)')
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

  test('Rent layer: city rent (dots); counties with no usable Zillow rent are gray, HUD only on hover / tap', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    await map.getByRole('button', { name: 'Rent', exact: true }).click()
    // Georgetown County, SC: no usable Zillow county or metro series → Murrells Inlet area rent (Zillow city series), dotted
    await expect(map.locator('svg path[data-fips="45043"]')).toHaveAttribute('fill', /^rgb\(/)
    await expect(map.locator('[data-testid="map-city-dots"] path[data-city-fips="45043"]')).toBeAttached()
    await expect(map.getByTestId('map-legend-city')).toContainText('city rent')
    await hoverCounty(page, '45043')
    await expect(map.getByTestId('map-tooltip')).toContainText('Murrells Inlet area rent (Zillow city series; no usable county or metro series)')
    // Sibley County, MN: no usable Zillow rent → the no-data gray; HUD's estimate only in the tooltip / panel
    await expect(map.locator('svg path[data-fips="27143"]')).toHaveAttribute('fill', '#5f6268')
    await expect(map.getByTestId('map-legend-hud')).toHaveCount(0)
    await expect(map.getByTestId('map-legend-nodata')).toContainText('no actual-rent data (hover for HUD estimate where available)')
    await hoverCounty(page, '27143')
    await expect(map.getByTestId('map-tooltip')).toContainText('No usable Zillow rent here')
    await expect(map.getByTestId('map-tooltip')).toContainText(/HUD Fair Market Rent estimate: [+−]?\d+\.\d% \(not actual rents\)/)
    await clickCounty(page, '27143')
    await expect(map.getByTestId('map-value-rent')).toContainText('No usable Zillow rent here · HUD Fair Market Rent estimate')
    await expect(map.getByTestId('map-value-rent')).toContainText('an estimate, not actual rents')
    // other layers: no rent tiers
    await map.getByRole('button', { name: 'Home prices', exact: true }).click()
    await expect(map.getByTestId('map-city-dots')).toHaveCount(0)
    await expect(map.getByTestId('map-legend-nodata')).toContainText('no data')
  })
})

/**
 * A screen point that really hits the county (bounding-box centers of irregular counties land in a neighbor): the grid
 * point closest to the box center where the browser's hit test returns that county's path.
 */
async function pointInCounty(page: Page, fips: string): Promise<{ x: number; y: number }> {
  const path = page.locator(`[data-testid="national-map"] svg path[data-fips="${fips}"]`)
  await path.scrollIntoViewIfNeeded()
  const p = await path.evaluate((el, f) => {
    const r = el.getBoundingClientRect()
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2
    let best: { x: number; y: number; d: number } | null = null
    for (let i = 1; i < 12; i++) {
      for (let j = 1; j < 12; j++) {
        const x = r.x + (r.width * i) / 12
        const y = r.y + (r.height * j) / 12
        if (document.elementFromPoint(x, y)?.getAttribute('data-fips') !== f) continue
        const d = (x - cx) ** 2 + (y - cy) ** 2
        if (!best || d < best.d) best = { x, y, d }
      }
    }
    return best
  }, fips)
  if (!p) throw new Error(`no hit-testable point in county ${fips}`)
  return p
}

test.describe('Round 16: like-for-like gas layer, legend wording, click / tap focus', () => {
  test('gas layer: one monthly-average window, "brighter = rose more", falls in their own color, survey + stand-in patterns', async ({ page }) => {
    await mockMapMetrics(page)
    await page.goto('/')
    const map = await mapReady(page)
    await map.getByRole('button', { name: 'Gas', exact: true }).click()
    await expect(map.getByTestId('map-legend-title')).toContainText('Jan 2025 → Aug 2026 monthly averages, so areas compare fairly')
    // North Slope AK fell $0.10 (DCRA survey): never "every county rose", and drawn in the distinct "fell" color
    await expect(map.getByTestId('map-legend-claim')).toHaveText(' · nearly every county rose; brighter = rose more')
    await expect(map.getByTestId('map-legend-opposite')).toContainText('fell (below $0)')
    // North Slope's small fall: blue, shaded by size (a dim blue, not the full end color used for big falls)
    const fill = (await map.locator('svg path[data-fips="02185"]').getAttribute('fill'))!
    const [r, , b] = fill.match(/\d+/g)!.map(Number)
    expect(b).toBeGreaterThan(r + 30)
    expect(fill).not.toBe('rgb(74,144,217)')
    // Alaska survey boroughs: grid pattern + chip; HI/AK counties with no series: stripes + chip
    await expect(map.locator('[data-testid="map-gas-own-window"] path[data-own-fips="02185"]')).toBeAttached()
    await expect(map.getByTestId('map-legend-gas-own')).toContainText('Alaska survey, Jan 2025 → Jul 2026 surveys (different window)')
    await expect(map.locator('[data-testid="map-gas-standin-hatch"] path[data-standin-fips="15001"]')).toBeAttached()
    await expect(map.getByTestId('map-legend-gas-standin')).toContainText('nearest metro')
    await expect(map.getByTestId('map-source')).toContainText('Jan 2025 → Aug 2026 monthly averages (EIA weeklies averaged by month)')
    // the tooltip always says the window
    const tip = map.getByTestId('map-tooltip')
    { const p = await pointInCounty(page, '13121'); await page.mouse.move(p.x, p.y) }
    await expect(tip).toHaveAttribute('data-fips', '13121')
    await expect(map.getByTestId('map-tooltip-when')).toHaveText('Jan 2025 → Aug 2026 monthly averages')
    { const p = await pointInCounty(page, '02185'); await page.mouse.move(p.x, p.y) }
    await expect(tip).toHaveAttribute('data-fips', '02185')
    await expect(map.getByTestId('map-tooltip-when')).toContainText('Jan 2025 → Jul 2026 surveys')
    // electricity: its own window in the legend title
    await map.getByRole('button', { name: 'Electricity', exact: true }).click()
    await expect(map.getByTestId('map-legend-title')).toContainText("12-mo avg to")
    await expect(map.getByTestId('map-legend-title')).toContainText("vs yr centered on Jan '25")
    await expect(map.getByTestId('map-legend-claim')).toHaveCount(0)
  })

  test('rent movers: a county with a seasonal-pattern caveat carries †', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    await map.getByRole('button', { name: 'Rent', exact: true }).click()
    const ny = map.getByTestId('map-mover').filter({ hasText: 'New York County, NY' })
    await expect(ny).toBeVisible()
    await expect(ny.getByTestId('map-mover-seasonal')).toHaveText('†')
    await expect(map.getByText('† Seasonal pattern uncertain', { exact: false })).toBeVisible()
  })

  test('mouse click on a county: the tooltip and outline follow the clicked county, no keyboard tooltip', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    { const p = await pointInCounty(page, '08031'); await page.mouse.click(p.x, p.y) } // Denver: the map box takes focus from the click
    await expect(map.getByTestId('map-selection')).toHaveAttribute('data-fips', '08031')
    const tip = map.getByTestId('map-tooltip')
    await expect(tip).toHaveAttribute('data-fips', '08031')
    await expect(map.getByTestId('map-hover-outline')).toHaveCount(0) // the hovered county is the selected one
    await expect(map.getByTestId('map-kbd-status')).toHaveText('')
    // moving the mouse away leaves no tooltip behind (the click's focus never started keyboard browsing)
    await page.mouse.move(2, 2)
    await expect(tip).toHaveCount(0)
    await expect(map.getByTestId('map-hover-outline')).toHaveCount(0)
    { const p = await pointInCounty(page, '13121'); await page.mouse.click(p.x, p.y) }
    await expect(map.getByTestId('map-selection')).toHaveAttribute('data-fips', '13121')
    await expect(tip).toHaveAttribute('data-fips', '13121')
    await expect(map.getByTestId('map-kbd-status')).toHaveText('')
    // keyboard browsing still starts on the first arrow key, at the selected county's neighbor
    await page.keyboard.press('ArrowRight')
    await page.mouse.move(2, 2)
    await expect(map.getByTestId('map-kbd-status')).not.toHaveText('')
  })
})

test.describe('Round 16: touch tap', () => {
  test.use({ hasTouch: true })
  test('tap on a county: selection, highlight and any tooltip match the tapped county; no stray keyboard tooltip', async ({ page }) => {
    await page.goto('/')
    const map = await mapReady(page)
    // Counties large enough on a phone-width map that the browser's touch adjustment can't snap to a neighbor
    for (const fips of ['06071', '32023']) { // San Bernardino CA, Nye NV
      const p = await pointInCounty(page, fips)
      await page.touchscreen.tap(p.x, p.y)
      await expect(map.getByTestId('map-selection')).toHaveAttribute('data-fips', fips)
      await expect(map.getByTestId('map-highlight')).toBeAttached()
      const tips = map.getByTestId('map-tooltip')
      if (await tips.count()) await expect(tips).toHaveAttribute('data-fips', fips)
      await expect(map.getByTestId('map-hover-outline')).toHaveCount(0)
      await expect(map.getByTestId('map-kbd-status')).toHaveText('')
    }
  })
})

test.describe('Gas layer: the published areas behind the colors', () => {
  test('area outlines instead of county lines, city outlines + dots, striped regional averages, 3-row key', async ({ page }) => {
    await mockMapMetrics(page)
    await page.goto('/')
    const map = await mapReady(page)
    await map.getByRole('button', { name: 'Gas', exact: true }).click()
    await expect(map.getByTestId('map-gas-area-borders')).toBeAttached()
    // no county lines: each county is stroked in its own fill
    const cook = map.locator('svg path[data-fips="17031"]')
    expect(await cook.getAttribute('stroke')).toBe(await cook.getAttribute('fill'))
    // city areas: bright outline + a dot on the principal county (Cook County for Chicago; Fulton for Atlanta)
    await expect(map.locator('[data-testid="map-gas-city-outlines"] path[data-gas-area="e:YORD"]')).toBeAttached()
    await expect(map.locator('[data-testid="map-gas-city-dots"] circle[data-gas-area="e:YORD"]')).toHaveAttribute('data-fips', '17031')
    await expect(map.locator('[data-testid="map-gas-city-dots"] circle[data-gas-area="b:S35C"]')).toHaveAttribute('data-fips', '13121')
    // regional averages striped (Midwest PADD 2); state averages and stand-ins are not
    await expect(map.locator('[data-testid="map-gas-region-stripes"] path[data-gas-area="e:R20"]')).toBeAttached()
    await expect(map.locator('[data-testid="map-gas-region-stripes"] path[data-gas-area="e:STX"]')).toHaveCount(0)
    // key
    await expect(map.getByTestId('map-legend-gas-city')).toHaveText('City price')
    await expect(map.getByTestId('map-legend-gas-state')).toHaveText('State average')
    await expect(map.getByTestId('map-legend-gas-region')).toHaveText('Regional average (several states share one number)')
    await expect(map.getByTestId('map-legend-gas-areas')).toContainText(/Gas prices are published for \d+ areas/)
    await expect(map.getByTestId('map-legend-gas-areas')).toContainText('not by county')
    // hovering the dot behaves like its county; tooltip names the kind
    const dot = map.locator('[data-testid="map-gas-city-dots"] circle[data-gas-area="b:S35C"]')
    const b = (await dot.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    const tip = map.getByTestId('map-tooltip')
    await expect(tip).toHaveAttribute('data-fips', '13121')
    await expect(tip).toContainText('Atlanta-Sandy Springs-Roswell metro price (BLS)')
    // hovering a regional county rings its whole area
    { const p = await pointInCounty(page, '23003'); await page.mouse.move(p.x, p.y) }
    await expect(tip).toContainText('New England region average')
    const ring = (await map.getByTestId('map-hover-outline').getAttribute('d'))!
    expect(ring.length).toBeGreaterThan((await map.locator('svg path[data-fips="23003"]').getAttribute('d'))!.length)
    // tapping / clicking the dot selects its county; the panel names the kind
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await expect(map.getByTestId('map-selection')).toHaveAttribute('data-fips', '13121')
    await expect(map.getByTestId('map-value-gas')).toContainText('Atlanta-Sandy Springs-Roswell metro price (BLS)')
    // other layers: none of it, county lines back
    await map.getByRole('button', { name: 'Groceries', exact: true }).click()
    for (const id of ['map-gas-area-borders', 'map-gas-city-dots', 'map-gas-region-stripes', 'map-legend-gas-kinds']) {
      await expect(map.getByTestId(id)).toHaveCount(0)
    }
    await expect(cook).toHaveAttribute('stroke', '#111316')
  })
})
