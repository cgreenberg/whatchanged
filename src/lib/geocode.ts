/**
 * Reverse-geocode lat/lng to a US zip code via our server-side API route,
 * which proxies to the Census Bureau Geocoder (avoids CORS issues).
 * Returns null on any error — never throws.
 */
export async function reverseGeocodeToZip(lat: number, lng: number): Promise<string | null> {
  try {
    // 4 decimals (~11 m) is plenty for a zip and matches the route's canonical (CDN-cached) URL.
    const r4 = (n: number) => Number(n.toFixed(4))
    const res = await fetch(`/api/geocode?lat=${r4(lat)}&lng=${r4(lng)}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.zip ?? null
  } catch {
    return null
  }
}
