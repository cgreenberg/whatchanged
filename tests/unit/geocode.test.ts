import { reverseGeocodeToZip } from '@/lib/geocode'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

describe('reverseGeocodeToZip', () => {
  test('successful response returns zip string', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ zip: '98683' }),
    }) as jest.Mock
    global.fetch = mockFetch

    const result = await reverseGeocodeToZip(45.6387, -122.6615)
    expect(result).toBe('98683')

    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/geocode?lat=45.6387&lng=-122.6615')
  })

  test('null zip in response returns null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ zip: null }),
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
