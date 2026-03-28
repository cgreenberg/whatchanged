// Downloads Census Gazetteer county centroid data and outputs county-centroids.json
// Usage: npx tsx scripts/build-county-centroids.ts

import { writeFileSync } from 'fs'
import { join } from 'path'

// All state FIPS codes (01-56, including DC=11, skipping gaps)
const STATE_FIPS = [
  '01','02','04','05','06','08','09','10','11','12','13','15','16','17','18','19',
  '20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35',
  '36','37','38','39','40','41','42','44','45','46','47','48','49','50','51','53',
  '54','55','56'
]

const GAZ_BASE = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/'

interface CountyCentroid {
  lat: number
  lng: number
  name: string
  state: string
}

async function fetchStateCentroids(stateFips: string): Promise<Record<string, CountyCentroid>> {
  const url = `${GAZ_BASE}2024_gaz_counties_${stateFips}.txt`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`  Failed to fetch ${stateFips}: ${response.status}`)
    return {}
  }
  const text = await response.text()
  const lines = text.trim().split('\n')
  const result: Record<string, CountyCentroid> = {}

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    // Columns: USPS, GEOID, ANSICODE, NAME, ALAND, AWATER, ALAND_SQMI, AWATER_SQMI, INTPTLAT, INTPTLONG
    const stateAbbr = cols[0]?.trim()
    const geoid = cols[1]?.trim()  // 5-digit county FIPS
    const name = cols[3]?.trim()
    const lat = parseFloat(cols[8]?.trim())
    const lng = parseFloat(cols[9]?.trim())
    if (geoid && !isNaN(lat) && !isNaN(lng)) {
      result[geoid] = { lat, lng, name, state: stateAbbr }
    }
  }
  return result
}

async function main() {
  const allCounties: Record<string, CountyCentroid> = {}

  for (const fips of STATE_FIPS) {
    process.stdout.write(`Fetching state ${fips}...`)
    const counties = await fetchStateCentroids(fips)
    const count = Object.keys(counties).length
    console.log(` ${count} counties`)
    Object.assign(allCounties, counties)
  }

  const outPath = join(__dirname, '..', 'src', 'lib', 'data', 'county-centroids.json')
  writeFileSync(outPath, JSON.stringify(allCounties, null, 2))
  console.log(`\nWrote ${Object.keys(allCounties).length} county centroids to ${outPath}`)
}

main().catch(console.error)
