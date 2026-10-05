import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip } from './helpers'

test.describe('Charts section', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page)
    await enterZip(page, '98683')
    await expect(page.getByTestId('charts-section')).toBeVisible({ timeout: 10000 })
  })

  test('four price charts (gas, groceries, housing, electricity), each with a provenance line; no unemployment or CPI energy', async ({ page }) => {
    for (const id of ['gas', 'cpi-groceries', 'housing-rent', 'electricity']) {
      const chart = page.getByTestId(`chart-${id}`)
      await expect(chart).toBeVisible()
      const line = chart.getByTestId('provenance').last()
      await expect(line).toBeVisible()
      expect(((await line.textContent()) ?? '').split(' · ').length).toBeGreaterThanOrEqual(5)
    }
    await expect(page.getByTestId('chart-unemployment')).toHaveCount(0)
    await expect(page.getByTestId('chart-cpi-energy')).toHaveCount(0)
    await expect(page.getByText(/unemployment/i)).toHaveCount(0)
  })

  test('2 × 2 grid on desktop (Gas | Groceries, Housing | Electricity); one column at phone width', async ({ page }) => {
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!
    await page.setViewportSize({ width: 1280, height: 900 })
    let [gas, groc, housing, energy] = await Promise.all(['chart-gas', 'chart-cpi-groceries', 'housing-chart', 'chart-electricity'].map(box))
    expect(Math.abs(gas.y - groc.y)).toBeLessThan(2)
    expect(groc.x).toBeGreaterThan(gas.x + gas.width - 1)
    expect(Math.abs(housing.y - energy.y)).toBeLessThan(2)
    expect(housing.y).toBeGreaterThan(gas.y + gas.height - 1)
    expect(energy.x).toBeGreaterThan(housing.x + housing.width - 1)
    await page.setViewportSize({ width: 390, height: 844 })
    ;[gas, groc, housing, energy] = await Promise.all(['chart-gas', 'chart-cpi-groceries', 'housing-chart', 'chart-electricity'].map(box))
    expect(groc.y).toBeGreaterThan(gas.y + gas.height - 1)
    expect(housing.y).toBeGreaterThan(groc.y + groc.height - 1)
    expect(energy.y).toBeGreaterThan(housing.y + housing.height - 1)
    expect(Math.abs(gas.x - energy.x)).toBeLessThan(2)
  })

  test('"Jan 2025" is the default view and CPI charts say what the % is relative to', async ({ page }) => {
    await expect(page.getByTestId('timeframe-Jan 2025').first()).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('chart-cpi-groceries').getByTestId('chart-window')).toHaveText('% change since Jan 2025')
  })

  test('switching to 3Y re-bases the % label', async ({ page }) => {
    const chart = page.getByTestId('chart-cpi-groceries')
    await chart.getByTestId('timeframe-3Y').click()
    await expect(chart.getByTestId('timeframe-3Y')).toHaveAttribute('aria-pressed', 'true')
    await expect(chart.getByTestId('chart-window')).not.toHaveText('% change since Jan 2025')
    await expect(chart.getByTestId('chart-window')).toHaveText(/^% change since \w{3} \d{4}$/)
  })

  test('Housing graph: Rent | Home prices | Shelter (CPI) tabs, Rent by default with the Rent card %', async ({ page }) => {
    const housing = page.getByTestId('housing-chart')
    await expect(housing).toHaveAttribute('data-tab', 'rent', { timeout: 15000 })
    const card = (await page.getByTestId('stat-card-rent').getByTestId('stat-value').textContent())?.trim()
    await expect(housing.getByTestId('housing-headline-pct')).toHaveText(card!)
    await expect(housing.getByTestId('provenance').last()).toContainText('Zillow ZORI · Clark County, WA, monthly')

    await housing.getByTestId('housing-tab-homePrices').click()
    await expect(housing).toHaveAttribute('data-tab', 'homePrices')
    await expect(housing.getByTestId('provenance').last()).toContainText('Zillow Home Value Index (ZHVI)')
    await expect(housing.getByTestId('chart-note')).toContainText('smoothed and seasonally adjusted')
    // the long explanation sits in the graph's ⓘ disclosure
    await expect(housing.getByTestId('chart-info')).toBeHidden()
    await housing.getByTestId('chart-info-toggle').click()
    await expect(housing.getByTestId('chart-info')).toContainText("Zillow's smoothed, seasonally adjusted")
    await expect(housing.getByTestId('chart-info')).toContainText('trails new-lease rents by about a year')

    await housing.getByTestId('housing-tab-shelter').click()
    await expect(housing).toHaveAttribute('data-tab', 'shelter')
    await expect(housing.getByTestId('provenance').last()).toContainText('BLS CPI shelter')
    await expect(housing.getByTestId('chart-note')).toContainText('trails new-lease rents by about a year')
  })

  test('Electricity graph: statewide ¢/kWh, headline = the card %, 12-month average + monthly lines, U.S. line', async ({ page }) => {
    const chart = page.getByTestId('chart-electricity')
    const cardSecondary = (await page.getByTestId('stat-card-electricity').getByTestId('stat-secondary').textContent())!
    const pct = (await chart.getByTestId('chart-headline-pct').textContent())!.trim()
    expect(cardSecondary.startsWith(`${pct} vs yr centered on Jan '25`)).toBe(true)
    await expect(chart.getByTestId('chart-headline-window')).toHaveText('latest 12-month average vs the 12 months centered on Jan 2025')
    // both lines carry their latest value at the right edge
    await expect(chart.getByTestId('end-label-local')).toBeVisible()
    await expect(chart.getByTestId('end-label-local-1')).toBeVisible()
    await expect(chart.getByTestId('provenance').last()).toContainText('EIA average residential electricity price · Washington (statewide), monthly')
    await expect(chart.getByTestId('chart-note')).toHaveText('Statewide average for Washington.')
    await expect(chart.locator('.recharts-legend-item')).toHaveCount(2)
    await chart.getByLabel('Show national').check()
    await expect(chart.getByTestId('provenance').last()).toContainText('dashed: U.S. avg, EIA')
    // only the U.S. 12-month average line is added
    await expect(chart.locator('.recharts-legend-item')).toHaveCount(3)
    await chart.getByTestId('chart-info-toggle').click()
    await expect(chart.getByTestId('chart-info')).toContainText('Why 12-month averages')
  })

  test('Housing graph Rent tab: 10Y view and the U.S. comparison line', async ({ page }) => {
    const housing = page.getByTestId('housing-chart')
    await expect(housing).toHaveAttribute('data-tab', 'rent', { timeout: 15000 })
    await housing.getByTestId('timeframe-10Y').click()
    await expect(housing.getByTestId('chart-window')).toHaveText(/^% change since \w{3} 201\d$/)
    const line = housing.getByTestId('provenance').last()
    await expect(line).not.toContainText('dashed')
    await housing.getByLabel('Show national').check()
    await expect(line).toContainText('dashed: U.S. ZORI')
  })
})

test.describe('Charts section — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('"Jan 2025" timeframe button stays on one line at 390px', async ({ page }) => {
    await mockDataApi(page)
    await enterZip(page, '98683')
    const btn = page.getByTestId('chart-cpi-groceries').getByTestId('timeframe-Jan 2025')
    await expect(btn).toBeVisible({ timeout: 10000 })
    const other = page.getByTestId('chart-cpi-groceries').getByTestId('timeframe-3Y')
    const [a, b] = [await btn.boundingBox(), await other.boundingBox()]
    expect(a!.height).toBeLessThanOrEqual(b!.height + 1)
  })
})
