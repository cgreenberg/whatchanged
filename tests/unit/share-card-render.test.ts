/**
 * @jest-environment node
 */
// Renders the share card and OG image from a fixture snapshot (no live API calls).
import fs from 'fs'
import type { EconomicSnapshot } from '@/types'
import austin from '../fixtures/snapshots/78701.json'
import { blsGasData } from '../mocks/bls-gas-data'

jest.mock('@/lib/api/snapshot', () => ({ fetchSnapshot: jest.fn() }))
jest.mock('@/lib/share-card/fonts', () => ({ loadShareFonts: async () => [] }))
// ImageResponse needs --experimental-vm-modules under Jest; capture the tree + headers instead.
// (Set REAL_OG=1 with NODE_OPTIONS=--experimental-vm-modules to render actual PNGs.)
const mockRendered: unknown[] = []
jest.mock('next/og', () => process.env.REAL_OG ? jest.requireActual('next/og') : ({
  ImageResponse: class extends Response {
    constructor(el: unknown, opts: { headers?: Record<string, string> } = {}) {
      mockRendered.push(el)
      const body = new Uint8Array(2048)
      body.set([0x89, 0x50, 0x4e, 0x47])
      super(body, { headers: { 'content-type': 'image/png', ...(opts.headers ?? {}) } })
    }
  },
}))

/** All text in a React element tree. */
function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  const props = (node as { props?: { children?: unknown } }).props
  return props ? textOf(props.children) : ''
}
jest.mock('@/lib/api/national', () => ({ getCachedNationalData: jest.fn() }))

import { fetchSnapshot } from '@/lib/api/snapshot'
import { generateShareCard, SHARE_CACHE_OK, SHARE_CACHE_DEGRADED } from '@/lib/share-card/generate'
import { buildHeroCards, dataThroughLabel } from '@/lib/hero-cards'

const mockFetch = fetchSnapshot as jest.MockedFunction<typeof fetchSnapshot>
const snap = (): EconomicSnapshot => JSON.parse(JSON.stringify(austin))

async function png(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer())
  if (process.env.SHARE_CARD_OUT) fs.writeFileSync(process.env.SHARE_CARD_OUT, buf)
  return buf
}

test('share card renders a PNG with long cache when every source is present', async () => {
  mockFetch.mockResolvedValue(snap())
  const res = await generateShareCard('78701')
  expect(res.headers.get('content-type')).toContain('image/png')
  expect(res.headers.get('cache-control')).toBe(SHARE_CACHE_OK)
  const buf = await png(res)
  expect(buf.subarray(1, 4).toString()).toBe('PNG')
  if (!process.env.REAL_OG) {
    const t = textOf(mockRendered[mockRendered.length - 1])
    const s = snap()
    expect(t).toContain('RENT')
    expect(t).toContain(`${s.rent!.monthlyChange < 0 ? '−' : '+'}$${Math.abs(s.rent!.monthlyChange)}/mo`)
    // badge = span of the cards' latest data months (here Aug CPI/rent → Sep weekly gas), never today
    expect(t).toContain(`↓ ${dataThroughLabel(buildHeroCards(s))}`)
    expect(t).toContain('↓ AUG–SEP 2026')
    expect(t).not.toContain('$-')
  }
}, 30000)

test('share card uses a short cache when a source is missing or stale', async () => {
  const s = snap()
  s.gas.stale = true
  mockFetch.mockResolvedValue(s)
  expect((await generateShareCard('78701')).headers.get('cache-control')).toBe(SHARE_CACHE_DEGRADED)
  const s2 = snap()
  s2.cpi = { ...s2.cpi, data: null }
  s2.rent = null
  mockFetch.mockResolvedValue(s2)
  const res = await generateShareCard('78701')
  expect(res.headers.get('cache-control')).toBe(SHARE_CACHE_DEGRADED)
  expect((await png(res)).length).toBeGreaterThan(1000)
}, 30000)

test('unknown zip → 404', async () => {
  mockFetch.mockResolvedValue(null)
  expect((await generateShareCard('99999')).status).toBe(404)
})

test('OG image is built only from the zip snapshot and ignores free-text params', async () => {
  mockFetch.mockResolvedValue(snap())
  const { GET } = await import('@/app/api/og/route')
  const { NextRequest } = await import('next/server')
  const res = await GET(new NextRequest('http://x/api/og?zip=78701&location=HACKED&groceries=999%25'))
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toMatch(/s-maxage=\d+/)
  expect(mockFetch).toHaveBeenCalledWith('78701', undefined, undefined)
  if (!process.env.REAL_OG) {
    const t = textOf(mockRendered[mockRendered.length - 1])
    expect(t).not.toContain('HACKED')
    expect(t).not.toContain('999%')
    expect(t).toContain('AUSTIN, TX')
  }
  if (process.env.OG_OUT) fs.writeFileSync(process.env.OG_OUT, Buffer.from(await res.arrayBuffer()))
}, 30000)

test('share card names gas geography, CPI geography type and each metric\'s actual baseline month', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.rent = null // show the CPI shelter cell
  s.cpi.data!.groceriesBaselinePeriod = '2024-12'
  s.cpi.data!.shelterBaselinePeriod = '2024-12'
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toContain(s.gas.data!.geoLevel!)
  expect(t).toContain('since Jan 20, 2025')
  expect(t).toContain('CPI: West South Central (Census division)')
  expect(t.match(/since Dec 2024/g)?.length).toBe(2)
  expect(t).not.toContain('CPI source:')
}, 30000)

