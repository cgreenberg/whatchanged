/**
 * Reverse-geocode lat/lng to a US zip code via Census Bureau Geocoder.
 * Returns null on any error — never throws.
 */
export async function reverseGeocodeToZip(lat: number, lng: number): Promise<string | null> {
  try {
    const layers = encodeURIComponent('2020 Census ZIP Code Tabulation Areas,2010 Census ZIP Code Tabulation Areas');
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=${layers}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json();
    // Try 2020 Census ZCTAs first, fall back to 2010
    const geos = data?.result?.geographies;
    const zcta2020 = geos?.['2020 Census ZIP Code Tabulation Areas']?.[0];
    if (zcta2020?.ZCTA5CE20) return zcta2020.ZCTA5CE20;
    const zcta2010 = geos?.['2010 Census ZIP Code Tabulation Areas']?.[0];
    if (zcta2010?.ZCTA5CE10) return zcta2010.ZCTA5CE10;
    return null;
  } catch {
    return null;
  }
}
