import { test, expect } from '@playwright/test'
import { mockDataApi, enterZip } from './helpers'

// The recorded snapshot fixtures predate `trace`; add the trace /api/data returns for 98683 (Vancouver WA).
const step = (rungId: string, label: string, status: string, extra: Record<string, unknown> = {}) => ({ rungId, label, source: 'src', status, ...extra })
const TRACE_98683 = {
  gas: [
    step('gas.eia-city', 'EIA weekly city average', 'not-applicable', { geography: { name: 'Clark County, WA', level: 'county' }, reason: "EIA publishes weekly city prices for 10 metro areas; Clark County isn't in one." }),
    step('gas.bls-metro', 'BLS monthly metro average', 'not-applicable', { geography: { name: 'Clark County, WA', level: 'county' }, reason: "BLS publishes monthly gas prices for 23 metro areas; Clark County isn't in one." }),
    step('gas.bls-hiak-standin', 'Honolulu / Anchorage price as a stand-in', 'not-applicable', { reason: 'Only used in Hawaii and Alaska outside the Honolulu and Anchorage metros.' }),
    step('gas.eia-state', 'EIA weekly state average', 'used', {
      source: 'EIA weekly retail gasoline (regular)', citationUrl: 'https://www.eia.gov/petroleum/gasdiesel/',
      geography: { name: 'Washington state', level: 'state' }, asOf: '2026-09-28', seriesId: 'EMM_EPMR_PTE_SWA_DPG',
    }),
    step('gas.eia-padd', 'EIA weekly regional (PADD) average', 'not-needed', { geography: { name: 'West Coast excl. California (PADD 5)', level: 'padd' } }),
    step('gas.eia-national', 'EIA weekly U.S. average', 'not-needed', { geography: { name: 'United States', level: 'national' } }),
  ],
  rent: [
    step('rent.zillow-county', 'Zillow county rent (new listings)', 'used', { geography: { name: 'Clark County, WA', level: 'county' }, asOf: '2026-08', citationUrl: 'https://www.zillow.com/research/data/' }),
    step('rent.bls-cpi-shelter', 'BLS shelter (CPI)', 'not-needed', { geography: { name: 'Pacific division', level: 'division' } }),
  ],
  groceries: [
    step('groceries.bls-cpi-metro', 'BLS CPI metro area', 'not-applicable', { reason: "BLS publishes its own CPI for 23 metro areas; Clark County isn't in one." }),
    step('groceries.bls-cpi-division', 'BLS CPI Census division', 'used', { geography: { name: 'Pacific division', level: 'division' }, asOf: '2026-08', seriesId: 'CUUR0490SAF11' }),
  ],
  shelter: [step('shelter.bls-cpi-division', 'BLS CPI Census division', 'used', { geography: { name: 'Pacific division', level: 'division' }, asOf: '2026-08' })],
  electricity: [step('electricity.eia-state', 'EIA statewide residential price', 'used', { geography: { name: 'Washington (statewide)', level: 'state' }, asOf: '2026-07' })],
}

test.describe('"Where does this come from?" traceback', () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApi(page, { override: (zip, snap) => (zip === '98683' ? { ...snap, trace: TRACE_98683 } : snap) })
  })

  test('card: inside the ⓘ panel, opens an inline step flow; Escape closes it', async ({ page }) => {
    await enterZip(page, '98683')
    const card = page.getByTestId('stat-card-gas')
    // Closed card faces stay short: the button lives in the ⓘ panel
    expect((await card.innerText()).replace(/\s+/g, ' ').trim().length).toBeLessThanOrEqual(120)
    await expect(card.getByTestId('source-trace-toggle')).toBeHidden()
    await card.getByTestId('stat-info-toggle').click()
    const toggle = card.getByTestId('source-trace-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const panel = card.getByTestId('source-trace-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toBeFocused()
    const steps = panel.getByTestId('source-trace-step')
    await expect(steps).toHaveCount(6)
    await expect(steps.nth(0)).toHaveAttribute('data-status', 'not-applicable')
    await expect(steps.nth(0)).toContainText("Clark County isn't in one")
    await expect(steps.nth(3)).toHaveAttribute('data-status', 'used')
    await expect(steps.nth(3)).toContainText('EIA weekly state average — Washington state')
    await expect(steps.nth(3)).toContainText('Used, week of Sep 28, 2026')
    await expect(steps.nth(0).getByRole('link')).toHaveCount(0)
    await expect(steps.nth(3).getByRole('link')).toHaveAttribute('href', 'https://www.eia.gov/petroleum/gasdiesel/')
    await expect(steps.nth(5)).toContainText('Not needed')
    // Every step fits the card (no horizontal overflow, also at 390px on the mobile project)
    const cardBox = (await card.boundingBox())!
    for (const s of await steps.all()) {
      const b = (await s.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
    }
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(toggle).toBeFocused()
    await expect(card.getByTestId('stat-info')).toBeVisible()
  })

  test('graph: the button under the gas graph opens the same steps', async ({ page }) => {
    await enterZip(page, '98683')
    const chart = page.getByTestId('chart-gas')
    await chart.scrollIntoViewIfNeeded()
    const toggle = chart.getByTestId('source-trace-toggle')
    await expect(toggle).toBeVisible({ timeout: 15000 })
    await expect(toggle).toHaveText(/Where does this come from\?/)
    await toggle.click()
    const panel = chart.getByTestId('source-trace-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('source-trace-step').nth(3)).toContainText('Washington state')
    // Housing graph: the Rent tab shows the rent ladder
    const housing = page.getByTestId('housing-chart')
    await housing.scrollIntoViewIfNeeded()
    await expect(housing).toHaveAttribute('data-tab', 'rent', { timeout: 15000 })
    await housing.getByTestId('source-trace-toggle').click()
    await expect(housing.getByTestId('source-trace-step').first()).toContainText('Zillow county rent (new listings) — Clark County, WA')
  })

  test('no trace in the payload (older responses): no button', async ({ page }) => {
    await enterZip(page, '10001')
    await page.getByTestId('stat-card-gas').getByTestId('stat-info-toggle').click()
    await expect(page.getByTestId('stat-card-gas').getByTestId('source-trace-toggle')).toHaveCount(0)
  })
})
