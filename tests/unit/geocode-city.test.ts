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

  test('successful local API response → returns first result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { display: 'Boise, ID', zip: '83702', source: 'local' },
      ]),
    })

    const result = await geocodeCityToZip('boise', 'id')
    expect(result).not.toBeNull()
    expect(result?.zip).toBe('83702')
    expect(result?.display).toBe('Boise, ID')
    expect(result?.source).toBe('local')

    // Verify it calls the local API endpoint
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/city-search')
    expect(calledUrl).toContain('q=')
  })

  test('empty results array → returns null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([]),
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
