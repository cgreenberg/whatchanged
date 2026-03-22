// Tests for the OG URL building logic extracted from ShareButton.tsx
// buildOgUrl is not exported, so we test its behavior by replicating
// the logic and verifying the URL structure with known snapshot shapes.
import type { EconomicSnapshot } from '@/types'

// Replicate the buildOgUrl function exactly as written in ShareButton.tsx
function buildOgUrl(snapshot: EconomicSnapshot): string {
  const params = new URLSearchParams()
  params.set('zip', snapshot.zip)
  params.set(
    'location',
    `${snapshot.location.cityName || snapshot.location.countyName}, ${snapshot.location.stateAbbr}`
  )

  if (snapshot.unemployment.data) {
    params.set('unemployment', `${snapshot.unemployment.data.current}%`)
    params.set(
      'unemploymentChange',
      `${snapshot.unemployment.data.change > 0 ? '+' : ''}${snapshot.unemployment.data.change} pts`
    )
  }
  if (snapshot.cpi.data) {
    params.set('groceries', `${snapshot.cpi.data.groceriesChange.toFixed(1)}%`)
  }
  if (snapshot.federal.data) {
    const millions = (snapshot.federal.data.amountCut / 1_000_000).toFixed(1)
    params.set('federal', `$${millions}M`)
  }

  return `/api/og?${params.toString()}`
}

// Factory to make a minimal valid EconomicSnapshot
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

describe('buildOgUrl — URL structure', () => {
  test('URL starts with /api/og', () => {
    const url = buildOgUrl(makeSnapshot())
    expect(url).toMatch(/^\/api\/og\?/)
  })

  test('includes zip param', () => {
    const url = buildOgUrl(makeSnapshot())
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('zip')).toBe('98683')
  })

  test('uses cityName when available in location param', () => {
    const url = buildOgUrl(makeSnapshot())
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('location')).toBe('Vancouver, WA')
  })

  test('falls back to countyName when cityName is empty', () => {
    const snapshot = makeSnapshot()
    snapshot.location.cityName = ''
    const url = buildOgUrl(snapshot)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('location')).toBe('Clark County, WA')
  })

  test('includes unemployment and unemploymentChange when data is present', () => {
    const url = buildOgUrl(makeSnapshot())
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('unemployment')).toBe('5%')
    expect(params.get('unemploymentChange')).toBe('+0.9 pts')
  })

  test('omits unemployment params when unemployment.data is null', () => {
    const snapshot = makeSnapshot()
    snapshot.unemployment = {
      data: null,
      error: 'No data',
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'bls',
    }
    const url = buildOgUrl(snapshot)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('unemployment')).toBeNull()
    expect(params.get('unemploymentChange')).toBeNull()
  })

  test('unemployment change shows + sign when positive', () => {
    const url = buildOgUrl(makeSnapshot())
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('unemploymentChange')).toContain('+')
  })

  test('unemployment change shows no + sign when negative', () => {
    const snapshot = makeSnapshot()
    snapshot.unemployment.data!.change = -0.5
    const url = buildOgUrl(snapshot)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('unemploymentChange')).toBe('-0.5 pts')
  })

  test('includes groceries change when CPI data is present', () => {
    const url = buildOgUrl(makeSnapshot())
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('groceries')).toBe('1.1%')
  })

  test('omits groceries param when cpi.data is null', () => {
    const snapshot = makeSnapshot()
    snapshot.cpi = {
      data: null,
      error: 'No CPI data',
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'bls-cpi',
    }
    const url = buildOgUrl(snapshot)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('groceries')).toBeNull()
  })

  test('includes federal cut formatted in millions', () => {
    const url = buildOgUrl(makeSnapshot())
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('federal')).toBe('$4.2M')
  })

  test('omits federal param when federal.data is null', () => {
    const snapshot = makeSnapshot()
    snapshot.federal = {
      data: null,
      error: 'API error',
      fetchedAt: '2025-03-01T00:00:00.000Z',
      sourceId: 'usaspending',
    }
    const url = buildOgUrl(snapshot)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('federal')).toBeNull()
  })

  test('federal amount 0 is formatted as $0.0M', () => {
    const snapshot = makeSnapshot()
    snapshot.federal.data!.amountCut = 0
    const url = buildOgUrl(snapshot)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('federal')).toBe('$0.0M')
  })

  test('large federal amount is formatted correctly', () => {
    const snapshot = makeSnapshot()
    snapshot.federal.data!.amountCut = 42_500_000
    const url = buildOgUrl(snapshot)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('federal')).toBe('$42.5M')
  })

  test('groceries change is always formatted with 1 decimal place', () => {
    const snapshot = makeSnapshot()
    snapshot.cpi.data!.groceriesChange = 2
    const url = buildOgUrl(snapshot)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('groceries')).toBe('2.0%')
  })

  test('all params are present when all data is available', () => {
    const url = buildOgUrl(makeSnapshot())
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('zip')).toBeTruthy()
    expect(params.get('location')).toBeTruthy()
    expect(params.get('unemployment')).toBeTruthy()
    expect(params.get('unemploymentChange')).toBeTruthy()
    expect(params.get('groceries')).toBeTruthy()
    expect(params.get('federal')).toBeTruthy()
  })
})
