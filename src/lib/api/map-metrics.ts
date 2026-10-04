// County map "live" metrics (Gas, Groceries, Electricity), built by READING the cache only.
//
// These prices are published for metros, regions or states, not counties, so every county
// takes the value of the series the zip lookups assign it (src/lib/data/county-geo.json, built
// from the same lookup functions the snapshot uses). The endpoint never calls BLS/EIA and never
// spends the runtime upstream budget: a key missing from the cache (and its :lastgood copy) is
// simply "no data" on the map until the next refresh writes it.

import countyGeoJson from '@/lib/data/county-geo.json'
import { getCachedEnvelope, lastGoodKey } from '@/lib/cache/kv'
import type { CpiData } from '@/types'
import { cpiCacheKey } from './bls-cpi'
import { describeDuoarea, type GasSeriesData, type GasLookupResult } from './eia'
import { describeBlsGasArea } from './bls-gas'
import { electricityCacheKey, ELECTRICITY_STATES, type ElectricitySeriesData } from './eia-electricity'
import { isValidCpi, isValidGasSeries, isValidElectricity } from './validate'
import { CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES } from '@/lib/mappings/eia-gas'
import { cpiShortGeo } from '@/lib/hero-cards'

interface CountyGeo {
  state: string
  cpiArea: string
  cpiTier: 1 | 2 | 3 | 4
  cpiName: string
  gasSource: 'eia' | 'bls'
  gasDuoarea: string
  gasTier: 1 | 2 | 3
}
const COUNTY_GEO = countyGeoJson as unknown as Record<string, CountyGeo>

export interface MapGasArea {
  /** "e:R1X" (EIA duoarea) or "b:S35C" (BLS area); "*" suffix = HI/AK stand-in for a county with no series. */
  id: string
  label: string
  source: 'eia' | 'bls'
  frequency: 'weekly' | 'monthly'
  standIn?: true
  /** $/gal since the baseline (same figure as the gas card), current $/gal and the latest date; null = not cached. */
  change: number | null
  current: number | null
  asOf: string | null
}

export interface MapCpiArea {
  area: string
  label: string
  /** CPI food at home % change since its baseline month (same as the groceries card); null = not cached. */
  pct: number | null
  asOf: string | null
}

export interface MapElectricity {
  label: string
  /** Seasonally adjusted % change since Jan 2025 (same as the electricity card) and the published price. */
  pct: number
  cents: number
  asOf: string
}

export interface MapMetrics {
  gas: MapGasArea[]
  groceries: MapCpiArea[]
  /** By state (USPS code); states not cached are absent. */
  electricity: Record<string, MapElectricity>
  /** County FIPS → [index into gas, index into groceries]. The state is the FIPS prefix. */
  counties: Record<string, [number, number]>
  /** Cache keys with no usable cached copy (the map shows those areas as no data). */
  missing: number
}

/** EIA city labels ("Boston area avg") from the mapping tables; states/PADDs are labeled by describeDuoarea. */
function eiaCityLabel(duoarea: string): string | undefined {
  for (const t of [CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES]) {
    const hit = Object.values(t).find((v) => v.duoarea === duoarea)
    if (hit) return hit.label
  }
  return undefined
}

function gasLookupFor(g: CountyGeo): { id: string; lookup: GasLookupResult } {
  if (g.gasSource === 'bls') {
    // Tier 2 BLS = a HI/AK county outside the Honolulu/Anchorage CBSA showing that metro's series
    const standIn = g.gasTier === 2
    return { id: `b:${g.gasDuoarea}${standIn ? '*' : ''}`, lookup: describeBlsGasArea(g.gasDuoarea, { standIn }) }
  }
  return { id: `e:${g.gasDuoarea}`, lookup: describeDuoarea(g.gasDuoarea, eiaCityLabel(g.gasDuoarea)) }
}

/** The cached copy of a key, else its last-good copy; never fetches. Errors / invalid data → null. */
export async function readCacheOnly<T>(key: string, validate: (d: T) => boolean): Promise<T | null> {
  for (const k of [key, lastGoodKey(key)]) {
    try {
      const env = await getCachedEnvelope<T>(k)
      if (env && validate(env.data)) return env.data
    } catch {
      // Redis error or cool-down: treat as not cached (the map shows no data; nothing is fetched)
    }
  }
  return null
}

export async function buildMapMetrics(): Promise<MapMetrics> {
  const gasIdx = new Map<string, number>()
  const gasAreas: Array<{ id: string; lookup: GasLookupResult }> = []
  const cpiIdx = new Map<string, number>()
  const cpiAreas: CountyGeo[] = []
  const counties: Record<string, [number, number]> = {}

  for (const [fips, g] of Object.entries(COUNTY_GEO)) {
    const gas = gasLookupFor(g)
    if (!gasIdx.has(gas.id)) {
      gasIdx.set(gas.id, gasAreas.length)
      gasAreas.push(gas)
    }
    if (!cpiIdx.has(g.cpiArea)) {
      cpiIdx.set(g.cpiArea, cpiAreas.length)
      cpiAreas.push(g)
    }
    counties[fips] = [gasIdx.get(gas.id)!, cpiIdx.get(g.cpiArea)!]
  }

  // One read per distinct cache key (stand-in ids share their metro's key)
  const gasKeys = [...new Set(gasAreas.map((a) => a.lookup.cacheKey))]
  const [gasData, cpiData, elecData] = await Promise.all([
    Promise.all(gasKeys.map((k) => readCacheOnly<GasSeriesData>(k, isValidGasSeries))),
    Promise.all(cpiAreas.map((a) => readCacheOnly<CpiData>(cpiCacheKey(a.cpiArea), isValidCpi))),
    Promise.all(ELECTRICITY_STATES.map((st) => readCacheOnly<ElectricitySeriesData>(electricityCacheKey(st), isValidElectricity))),
  ])
  const gasByKey = new Map(gasKeys.map((k, i) => [k, gasData[i]]))
  let missing = 0

  const gas: MapGasArea[] = gasAreas.map(({ id, lookup }) => {
    const d = gasByKey.get(lookup.cacheKey) ?? null
    return {
      id,
      label: lookup.geoLevel,
      // selectGasLookup / getGasLookup return live rungs only (EIA or BLS); static sources are per-zip
      source: lookup.source as MapGasArea['source'],
      frequency: lookup.frequency as MapGasArea['frequency'],
      ...(lookup.standIn ? { standIn: true as const } : {}),
      change: d ? Number(d.change.toFixed(3)) : null,
      current: d ? d.current : null,
      asOf: d ? d.latestDate : null,
    }
  })
  missing += gasKeys.filter((k) => !gasByKey.get(k)).length

  const groceries: MapCpiArea[] = cpiAreas.map((g, i) => {
    const d = cpiData[i]
    if (!d) missing++
    return {
      area: g.cpiArea,
      label: cpiShortGeo({ tier: g.cpiTier, metro: g.cpiName, areaCode: g.cpiArea } as CpiData) ?? g.cpiName,
      pct: d ? Number(d.groceriesChange.toFixed(2)) : null,
      asOf: d?.groceriesLatestPeriod ?? null,
    }
  })

  const electricity: Record<string, MapElectricity> = {}
  ELECTRICITY_STATES.forEach((st, i) => {
    const d = elecData[i]
    if (!d) {
      missing++
      return
    }
    electricity[st] = { label: st === 'DC' ? 'District of Columbia' : d.stateName, pct: d.change, cents: d.current, asOf: d.latestPeriod }
  })

  return { gas, groceries, electricity, counties, missing }
}
