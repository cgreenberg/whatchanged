import type { EconomicSnapshot } from '@/types'

// Mock @/lib/api/snapshot before importing the page module
jest.mock('@/lib/api/snapshot', () => ({
  fetchSnapshot: jest.fn(),
}))

import { generateMetadata } from '@/app/page'
import { fetchSnapshot } from '@/lib/api/snapshot'

const mockFetchSnapshot = fetchSnapshot as jest.MockedFunction<typeof fetchSnapshot>

// Factory for a minimal valid EconomicSnapshot — mirrors share-url.test.ts
function makeSnapshot(overrides: Partial<EconomicSnapshot> = {}): EconomicSnapshot {
  const base: EconomicSnapshot = {
    zip: '98683',
    fetchedAt: '2025-03-01T00:00:00.000Z',
    location: {
      zip: '98683',
      countyFips: '53011',
      countyName: 'Clark County',
      stateName: 'Washington',
      stateAbbr: 'WA',
      cityName: 'Vancouver',
    },
    unemployment: {
      data: {
        current: 5.0,
        baseline: 4.1,
        change: 0.9,
        series: [],
        countyFips: '53011',
        seriesId: 'LAUCN530110000000003',
      },
      error: null,
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'bls',
    },
    cpi: {
      data: {
        groceriesCurrent: 311.456,
        groceriesBaseline: 308.123,
        groceriesChange: 1.1,
        shelterChange: 0.8,
        series: [],
        metro: 'Portland-Vancouver-Hillsboro',
      },
      error: null,
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'bls-cpi',
    },
    gas: {
      data: {
        current: 3.752,
        baseline: 3.489,
        change: 0.263,
        region: 'Pacific',
        series: [],
      },
      error: null,
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'eia',
    },
    federal: {
      data: {
        amountCut: 4200000,
        contractsCut: 3,
        grantsCut: 0,
        countyFips: '53011',
      },
      error: null,
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'usaspending',
    },
    census: {
      data: {
        medianIncome: 83821,
        medianRent: 1450,
        zip: '98683',
        year: 2023,
      },
      error: null,
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'census',
    },
    ...overrides,
  }
  return base
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('generateMetadata — no zip or invalid zip', () => {
  test('no zip → returns generic title', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(meta.title).toBe('What Changed in Your Town Since January 2025?')
  })

  test('invalid zip (letters) → returns generic title', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: 'abc' }) })
    expect(meta.title).toBe('What Changed in Your Town Since January 2025?')
  })

  test('invalid zip (4 digits) → returns generic title', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '1234' }) })
    expect(meta.title).toBe('What Changed in Your Town Since January 2025?')
  })

  test('invalid zip (6 digits) → returns generic title', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '123456' }) })
    expect(meta.title).toBe('What Changed in Your Town Since January 2025?')
  })

  test('no zip → fetchSnapshot is never called', async () => {
    await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(mockFetchSnapshot).not.toHaveBeenCalled()
  })

  test('invalid zip → fetchSnapshot is never called', async () => {
    await generateMetadata({ searchParams: Promise.resolve({ zip: 'abc' }) })
    expect(mockFetchSnapshot).not.toHaveBeenCalled()
  })
})

describe('generateMetadata — valid zip, snapshot not found', () => {
  beforeEach(() => {
    mockFetchSnapshot.mockResolvedValue(null)
  })

  test('snapshot returns null → returns generic title', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    expect(meta.title).toBe('What Changed in Your Town Since January 2025?')
  })

  test('snapshot returns null → returns generic description', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    expect(meta.description).toBe('Enter your zip code. See what changed.')
  })
})

