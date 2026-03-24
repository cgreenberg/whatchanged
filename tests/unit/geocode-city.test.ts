import { geocodeCityToZip } from '@/lib/city-search'

describe('geocodeCityToZip', () => {
  let mockFetch: jest.Mock

  beforeEach(() => {
    mockFetch = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('successful Census response → returns { display, zip, source: "census" }', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [
            {
              addressComponents: {
                zip: '83702',
                city: 'BOISE',
                state: 'ID',
              },
            },
          ],
        },
      }),
    })

    const result = await geocodeCityToZip('boise', 'id')
    expect(result).not.toBeNull()
    expect(result?.zip).toBe('83702')
    expect(result?.display).toBe('Boise, ID')
    expect(result?.source).toBe('census')
  })

  test('empty addressMatches → returns null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [],
        },
      }),
    })

    const result = await geocodeCityToZip('nonexistentcity')
    expect(result).toBeNull()
  })

  test('fetch throws → returns null (no throw)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await geocodeCityToZip('boise', 'id')
    expect(result).toBeNull()
  })

  test('fetch returns non-200 → returns null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const result = await geocodeCityToZip('boise', 'id')
    expect(result).toBeNull()
  })
})
