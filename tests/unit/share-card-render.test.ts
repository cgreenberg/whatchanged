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
import { buildHeroCards, buildGasCard } from '@/lib/hero-cards'
import { latestDataLabel, shortSourceDate } from '@/lib/share-card/labels'

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
    // header: Jan 20, 2025 → the newest data month shown (here Sep weekly gas; never the month the image is made),
    // then the span of the cards' latest data months (Jul electricity, Aug CPI/rent → Sep weekly gas)
    expect(t).toContain('JAN 20, 2025')
    expect(t).toContain('SEP 2026')
    expect(t).not.toContain('OCT 2026')
    expect(t).toContain(latestDataLabel(buildHeroCards(s))!)
    expect(t).toContain("latest data Jul–Sep '26")
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
  expect(mockFetch).toHaveBeenCalledWith('78701')
  if (!process.env.REAL_OG) {
    const t = textOf(mockRendered[mockRendered.length - 1])
    expect(t).not.toContain('HACKED')
    expect(t).not.toContain('999%')
    expect(t).toContain('AUSTIN, TX')
  }
  if (process.env.OG_OUT) fs.writeFileSync(process.env.OG_OUT, Buffer.from(await res.arrayBuffer()))
}, 30000)

test('share card source lines name each quadrant\'s geography, source and month; charts start at the actual baseline month', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.rent = null // show the CPI shelter cell
  const dates = s.cpi.data!.series.map((p) => p.date)
  expect(dates).toContain('2024-12')
  s.cpi.data!.groceriesBaselinePeriod = '2024-12'
  s.cpi.data!.shelterBaselinePeriod = '2024-12'
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toContain(shortSourceDate(buildGasCard(s).sourceLine))
  expect(t).toContain("West South Central div. · BLS · Aug '26")
  expect(t).toContain('SHELTER (CPI)')
  expect(t).not.toContain('CPI:')
}, 30000)

test('share card shelter cell: $/yr in rent from the BLS rent index on local rent; none without the index', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.rent = null
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  let t = textOf(mockRendered[mockRendered.length - 1])
  const rent = s.census.data!.medianRent
  const expected = Math.round((rent * 12 * s.cpi.data!.rentIndexChange!) / 100)
  expect(s.dollarImpact!.shelter).toBe(expected)
  expect(t).toContain(`≈ +$${expected.toLocaleString('en-US')}/yr`)
  // the basis lives in the site's ⓘ; a plain (not top/bottom-coded) rent needs no qualifier
  expect(t).not.toContain('in rent')
  // no rent index (older cached CPI) → no dollar pill, even if a stale old-method figure is present
  const old = snap()
  old.rent = null
  delete old.cpi.data!.rentIndexChange
  mockFetch.mockResolvedValue(old)
  await generateShareCard('78701')
  t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).not.toContain(`≈ +$${expected.toLocaleString('en-US')}/yr`)
}, 30000)

test('share card rent cell: seasonally adjusted change, $/mo pill and a Zillow source line', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toContain('RENT')
  expect(t).toContain(`≈ ${s.rent!.monthlyChange < 0 ? '−' : '+'}$${Math.abs(s.rent!.monthlyChange)}/mo`)
  expect(t).toContain("Travis Co. · Zillow · Aug '26")
  expect(t).not.toContain('Asking rent')
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
  // electricity: the seasonally adjusted % with its statewide geography
  expect(t).toContain('ELECTRICITY')
  expect(t).toContain(`${s.electricity.data!.change > 0 ? '+' : ''}${s.electricity.data!.change.toFixed(1)}%`)
  expect(t).toContain('Texas (statewide)')
  expect(t).toContain('RENT (NEW LISTINGS)')
  // header ends at the newest data month shown (Sep weekly gas), each stat names its own month
  expect(t).toContain('SEP 2026')
  expect(t).not.toContain('OCT 2026')
  expect(t).toContain("latest Sep '26")
  expect(t).toContain("latest Aug '26")
  expect(t).toContain("latest Jul '26")
  expect(t).not.toMatch(/tariff|income/i)
  expect(t).not.toContain('†')
}, 30000)

test('OG link preview: a rent seasonal-pattern caveat gets "†" and its footnote (‡ beside an outlier †)', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.rent = { ...s.rent!, pct: 12.6, saCaveat: { gap: 2.7, month: 8 } }
  mockFetch.mockResolvedValue(s)
  const { GET } = await import('@/app/api/og/route')
  const { NextRequest } = await import('next/server')
  await GET(new NextRequest('http://x/api/og?zip=78701'))
  let og = textOf(mockRendered[mockRendered.length - 1])
  expect(og).toContain('+12.6%†')
  expect(og).toMatch(/† Seasonal pattern uncertain: Aug rent may be ~2\.7 pts too high \(~\$\d+\/mo\); own pattern \+9\.9%\./)
  expect(og).not.toContain('≈') // no glyph in the OG font
  s.rent = { ...s.rent!, pct: 47.8, flagged: true, saCaveat: { gap: 2.7, month: 8 } }
  await GET(new NextRequest('http://x/api/og?zip=78701'))
  og = textOf(mockRendered[mockRendered.length - 1])
  expect(og).toContain('+47.8%†‡')
  expect(og).toContain('‡ Seasonal pattern uncertain')
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
  expect(share).toMatch(/\+47\.8%\s*†/)
  expect(share).toContain('† Unusual rent value')
}, 30000)

