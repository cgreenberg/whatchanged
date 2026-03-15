// Basic zip → lat/lng for common zips
// In production, this would be a full dataset or geocoding API
const KNOWN_COORDS: Record<string, [number, number]> = {
  '98683': [45.6189, -122.5518],   // Vancouver, WA
  '10001': [40.7484, -73.9967],    // New York, NY
  '90210': [34.0901, -118.4065],   // Beverly Hills, CA
  '60601': [41.8819, -87.6278],    // Chicago, IL
  '77001': [29.7604, -95.3698],    // Houston, TX
}

export function getZipCoords(zip: string): [number, number] | undefined {
  return KNOWN_COORDS[zip]
}

export async function geocodeZip(zip: string): Promise<[number, number] | undefined> {
  // Check hardcoded first
  const known = KNOWN_COORDS[zip]
  if (known) return known

  // Fallback to Nominatim
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    )
    if (!res.ok) return undefined
    const data = await res.json()
    if (data[0]) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)]
    }
  } catch {}
  return undefined
}
