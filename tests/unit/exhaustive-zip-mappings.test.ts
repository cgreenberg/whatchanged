/**
 * Exhaustive mapping test: every zip in zip-county.json resolves through the
 * full mapping chain (county FIPS, CPI area, EIA gas, LAUS area, census), and
 * src/lib/data/county-geo.json (consumed by scripts/build-local-data.py) agrees
 * with the live lookups.
 *
 * Valid code sets are derived from the source modules, so adding a code in one
 * place doesn't require editing a copy here.
 *
 * Collects ALL failures into an array so every broken zip is reported in one run.
 */

import { getGasLookup } from '@/lib/api/eia'
import { getMetroCpiAreaForCounty, BLS_CPI_AREAS, STATE_TO_DIVISION } from '@/lib/mappings/county-metro-cpi'
import {
  CPI_TO_EIA_CITY,
  COUNTY_EIA_CITY_OVERRIDES,
  STATE_LEVEL_CODES,
  PAD_DUOAREA,
} from '@/lib/mappings/eia-gas'
import { BLS_GAS_PUBLISHED_AREAS } from '@/lib/mappings/bls-gas'
import { getLausAreaFipsForZip, CT_PLANNING_REGION_NAMES } from '@/lib/mappings/laus-area'
import { STATE_FIPS_MAP } from '@/lib/mappings/state-fips'
import zipCounty from '@/lib/data/zip-county.json'
import countyGeo from '@/lib/data/county-geo.json'
import censusAcs from '@/lib/data/census-acs.json'

const VALID_CPI_AREA_CODES = new Set(['0000', ...Object.keys(BLS_CPI_AREAS)])

const VALID_EIA_DUOAREA_CODES = new Set([
  'NUS',
  ...Object.values(CPI_TO_EIA_CITY).map(c => c.duoarea),
  ...Object.values(COUNTY_EIA_CITY_OVERRIDES).map(c => c.duoarea),
  ...Object.values(STATE_LEVEL_CODES).map(c => c.duoarea),
  ...Object.values(PAD_DUOAREA),
])

interface ZipEntry {
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
  zcta?: boolean
}

interface CensusEntry {
  /** null = Census suppressed the estimate (never a synthetic fallback value). */
  medianRent: number | null
}

interface CountyGeo {
  state: string
  cpiArea: string
  cpiTier: number
  cpiName: string
  gasSource: string
  gasDuoarea: string
  gasTier: number
  lausFips: string
  approx?: boolean
}

const zips = zipCounty as Record<string, ZipEntry>
const geo = countyGeo as Record<string, CountyGeo>

describe('exhaustive zip mappings', () => {
  jest.setTimeout(120_000)

  it('every zip resolves through the full mapping chain', () => {
    const census = censusAcs as unknown as Record<string, CensusEntry>
    const failures: string[] = []

    for (const [zip, entry] of Object.entries(zips)) {
      const { countyFips, stateAbbr, stateName } = entry

      if (!/^\d{5}$/.test(zip)) failures.push(`${zip}: zip is not 5 digits`)
      if (!/^\d{5}$/.test(countyFips)) {
        failures.push(`${zip}: countyFips "${countyFips}" is not a 5-digit string`)
        continue
      }
      const st = STATE_FIPS_MAP[countyFips.slice(0, 2)]
      if (!st || st.abbr !== stateAbbr || st.name !== stateName) {
        failures.push(`${zip}: county ${countyFips} state prefix does not match ${stateAbbr}/${stateName}`)
      }
      if (!entry.countyName) failures.push(`${zip}: empty countyName`)

      // CPI
      const cpi = getMetroCpiAreaForCounty(countyFips, stateAbbr)
      if (!VALID_CPI_AREA_CODES.has(cpi.areaCode)) {
        failures.push(`${zip}: CPI areaCode "${cpi.areaCode}" not in BLS_CPI_AREAS`)
      }
      // States + DC never fall past the division tier; only territories get national
      const isState = Boolean(STATE_TO_DIVISION[stateAbbr])
      if (isState && cpi.tier > 2) failures.push(`${zip}: ${stateAbbr} got CPI tier ${cpi.tier}`)
      if (!isState && cpi.areaCode !== '0000') failures.push(`${zip}: territory ${stateAbbr} got CPI ${cpi.areaCode}`)

      // Gas
      const gas = getGasLookup(stateAbbr, cpi.areaCode, countyFips)
      if (gas.source === 'eia' && !VALID_EIA_DUOAREA_CODES.has(gas.areaCode)) {
        failures.push(`${zip}: EIA duoarea "${gas.areaCode}" not produced by eia-gas.ts tables`)
      }
      if (gas.source === 'bls' && !BLS_GAS_PUBLISHED_AREAS.has(gas.areaCode)) {
        failures.push(`${zip}: BLS gas area "${gas.areaCode}" has no published APU…74714 series`)
      }
      if (isState && gas.duoarea === 'NUS') failures.push(`${zip}: ${stateAbbr} fell back to national gas`)

      // LAUS area
      const laus = getLausAreaFipsForZip(zip)
      if (stateAbbr === 'CT') {
        if (!laus || !CT_PLANNING_REGION_NAMES[laus]) {
          failures.push(`${zip}: CT zip LAUS area ${laus} is not a planning region`)
        }
      } else if (laus !== countyFips) {
        failures.push(`${zip}: LAUS area ${laus} != county ${countyFips}`)
      }

      // county-geo.json must agree with the live lookups
      const g = geo[countyFips]
      if (!g) {
        failures.push(`${zip}: county ${countyFips} missing from county-geo.json (run scripts/build-county-geo.ts)`)
      } else if (
        g.state !== stateAbbr ||
        g.cpiArea !== cpi.areaCode ||
        g.cpiTier !== cpi.tier ||
        g.gasSource !== gas.source ||
        g.gasDuoarea !== gas.areaCode ||
        g.gasTier !== gas.tier
      ) {
        failures.push(`${zip}: county-geo.json ${JSON.stringify(g)} != live ${cpi.areaCode}/${gas.source}:${gas.areaCode}`)
      }

      // Census rent (the shelter card's $ base) is optional (USPS-only zips have none), but must be sane when present
      const c = census[zip]
      if (c && c.medianRent !== null && !(c.medianRent > 0)) {
        failures.push(`${zip}: census rent not > 0`)
      }
    }

    if (failures.length > 0) console.log(`FAILURES (${failures.length}):`, failures.slice(0, 30))
    expect(failures).toEqual([])
  })

  it('county-geo.json has no counties absent from zip-county.json', () => {
    const counties = new Set(Object.values(zips).map(z => z.countyFips))
    expect(Object.keys(geo).filter(f => !counties.has(f))).toEqual([])
  })
})