test('OG + share card: BLS monthly gas tier (Honolulu metro) — geography, as-of month, source-tagged national', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.location = { ...s.location, stateAbbr: 'HI', countyFips: '15003', countyName: 'Honolulu County' }
  s.gas.data = blsGasData('S49F')
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const share = textOf(mockRendered[mockRendered.length - 1])
  expect(share).toContain("Honolulu metro · BLS · Aug '26")
  expect(share).toMatch(/\+\$0\.99\s*\/gal/) // change first, like the card
  expect(share).toContain('$5.40') // a monthly average says its month (pill's second line), never "now"
  expect(share).toContain('Aug avg')
  expect(share).not.toContain('now $5.40')
  expect(share).toContain("Jan '25") // monthly chart starts at the Jan 2025 baseline month
  expect(share).not.toContain('Natl') // national comparisons live on the site
  expect(share).not.toContain('Urban Hawaii')
  expect(share).not.toContain('No gas series')
  const { GET } = await import('@/app/api/og/route')
  const { NextRequest } = await import('next/server')
  await GET(new NextRequest('http://x/api/og?zip=78701'))
  const og = textOf(mockRendered[mockRendered.length - 1])
  expect(og).toContain('Honolulu metro')
  expect(og).toContain('since Jan 2025')
  expect(og).toContain("latest Aug '26")
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
  expect(share).toContain("Honolulu-area* · BLS · Aug '26")
  expect(share).toContain('* No gas series for Hawaii Co. (Big Island) — local prices often higher; trend may differ.')
  const { GET } = await import('@/app/api/og/route')
  const { NextRequest } = await import('next/server')
  await GET(new NextRequest('http://x/api/og?zip=78701'))
  const og = textOf(mockRendered[mockRendered.length - 1])
  expect(og).toContain('Honolulu-area price*')
  expect(og).toContain('* no BLS or EIA gas series for Hawaii Co. (Big Island) — local prices are typically higher and may have changed differently')
}, 30000)

test('share card: weekly EIA gas — change first, "now" price, month-level source date', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toContain(`now $${s.gas.data!.current.toFixed(2)}`)
  expect(t).toMatch(/· EIA · [A-Z][a-z]{2} '\d{2}/)
  expect(t).not.toContain('Natl')
}, 30000)

test('share card: national CPI fallback is labeled and never applied to local rent', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.rent = null
  s.cpi.data = { ...s.cpi.data!, fallback: 'national', tier: 4, metro: 'National' }
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toContain('U.S. avg (local n/a) · BLS')
  // national CPI is never applied to local rent
  expect(t).not.toMatch(/\+\$754\/yr/)
}, 30000)

test('share card + OG: no "≈ $/mo" rent pill when the seasonal caveat leaves the direction uncertain', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  // Collier FL-like: −1.5%, own pattern +0.7% (sign flips) → no signed $ anywhere
  s.rent = { ...s.rent!, pct: -1.5, monthlyChange: -39, saCaveat: { gap: -2.2, month: 8 } }
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  let t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toContain('−1.5%')
  expect(t).not.toMatch(/≈ [+−-]\$39\/mo/)
  expect(t).toContain('own pattern +0.7%, direction uncertain')
  const { GET } = await import('@/app/api/og/route')
  const { NextRequest } = await import('next/server')
  await GET(new NextRequest('http://x/api/og?zip=78701'))
  const og = textOf(mockRendered[mockRendered.length - 1])
  expect(og).toContain('−1.5%†')
  expect(og).not.toMatch(/[+−-]\$39\/mo/)
  // Blue Earth MN-like: +6.3%, own +14.7% (same sign) → the pill stays
  s.rent = { ...s.rent!, pct: 6.3, monthlyChange: 64, saCaveat: { gap: -8.4, month: 8 } }
  await generateShareCard('78701')
  t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toContain('≈ +$64/mo')
  expect(t).not.toContain('direction uncertain')
}, 30000)

test('share card + OG header with no dated card: "SINCE JAN 20, 2025", never "→ LATEST"', async () => {
  if (process.env.REAL_OG) return
  const s = snap()
  s.gas = { ...s.gas, data: null }
  s.cpi = { ...s.cpi, data: null }
  s.rent = null
  s.electricity = { ...s.electricity, data: null }
  mockFetch.mockResolvedValue(s)
  await generateShareCard('78701')
  const t = textOf(mockRendered[mockRendered.length - 1])
  expect(t).toContain('SINCE JAN 20, 2025')
  expect(t).not.toContain('LATEST')
}, 30000)


test('share routes ignore free-text city/state: the image comes from the zip alone', async () => {
  jest.resetModules()
  const gen = jest.fn(async () => new Response('ok'))
  jest.doMock('@/lib/share-card/generate', () => ({ generateShareCard: gen }))
  const long = 'x'.repeat(5000)
  const share = await import('@/app/api/share/[zip]/route')
  await share.GET(new Request(`http://x/api/share/78701?city=${long}&state=TXXX`), { params: Promise.resolve({ zip: '78701' }) })
  const card = await import('@/app/api/card-image/route')
  await card.GET(new Request(`http://x/api/card-image?zip=78701&city=${long}&state=TXXX`))
  expect(gen.mock.calls).toEqual([['78701'], ['78701']])
  expect(gen).toHaveBeenCalledTimes(2)
})
