import { searchCitiesStatic } from '@/lib/data/city-zip-lookup'
import { parseQuery, mergeCityResults } from '@/lib/city-search'

describe('searchCitiesStatic', () => {
  test('searchCitiesStatic("new") returns New York first', () => {
    const results = searchCitiesStatic('new')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].display).toBe('New York, NY')
  })

  test('searchCitiesStatic("austin") returns Austin TX', () => {
    const results = searchCitiesStatic('austin')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].zip).toBe('78701')
    expect(results[0].display).toBe('Austin, TX')
  })

  test('searchCitiesStatic("sea") returns Seattle', () => {
    const results = searchCitiesStatic('sea')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].display).toBe('Seattle, WA')
  })

  test('searchCitiesStatic("x") returns empty (too short)', () => {
    const results = searchCitiesStatic('x')
    expect(results).toHaveLength(0)
  })

  test('searchCitiesStatic("SEATTLE") returns Seattle (case-insensitive)', () => {
    const results = searchCitiesStatic('SEATTLE')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].display).toBe('Seattle, WA')
  })
})

describe('parseQuery', () => {
  test('parseQuery("boise id") → { city: "boise", state: "id" }', () => {
    expect(parseQuery('boise id')).toEqual({ city: 'boise', state: 'id' })
  })

  test('parseQuery("boise, idaho") → { city: "boise", state: "id" } (STATE_NAMES map)', () => {
    expect(parseQuery('boise, idaho')).toEqual({ city: 'boise', state: 'id' })
  })

  test('parseQuery("new york ny") → { city: "new york", state: "ny" }', () => {
    expect(parseQuery('new york ny')).toEqual({ city: 'new york', state: 'ny' })
  })

  test('parseQuery("chicago") → { city: "chicago", state: undefined }', () => {
    expect(parseQuery('chicago')).toEqual({ city: 'chicago', state: undefined })
  })

  test('parseQuery("portland oregon") → { city: "portland", state: "or" }', () => {
    expect(parseQuery('portland oregon')).toEqual({ city: 'portland', state: 'or' })
  })
})

describe('static city suggestions are real zips', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zips = require('@/lib/data/zip-county.json') as Record<string, { stateAbbr: string; zcta?: false }>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CITY_ZIP_LOOKUP } = require('@/lib/data/city-zip-lookup') as typeof import('@/lib/data/city-zip-lookup')

  test.each(CITY_ZIP_LOOKUP.map(c => [c.display, c.zip, c.state]))(
    '%s → %s exists in zip-county.json, in the right state, with Census data',
    (_display, zip, state) => {
      const entry = zips[zip]
      expect(entry).toBeDefined()
      expect(entry.stateAbbr.toLowerCase()).toBe(state)
      expect(entry.zcta).not.toBe(false)
    }
  )
})

describe('parseQuery — names and territories', () => {
  test('a two-word city that is also a state name is not eaten as a state', () => {
    expect(parseQuery('new york')).toEqual({ city: 'new york' })
    expect(parseQuery('new york new york')).toEqual({ city: 'new york', state: 'ny' })
  })

  test('territory abbreviations and names', () => {
    expect(parseQuery('san juan pr')).toEqual({ city: 'san juan', state: 'pr' })
    expect(parseQuery('charlotte amalie vi')).toEqual({ city: 'charlotte amalie', state: 'vi' })
    expect(parseQuery('hagatna guam')).toEqual({ city: 'hagatna', state: 'gu' })
    expect(parseQuery('saipan northern mariana islands')).toEqual({ city: 'saipan', state: 'mp' })
  })
})

describe('mergeCityResults', () => {
  test('keeps order, drops duplicates by display or zip', () => {
    const merged = mergeCityResults(
      [{ display: 'Portland, OR', zip: '97201', source: 'static' }],
      [
        { display: 'Portland, ME', zip: '04101', source: 'local' },
        { display: 'Portland, OR', zip: '97086', source: 'local' },
        { display: 'Other', zip: '97201', source: 'local' },
      ]
    )
    expect(merged.map(r => r.display)).toEqual(['Portland, OR', 'Portland, ME'])
  })
})

describe('/api/city-search lists every state for common city names', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require('@/app/api/city-search/route') as typeof import('@/app/api/city-search/route')
  const search = async (q: string) => {
    const req = { nextUrl: new URL(`http://localhost/api/city-search?q=${encodeURIComponent(q)}`) }
    const res = await GET(req as never)
    return (await res.json()) as Array<{ display: string; zip: string }>
  }

  test.each([
    ['portland', ['Portland, ME', 'Portland, OR']],
    ['columbus', ['Columbus, OH', 'Columbus, GA', 'Columbus, IN']],
    ['kansas city', ['Kansas City, MO', 'Kansas City, KS']],
    ['jacksonville', ['Jacksonville, FL', 'Jacksonville, NC']],
  ])('%s', async (q, expected) => {
    const displays = (await search(q)).map(r => r.display)
    for (const d of expected) expect(displays).toContain(d)
  })

  test('state filter by abbreviation and territory', async () => {
    expect((await search('portland me')).map(r => r.display)).toEqual(['Portland, ME'])
    expect((await search('san juan pr')).map(r => r.display)).toContain('San Juan, PR')
  })
})
