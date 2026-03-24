/**
 * Reverse-geocode lat/lng to a US zip code via our server-side API route,
 * which proxies to the Census Bureau Geocoder (avoids CORS issues).
 * Returns null on any error — never throws.
 */
export async function reverseGeocodeToZip(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.zip ?? null
  } catch {
    return null
  }
}
