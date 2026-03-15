// Test the OG URL construction logic
describe('OG image URL', () => {
  test('builds valid URL params', () => {
    const params = new URLSearchParams()
    params.set('zip', '98683')
    params.set('location', 'Clark County, WA')
    params.set('unemployment', '5.0%')
    params.set('unemploymentChange', '+0.9 pts')

    const url = `/api/og?${params.toString()}`
    expect(url).toContain('zip=98683')
    expect(url).toContain('location=')
    expect(url).toContain('unemployment=5.0%25')
  })
})
