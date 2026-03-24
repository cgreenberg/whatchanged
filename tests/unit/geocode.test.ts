import { reverseGeocodeToZip } from '@/lib/geocode'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

describe('reverseGeocodeToZip', () => {
  test('successful response with 2020 ZCTA returns zip string', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          geographies: {
            '2020 Census ZIP Code Tabulation Areas': [{ ZCTA5: '98683' }],
          },
        },
      }),
    }) as jest.Mock
    global.fetch = mockFetch

    const result = await reverseGeocodeToZip(45.6387, -122.6615)
    expect(result).toBe('98683')

    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('layers=2020%20Census%20ZIP%20Code%20Tabulation%20Areas%2C2010%20Census%20ZIP%20Code%20Tabulation%20Areas')
  })

  test('falls back to 2010 ZCTA when 2020 is absent', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          geographies: {
            '2020 Census ZIP Code Tabulation Areas': [],
            '2010 Census ZIP Code Tabulation Areas': [{ ZCTA5CE10: '10001' }],
          },
        },
      }),
    }) as jest.Mock

    const result = await reverseGeocodeToZip(40.7484, -73.9967)
    expect(result).toBe('10001')
  })

  test('empty geographies object returns null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          geographies: {},
        },
      }),
    }) as jest.Mock

    const result = await reverseGeocodeToZip(0, 0)
    expect(result).toBeNull()
  })

  test('fetch throws network error returns null and does not throw', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as jest.Mock

    await expect(reverseGeocodeToZip(45.0, -122.0)).resolves.toBeNull()
  })

  test('fetch returns non-200 status returns null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as jest.Mock

    const result = await reverseGeocodeToZip(45.0, -122.0)
    expect(result).toBeNull()
  })
})
