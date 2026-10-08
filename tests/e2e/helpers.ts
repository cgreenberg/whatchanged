import fs from 'fs'
import path from 'path'
import { expect, type Page } from '@playwright/test'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'snapshots')

/** Recorded API snapshots (tests/fixtures/snapshots/{zip}.json): no live BLS/EIA calls from e2e. */
export function loadFixture(zip: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${zip}.json`), 'utf8'))
}

export const FIXTURE_ZIPS = fs.readdirSync(FIXTURES).map(f => f.replace('.json', ''))

/** Serve /api/data/{zip} from fixtures (404 for others); optional per-zip overrides and delay. */
export async function mockDataApi(
  page: Page,
  opts: { override?: (zip: string, snap: Record<string, unknown>) => Record<string, unknown>; delayMs?: number } = {}
) {
  await page.route('**/api/data/*', async route => {
    const zip = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs))
    if (!FIXTURE_ZIPS.includes(zip)) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Zip code not found' }) })
    }
    const snap = loadFixture(zip)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.override ? opts.override(zip, snap) : snap),
    })
  })
}

/** Load the landing page (no ?zip= so the server never fetches live data) and submit a zip. */
export async function enterZip(page: Page, zip: string) {
  await page.goto('/')
  await page.getByTestId('zip-input').fill(zip)
  await page.getByRole('button', { name: /See What Changed/i }).click()
  await expect(page.getByTestId('stat-cards')).toBeVisible({ timeout: 15000 })
}

/**
 * Serve /api/map-metrics from tests/fixtures/map-metrics.json (built from recorded data: electricity for
 * 11 states, gas and groceries for the snapshot-fixture areas, on the round-16 common gas window (Jan 2025 → Aug 2026
 * monthly averages); the bundled Alaska DCRA survey and Puerto Rico DACO areas; everything else "no data").
 */
export async function mockMapMetrics(page: Page) {
  const body = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'map-metrics.json'), 'utf8')
  await page.route('**/api/map-metrics', route => route.fulfill({ status: 200, contentType: 'application/json', body }))
}
