import type { EconomicSnapshot } from '@/types'

jest.mock('@/lib/api/snapshot', () => ({ fetchSnapshot: jest.fn() }))

import { generateMetadata } from '@/app/page'
import { fetchSnapshot } from '@/lib/api/snapshot'
import austin from '../fixtures/snapshots/78701.json'
import { blsGasData } from '../mocks/bls-gas-data'

const mockFetch = fetchSnapshot as jest.MockedFunction<typeof fetchSnapshot>
const snap = (): EconomicSnapshot => JSON.parse(JSON.stringify(austin))
const meta = (q: Record<string, string>) => generateMetadata({ searchParams: Promise.resolve(q) })
const GENERIC = 'What Changed in Your Town Since January 2025?'

beforeEach(() => jest.clearAllMocks())

test('invalid or missing zip → generic metadata without fetching', async () => {
  for (const zip of [undefined, 'abc', '1234', '123456']) {
    const m = await meta(zip ? { zip } : {})
    expect(m.title).toBe(GENERIC)
  }
  expect(mockFetch).not.toHaveBeenCalled()
})

test('unknown zip → generic title', async () => {
  mockFetch.mockResolvedValue(null)
  expect((await meta({ zip: '99999' })).title).toBe(GENERIC)
})

test('title and og:title name the place and the baseline date', async () => {
  mockFetch.mockResolvedValue(snap())
  const m = await meta({ zip: '78701' })
  expect(m.title).toBe('What Changed in Austin, TX (78701)?')
  expect(m.openGraph?.title).toBe('What changed in Austin, TX since Jan 20, 2025?')
})

test('description uses the same numbers as the cards, with a signed gas change', async () => {
  const s = snap()
  s.gas.data!.change = -0.12
  mockFetch.mockResolvedValue(s)
  const d = (await meta({ zip: '78701' })).openGraph?.description as string
  expect(d.startsWith('Since Jan 2025: ')).toBe(true)
  expect(d).toContain('Gas −$0.12/gal (Texas state avg)')
  expect(d).not.toContain('$-')
  expect(d).toContain('Rent −2.3% (Travis Co.)')
  expect(d).toContain('Groceries +3.1% (West South Central div.)')
  // Statewide EIA electricity, % change of the 12-month average price (Texas: +6.7% from the recorded fixture)
  expect(d).toContain('Electricity +6.7% (12-mo avg, Texas)')
  expect(d).not.toMatch(/tariff/i)
  expect(d.split(' · ').pop()).toBe('whatchanged.us')
})

test('every number in the description carries a geography tag; short enough for a social preview', async () => {
  mockFetch.mockResolvedValue(snap())
  const d = (await meta({ zip: '78701' })).openGraph?.description as string
  const parts = d.replace(/^Since [A-Z][a-z]{2} \d{4}: /, '').split(' · ').slice(0, -1)
  expect(parts.length).toBe(4)
  for (const p of parts) expect(p).toMatch(/\([^)]+\)$/)
  expect(d.length).toBeLessThanOrEqual(200)
})

test('flagged county rent → "†" on the number and an "unusual value" footnote', async () => {
  const s = snap()
  s.rent = { ...s.rent!, pct: 47.8, geoName: 'Taylor County, TX', flagged: true }
  mockFetch.mockResolvedValue(s)
  const d = (await meta({ zip: '78701' })).openGraph?.description as string
  expect(d).toContain('Rent +47.8%† (Taylor Co.)')
  expect(d).toContain('†unusual value')
})

test('national CPI fallback is tagged as such, not as local', async () => {
  const s = snap()
  s.rent = null
  s.cpi.data = { ...s.cpi.data!, fallback: 'national', tier: 4, metro: 'National' }
  mockFetch.mockResolvedValue(s)
  const d = (await meta({ zip: '78701' })).openGraph?.description as string
  expect(d).toContain('Groceries +3.1% (U.S. avg; local n/a)')
})

test('repeated query params (?city=a&city=b) use the first value instead of throwing', async () => {
  mockFetch.mockResolvedValue(snap())
  const m = await generateMetadata({
    searchParams: Promise.resolve({ zip: ['78701', '10001'], city: ['austin', 'x'], state: ['tx', 'ny'] }),
  })
  // The numbers come from the zip alone; city/state only name the place in the URL
  expect(mockFetch).toHaveBeenCalledWith('78701')
  expect(m.title).toBe('What Changed in Austin, TX (78701)?')
})