describe('generateMetadata — valid zip with snapshot', () => {
  beforeEach(() => {
    mockFetchSnapshot.mockResolvedValue(makeSnapshot())
  })

  test('title includes city name and zip', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    expect(meta.title).toContain('Vancouver, WA')
    expect(meta.title).toContain('98683')
  })

  test('title ends with a question mark', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    expect(meta.title as string).toMatch(/\?$/)
  })

  test('og:title includes "Since January 2025?"', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const ogTitle = (meta.openGraph as { title?: string })?.title
    expect(ogTitle).toContain('Since January 2025?')
  })

  test('description includes tariff impact part', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).toContain('Tariff impact:')
    expect(desc).toContain('/yr')
  })

  test('description includes groceries part', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).toContain('Groceries:')
    expect(desc).toContain('+1.1%')
  })

  test('description includes shelter part', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).toContain('Shelter:')
    expect(desc).toContain('+0.8%')
  })

  test('description includes federal funding cut part', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).toContain('federal funding cut')
    expect(desc).toContain('$4M')
  })

  test('description parts are joined with " · "', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    // Each adjacent pair of segments must be separated by " · "
    expect(desc).toContain(' · ')
  })

  test('og:image URL is /api/og?zip=98683', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const images = (meta.openGraph as { images?: Array<{ url: string }> })?.images
    expect(images?.[0]?.url).toBe('/api/og?zip=98683')
  })

  test('og:url is https://whatchanged.us/?zip=98683', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const url = (meta.openGraph as { url?: string })?.url
    expect(url).toBe('https://whatchanged.us/?zip=98683')
  })

  test('twitter card is "summary_large_image"', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    expect((meta.twitter as { card?: string })?.card).toBe('summary_large_image')
  })
})

describe('generateMetadata — description with missing data', () => {
  test('no census data → description omits tariff part', async () => {
    const snapshot = makeSnapshot()
    snapshot.census = {
      data: null,
      error: 'No census data',
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'census',
    }
    mockFetchSnapshot.mockResolvedValue(snapshot)

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).not.toContain('Tariff')
  })

  test('no CPI data → description omits groceries and shelter parts', async () => {
    const snapshot = makeSnapshot()
    snapshot.cpi = {
      data: null,
      error: 'No CPI data',
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'bls-cpi',
    }
    mockFetchSnapshot.mockResolvedValue(snapshot)

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).not.toContain('Groceries:')
    expect(desc).not.toContain('Shelter:')
  })

  test('no federal data → description omits federal cut part', async () => {
    const snapshot = makeSnapshot()
    snapshot.federal = {
      data: null,
      error: 'API error',
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'usaspending',
    }
    mockFetchSnapshot.mockResolvedValue(snapshot)

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).not.toContain('federal funding cut')
  })

  test('CPI data present but shelterChange undefined → description omits shelter part', async () => {
    const snapshot = makeSnapshot()
    // shelterChange is present in default; set to undefined via type cast
    snapshot.cpi.data = {
      ...snapshot.cpi.data!,
      shelterChange: undefined as unknown as number,
    }
    mockFetchSnapshot.mockResolvedValue(snapshot)

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).not.toContain('Shelter:')
  })
})

describe('generateMetadata — federal amount formatting', () => {
  test('federal amount >= 1B → formatted as "$X.XB"', async () => {
    const snapshot = makeSnapshot()
    snapshot.federal.data!.amountCut = 1_500_000_000
    mockFetchSnapshot.mockResolvedValue(snapshot)

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).toContain('$1.5B')
    expect(desc).not.toContain('M')
  })

  test('federal amount < 1B → formatted as "$XM" not "$X.XB"', async () => {
    const snapshot = makeSnapshot()
    snapshot.federal.data!.amountCut = 42_000_000
    mockFetchSnapshot.mockResolvedValue(snapshot)

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).toContain('$42M')
    expect(desc).not.toContain('B')
  })

  test('federal amount exactly 1B → formatted as "$1.0B"', async () => {
    const snapshot = makeSnapshot()
    snapshot.federal.data!.amountCut = 1_000_000_000
    mockFetchSnapshot.mockResolvedValue(snapshot)

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const desc = (meta.openGraph as { description?: string })?.description ?? ''
    expect(desc).toContain('$1.0B')
  })
})

describe('generateMetadata — city name fallback', () => {
  test('falls back to countyName when cityName is empty string', async () => {
    const snapshot = makeSnapshot()
    snapshot.location.cityName = ''
    mockFetchSnapshot.mockResolvedValue(snapshot)

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    expect(meta.title as string).toContain('Clark County')
    expect(meta.title as string).not.toContain('Vancouver')
  })

  test('falls back to countyName when cityName is undefined', async () => {
    const snapshot = makeSnapshot()
    snapshot.location.cityName = undefined as unknown as string
    mockFetchSnapshot.mockResolvedValue(snapshot)

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    expect(meta.title as string).toContain('Clark County')
  })

  test('uses cityName in og:title when cityName is set', async () => {
    mockFetchSnapshot.mockResolvedValue(makeSnapshot())

    const meta = await generateMetadata({ searchParams: Promise.resolve({ zip: '98683' }) })
    const ogTitle = (meta.openGraph as { title?: string })?.title
    expect(ogTitle).toContain('Vancouver')
  })
})
