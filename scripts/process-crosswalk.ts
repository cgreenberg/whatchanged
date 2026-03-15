/**
 * One-time script to download and process the Census Bureau ZCTA-to-County
 * relationship file into src/lib/data/zip-county.json
 *
 * Source: https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt
 *
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/process-crosswalk.ts
 * Or: npx tsx scripts/process-crosswalk.ts
 */

import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'

const CENSUS_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt'

const STATE_FIPS_MAP: Record<string, { name: string; abbr: string }> = {
  '01': { name: 'Alabama', abbr: 'AL' },
  '02': { name: 'Alaska', abbr: 'AK' },
  '04': { name: 'Arizona', abbr: 'AZ' },
  '05': { name: 'Arkansas', abbr: 'AR' },
  '06': { name: 'California', abbr: 'CA' },
  '08': { name: 'Colorado', abbr: 'CO' },
  '09': { name: 'Connecticut', abbr: 'CT' },
  '10': { name: 'Delaware', abbr: 'DE' },
  '11': { name: 'District of Columbia', abbr: 'DC' },
  '12': { name: 'Florida', abbr: 'FL' },
  '13': { name: 'Georgia', abbr: 'GA' },
  '15': { name: 'Hawaii', abbr: 'HI' },
  '16': { name: 'Idaho', abbr: 'ID' },
  '17': { name: 'Illinois', abbr: 'IL' },
  '18': { name: 'Indiana', abbr: 'IN' },
  '19': { name: 'Iowa', abbr: 'IA' },
  '20': { name: 'Kansas', abbr: 'KS' },
  '21': { name: 'Kentucky', abbr: 'KY' },
  '22': { name: 'Louisiana', abbr: 'LA' },
  '23': { name: 'Maine', abbr: 'ME' },
  '24': { name: 'Maryland', abbr: 'MD' },
  '25': { name: 'Massachusetts', abbr: 'MA' },
  '26': { name: 'Michigan', abbr: 'MI' },
  '27': { name: 'Minnesota', abbr: 'MN' },
  '28': { name: 'Mississippi', abbr: 'MS' },
  '29': { name: 'Missouri', abbr: 'MO' },
  '30': { name: 'Montana', abbr: 'MT' },
  '31': { name: 'Nebraska', abbr: 'NE' },
  '32': { name: 'Nevada', abbr: 'NV' },
  '33': { name: 'New Hampshire', abbr: 'NH' },
  '34': { name: 'New Jersey', abbr: 'NJ' },
  '35': { name: 'New Mexico', abbr: 'NM' },
  '36': { name: 'New York', abbr: 'NY' },
  '37': { name: 'North Carolina', abbr: 'NC' },
  '38': { name: 'North Dakota', abbr: 'ND' },
  '39': { name: 'Ohio', abbr: 'OH' },
  '40': { name: 'Oklahoma', abbr: 'OK' },
  '41': { name: 'Oregon', abbr: 'OR' },
  '42': { name: 'Pennsylvania', abbr: 'PA' },
  '44': { name: 'Rhode Island', abbr: 'RI' },
  '45': { name: 'South Carolina', abbr: 'SC' },
  '46': { name: 'South Dakota', abbr: 'SD' },
  '47': { name: 'Tennessee', abbr: 'TN' },
  '48': { name: 'Texas', abbr: 'TX' },
  '49': { name: 'Utah', abbr: 'UT' },
  '50': { name: 'Vermont', abbr: 'VT' },
  '51': { name: 'Virginia', abbr: 'VA' },
  '53': { name: 'Washington', abbr: 'WA' },
  '54': { name: 'West Virginia', abbr: 'WV' },
  '55': { name: 'Wisconsin', abbr: 'WI' },
  '56': { name: 'Wyoming', abbr: 'WY' },
  '72': { name: 'Puerto Rico', abbr: 'PR' },
  '78': { name: 'U.S. Virgin Islands', abbr: 'VI' },
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

interface ZipEntry {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
}

async function main() {
  console.log('Downloading Census ZCTA-to-County crosswalk...')
  const raw = await fetchText(CENSUS_URL)

  const lines = raw.split('\n')
  console.log(`Total lines: ${lines.length}`)

  // Track best (largest area) county per zip
  const bestArea: Record<string, number> = {}
  const result: Record<string, ZipEntry> = {}

  // Column indices (0-based) for pipe-delimited file:
  // 0: OID_ZCTA5_20
  // 1: GEOID_ZCTA5_20  <- zip code
  // 2: NAMELSAD_ZCTA5_20
  // 3: AREALAND_ZCTA5_20
  // 4: AREAWATER_ZCTA5_20
  // 5: MTFCC_ZCTA5_20
  // 6: CLASSFP_ZCTA5_20
  // 7: FUNCSTAT_ZCTA5_20
  // 8: OID_COUNTY_20
  // 9: GEOID_COUNTY_20  <- county FIPS (5 digits)
  // 10: NAMELSAD_COUNTY_20  <- county name
  // 11: AREALAND_COUNTY_20
  // 12: AREAWATER_COUNTY_20
  // 13: MTFCC_COUNTY_20
  // 14: CLASSFP_COUNTY_20
  // 15: FUNCSTAT_COUNTY_20
  // 16: AREALAND_PART  <- area of zip in this county (use for tie-breaking)
  // 17: AREAWATER_PART

  let skipped = 0
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split('|')
    const zip = cols[1]?.trim()
    const countyFips = cols[9]?.trim()
    const countyFullName = cols[10]?.trim()
    const areaLandPart = parseInt(cols[16]?.trim() || '0', 10)

    // Skip rows where zip is empty (county-only rows at start of file)
    if (!zip || zip.length !== 5 || !/^\d{5}$/.test(zip)) {
      skipped++
      continue
    }

    if (!countyFips || countyFips.length !== 5) {
      skipped++
      continue
    }

    const stateFips = countyFips.slice(0, 2)
    const stateInfo = STATE_FIPS_MAP[stateFips]
    if (!stateInfo) {
      skipped++
      continue
    }

    // Strip " County", " Parish", " Borough", " Census Area", " Municipio" etc from county name
    // Keep the full NAMELSAD which already includes the suffix (e.g. "Clark County")
    const countyName = countyFullName || ''

    const prevArea = bestArea[zip] ?? -1
    if (areaLandPart > prevArea) {
      bestArea[zip] = areaLandPart
      result[zip] = {
        countyFips,
        countyName,
        stateName: stateInfo.name,
        stateAbbr: stateInfo.abbr,
        cityName: '',
      }
    }
  }

  const count = Object.keys(result).length
  console.log(`Skipped rows: ${skipped}`)
  console.log(`Unique zip codes processed: ${count}`)

  // Verify a known zip
  if (result['98683']) {
    console.log('Sample 98683:', JSON.stringify(result['98683']))
  } else {
    console.warn('Warning: zip 98683 not found in output')
  }

  const outPath = path.join(__dirname, '../src/lib/data/zip-county.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 0))
  console.log(`Written to ${outPath}`)
  console.log(`File size: ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
