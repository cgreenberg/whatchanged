import { test, expect } from '@playwright/test'

test.describe('Share card image accuracy', () => {
  test('API data endpoint returns valid JSON for test zip', async ({ request }) => {
    const response = await request.get('/api/data/98683')
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(json).toBeTruthy()
    // Verify key data fields exist
    expect(json.gas).toBeTruthy()
    expect(json.cpi).toBeTruthy()
    expect(json.census).toBeTruthy()
    expect(json.location).toBeTruthy()
  })

  test('card-image endpoint returns valid PNG for test zip', async ({ request }) => {
    const response = await request.get('/api/card-image?zip=98683')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
    const body = await response.body()
    expect(body.length).toBeGreaterThan(5000)
  })

  test('OG image endpoint returns valid PNG for test zip', async ({ request }) => {
    const response = await request.get('/api/og?zip=98683')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
    const body = await response.body()
    expect(body.length).toBeGreaterThan(5000)
  })

  test('card-image endpoint rejects invalid zip', async ({ request }) => {
    const response = await request.get('/api/card-image?zip=abcde')
    expect(response.status()).toBe(400)
  })

  test('card-image endpoint rejects missing zip', async ({ request }) => {
    const response = await request.get('/api/card-image?zip=')
    expect(response.status()).toBe(400)
  })

  test('both image endpoints return substantial content (not error stubs)', async ({
    request,
  }) => {
    const [cardRes, ogRes] = await Promise.all([
      request.get('/api/card-image?zip=98683'),
      request.get('/api/og?zip=98683'),
    ])

    const cardBody = await cardRes.body()
    const ogBody = await ogRes.body()

    // Real PNGs with charts/text should be well over 10KB
    expect(cardBody.length).toBeGreaterThan(10000)
    expect(ogBody.length).toBeGreaterThan(10000)

    // Verify PNG magic bytes (89 50 4E 47)
    expect(cardBody[0]).toBe(0x89)
    expect(cardBody[1]).toBe(0x50)
    expect(cardBody[2]).toBe(0x4e)
    expect(cardBody[3]).toBe(0x47)

    expect(ogBody[0]).toBe(0x89)
    expect(ogBody[1]).toBe(0x50)
    expect(ogBody[2]).toBe(0x4e)
    expect(ogBody[3]).toBe(0x47)
  })
})