test('no county rent → description falls back to CPI shelter, clearly labeled', async () => {
  const s = snap()
  s.rent = null
  mockFetch.mockResolvedValue(s)
  const d = (await meta({ zip: '78701' })).openGraph?.description as string
  expect(d).toContain('Shelter CPI +2.3% (West South Central div.)')
  expect(d).not.toContain('Rent ')
})

test('missing sources are omitted, never shown as 0', async () => {
  const s = snap()
  s.cpi = { ...s.cpi, data: null }
  s.rent = null
  mockFetch.mockResolvedValue(s)
  const d = (await meta({ zip: '78701' })).openGraph?.description as string
  expect(d).not.toMatch(/Groceries|Shelter|0\.0%/)
})

test('city/state are kept in og:url and the OG image URL', async () => {
  mockFetch.mockResolvedValue(snap())
  const m = await meta({ zip: '78701', city: 'austin', state: 'tx' })
  expect(mockFetch).toHaveBeenCalledWith('78701')
  expect(m.openGraph?.url).toBe('https://whatchanged.us/?zip=78701&city=austin&state=tx')
  const img = (m.openGraph?.images as Array<{ url: string }>)[0].url
  expect(img).toMatch(/^\/api\/og\?zip=78701&city=austin&state=tx&v=\d{4}-\d{2}$/)
})

test('twitter card is summary_large_image with the same image', async () => {
  mockFetch.mockResolvedValue(snap())
  const m = await meta({ zip: '78701' })
  const tw = m.twitter as { card: string; images: string[] }
  expect(tw.card).toBe('summary_large_image')
  expect(tw.images[0]).toBe((m.openGraph?.images as Array<{ url: string }>)[0].url)
})

test('og:url and OG image echo city/state only when they are validated against the zip', async () => {
  mockFetch.mockResolvedValue(snap())
  const ok = await meta({ zip: '78701', city: 'Austin', state: 'TX' })
  expect(String(ok.openGraph?.url)).toContain('city=Austin')
  const bad = await meta({ zip: '78701', city: '<script>Evil town', state: 'ZZ' })
  expect(String(bad.openGraph?.url)).not.toContain('city=')
  expect(String(bad.openGraph?.url)).not.toContain('Evil')
  const img = (bad.openGraph?.images as Array<{ url: string }>)[0].url
  expect(img).not.toContain('Evil')
})

test('BLS gas tiers: og:description tags the BLS geography and month (Honolulu metro, Philadelphia metro)', async () => {
  const s = snap()
  s.location = { ...s.location, stateAbbr: 'HI', countyFips: '15003', countyName: 'Honolulu County' }
  s.gas.data = blsGasData('S49F')
  mockFetch.mockResolvedValue(s)
  const d = (await meta({ zip: '78701' })).openGraph?.description as string
  expect(d).toMatch(/^Since Jan 2025: Gas \+\$0\.99\/gal \(Honolulu metro, thru Aug '26\)/) // 5.402 − 4.413 (Aug 2026 vs Jan 2025)
  expect(d).not.toContain('no BLS or EIA gas series')
  const h = snap()
  h.location = { ...h.location, stateAbbr: 'HI', countyFips: '15009', countyName: 'Maui County' }
  h.gas.data = blsGasData('S49F', { standIn: true })
  mockFetch.mockResolvedValue(h)
  const hd = (await meta({ zip: '78701' })).openGraph?.description as string
  expect(hd).toContain("Gas +$0.99/gal (Honolulu-area price*, thru Aug '26)")
  expect(hd).toContain('* no BLS or EIA gas series for Maui Co. — local prices are typically higher and may have changed differently')
  const p = snap()
  p.location = { ...p.location, stateAbbr: 'PA' }
  p.gas.data = blsGasData('S12B')
  mockFetch.mockResolvedValue(p)
  expect((await meta({ zip: '78701' })).openGraph?.description).toContain("Gas +$0.95/gal (Philadelphia metro, thru Aug '26)")
})
