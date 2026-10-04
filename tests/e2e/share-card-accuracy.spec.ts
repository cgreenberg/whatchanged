import { test, expect } from '@playwright/test'

// Image routes that would fetch live data are covered by unit tests; here only input validation,
// which never reaches BLS/EIA.
test.describe('Share image endpoints reject bad input', () => {
  test('card-image rejects an invalid zip', async ({ request }) => {
    expect((await request.get('/api/card-image?zip=abcde')).status()).toBe(400)
  })

  test('card-image rejects a missing zip', async ({ request }) => {
    expect((await request.get('/api/card-image?zip=')).status()).toBe(400)
  })

  test('share route rejects an invalid zip', async ({ request }) => {
    expect((await request.get('/api/share/12ab5')).status()).toBe(400)
  })
})