test('share card rent cell: dated asking-rent level and seasonally adjusted change', async () => {
  if (process.env.REAL_OG) return
  mockFetch.mockResolvedValue(snap())
  await generateShareCard('78701')
  const t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toMatch(/Asking rent: \$[\d,]+\/mo \(Aug '26\)/)
  expect(t).toContain('seasonally adj.')
}, 30000)

test('OG zip card shows gas geography and the rent adjustment', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  mockFetch.mockResolvedValue(s)
  const { GET } = await import('@/app/api/og/route')
  const { NextRequest } = await import('next/server')
  await GET(new NextRequest('http://x/api/og?zip=78701'))
  const t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toContain(s.gas.data!.geoLevel!)
  expect(t).toContain('seas. adj.')
  // every number carries a short geography line
  expect(t).toContain('Travis Co.')
  expect(t).toContain('West South Central div.')
  expect(t).toContain('zip income')
  expect(t).not.toContain('†')
}, 30000)

test('OG + share card: flagged county rent gets "†" and an unusual-value footnote', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.rent = { ...s.rent!, pct: 47.8, geoName: 'Taylor County, TX', flagged: true }
  mockFetch.mockResolvedValue(s)
  const { GET } = await import('@/app/api/og/route')
  const { NextRequest } = await import('next/server')
  await GET(new NextRequest('http://x/api/og?zip=78701'))
  const og = textOf(mockRendered[mockRendered.length - 1])
  expect(og).toContain('+47.8%†')
  expect(og).toContain('† unusual value')
  await generateShareCard('78701')
  const share = textOf(mockRendered[mockRendered.length - 1])
  expect(share).toContain('+47.8%†')
  expect(share).toContain('Unusual value')
}, 30000)

test('OG + share card: BLS monthly gas tier (Honolulu metro) — geography, as-of month, source-tagged national', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.location = { ...s.location, stateAbbr: 'HI', countyFips: '15003', countyName: 'Honolulu County' }
  s.gas.data = blsGasData('S49F')
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const share = textOf(mockRendered[mockRendered.length - 1])
  expect(share).toContain("Honolulu metro · thru Aug '26")
  expect(share).toContain('$5.40/gal')
  expect(share).toContain('+$0.99 since Jan 2025') // monthly: Jan 2025, not Jan 20
  expect(share).toContain("Natl (BLS Aug '26): +$0.99") // BLS U.S. avg 4.200 − 3.211, same months
  expect(share).not.toContain('Urban Hawaii')
  expect(share).not.toContain('No gas series')
  const { GET } = await import('@/app/api/og/route')
  const { NextRequest } = await import('next/server')
  await GET(new NextRequest('http://x/api/og?zip=78701'))
  const og = textOf(mockRendered[mockRendered.length - 1])
  expect(og).toContain('Honolulu metro')
  expect(og).toContain("since Jan 2025, thru Aug '26")
  expect(og).not.toContain('no BLS or EIA gas series')
}, 30000)

test('OG + share card: HI stand-in outside the Honolulu CBSA is marked * with a footnote', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.location = { ...s.location, stateAbbr: 'HI', countyFips: '15001', countyName: 'Hawaii County', cityName: 'Hilo' }
  s.gas.data = blsGasData('S49F', { standIn: true })
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const share = textOf(mockRendered[mockRendered.length - 1])
  expect(share).toContain("Honolulu-area price* · thru Aug '26")
  expect(share).toContain('* No gas series for Hawaii Co. (Big Island); local prices typically higher.')
  const { GET } = await import('@/app/api/og/route')
  const { NextRequest } = await import('next/server')
  await GET(new NextRequest('http://x/api/og?zip=78701'))
  const og = textOf(mockRendered[mockRendered.length - 1])
  expect(og).toContain('Honolulu-area price*')
  expect(og).toContain('* no BLS or EIA gas series for Hawaii Co. (Big Island); local prices are typically higher')
}, 30000)

test('share card: EIA national is tagged EIA', async () => {
  if (process.env.REAL_OG) return
  mockFetch.mockResolvedValue(snap())
  await generateShareCard('78701')
  expect(textOf(mockRendered[mockRendered.length - 1])).toMatch(/Natl \(EIA [A-Z][a-z]{2} \d{1,2}\): [+−-]\$\d\.\d{2}/)
}, 30000)

test('share card tariff names where the income comes from; national CPI fallback is labeled', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.census.data = { ...s.census.data!, incomeGeo: 'county', source: 'acs' }
  s.rent = null
  s.cpi.data = { ...s.cpi.data!, fallback: 'national', tier: 4, metro: 'National' }
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toMatch(/based on median income of\s+\$\d+k\s*\(county\)/)
  expect(t).toContain('CPI: national (local data unavailable)')
  // national CPI is never applied to local rent
  expect(t).not.toMatch(/\+\$754\/yr/)
}, 30000)

test('share routes cap city/state length before using them', async () => {
  jest.resetModules()
  const gen = jest.fn(async () => new Response('ok'))
  jest.doMock('@/lib/share-card/generate', () => ({ generateShareCard: gen }))
  const long = 'x'.repeat(5000)
  const share = await import('@/app/api/share/[zip]/route')
  await share.GET(new Request(`http://x/api/share/78701?city=${long}&state=TXXX`), { params: Promise.resolve({ zip: '78701' }) })
  const card = await import('@/app/api/card-image/route')
  await card.GET(new Request(`http://x/api/card-image?zip=78701&city=${long}&state=TXXX`))
  for (const call of gen.mock.calls as unknown as Array<[string, string, string]>) {
    expect(call[1].length).toBe(100)
    expect(call[2]).toBe('TX')
  }
  expect(gen).toHaveBeenCalledTimes(2)
})
