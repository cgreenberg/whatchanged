import { searchCitiesStatic } from '@/lib/data/city-zip-lookup'
import { parseQuery } from '@/lib/city-search'

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
