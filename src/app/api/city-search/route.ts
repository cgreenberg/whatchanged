import { NextRequest } from 'next/server'

// Load the zip-county data (bundled JSON)
import zipCountyData from '@/lib/data/zip-county.json'

interface ZipEntry {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
}

const zipData = zipCountyData as Record<string, ZipEntry>

// Build a city index on first request (cached in module scope)
interface CityEntry { city: string; state: string; stateAbbr: string; zip: string; display: string }
let cityIndex: CityEntry[] | null = null

function getCityIndex() {
  if (cityIndex) return cityIndex
  const seen = new Set<string>()
  const entries: CityEntry[] = []

  for (const [zip, entry] of Object.entries(zipData)) {
    if (!entry.cityName) continue
    const key = `${entry.cityName.toLowerCase()}|${entry.stateAbbr.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    entries!.push({
      city: entry.cityName.toLowerCase(),
      state: entry.stateAbbr.toLowerCase(),
      stateAbbr: entry.stateAbbr,
      zip,
      display: `${entry.cityName}, ${entry.stateAbbr}`,
    })
  }

  cityIndex = entries
  return entries!
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? ''
  if (q.length < 2) {
    return Response.json([])
  }

  // Parse out optional state
  const parts = q.replace(/,/g, '').split(/\s+/)
  const stateAbbrevs = new Set(["al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc"])

  let cityQuery = q
  let stateFilter: string | undefined

  if (parts.length > 1 && stateAbbrevs.has(parts[parts.length - 1])) {
    stateFilter = parts[parts.length - 1]
    cityQuery = parts.slice(0, -1).join(' ')
  }

  const index = getCityIndex()
  const results = index
    .filter(entry => {
      const cityMatch = entry.city.startsWith(cityQuery)
      if (!cityMatch) return false
      if (stateFilter && entry.state !== stateFilter) return false
      return true
    })
    .slice(0, 8)

  return Response.json(results.map(r => ({
    display: r.display,
    zip: r.zip,
    source: 'local' as const,
  })))
}
