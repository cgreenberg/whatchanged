import { NextRequest } from 'next/server'
import { parseQuery } from '@/lib/city-search'

// Load the zip-county data (bundled JSON)
import zipCountyData from '@/lib/data/zip-county.json'

interface ZipEntry {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
  /** false for USPS-only zips (PO boxes etc.) with no Census ZCTA / ACS data */
  zcta?: false
}

const zipData = zipCountyData as Record<string, ZipEntry>

// Build a city index on first request (cached in module scope)
interface CityEntry { city: string; state: string; stateAbbr: string; zip: string; display: string; zcta: boolean; zipCount: number }
let cityIndex: CityEntry[] | null = null

function getCityIndex(): CityEntry[] {
  if (cityIndex) return cityIndex
  const byKey = new Map<string, CityEntry>()

  for (const [zip, entry] of Object.entries(zipData)) {
    if (!entry.cityName) continue
    const key = `${entry.cityName.toLowerCase()}|${entry.stateAbbr.toLowerCase()}`
    const isZcta = entry.zcta !== false
    const existing = byKey.get(key)
    if (existing) existing.zipCount++
    // Representative zip = lowest-numbered zip that has Census (ZCTA) data;
    // a PO-box-only zip is used only when the city has nothing else.
    if (existing && (existing.zcta || !isZcta)) continue
    byKey.set(key, {
      city: entry.cityName.toLowerCase(),
      state: entry.stateAbbr.toLowerCase(),
      stateAbbr: entry.stateAbbr,
      zip,
      display: `${entry.cityName}, ${entry.stateAbbr}`,
      zcta: isZcta,
      zipCount: existing ? existing.zipCount : 1,
    })
  }

  cityIndex = [...byKey.values()]
  return cityIndex
}

/** Results come from bundled static data (changes only on deploy): cache at the CDN for a day. */
const CITY_SEARCH_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
}

export async function GET(req: NextRequest) {
  // Longest US place name + state is well under 100 chars; cap work on junk input.
  const q = req.nextUrl.searchParams.get('q')?.slice(0, 100).trim().toLowerCase() ?? ''
  if (q.length < 2) {
    return Response.json([], { headers: CITY_SEARCH_CACHE_HEADERS })
  }

  // Optional trailing state: 2-letter abbreviation or full name (incl. PR/VI/GU/MP/AS)
  const { city: cityQuery, state: stateFilter } = parseQuery(q)

  const index = getCityIndex()
  const results = index
    .filter(entry => {
      if (!entry.city.startsWith(cityQuery)) return false
      if (stateFilter && entry.state !== stateFilter) return false
      return true
    })
    // Exact name matches first ("portland" before "portlandville"), then bigger
    // places first — zip count is a cheap proxy for size (Portland OR/ME before Portland ND)
    .sort(
      (a, b) =>
        Number(b.city === cityQuery) - Number(a.city === cityQuery) || b.zipCount - a.zipCount
    )
    .slice(0, 8)

  return Response.json(results.map(r => ({
    display: r.display,
    zip: r.zip,
    source: 'local' as const,
  })), { headers: CITY_SEARCH_CACHE_HEADERS })
}
