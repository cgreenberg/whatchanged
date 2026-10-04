// Server-side LadderContext: every rung fetch goes through the shared cache accessors
// (cached-sources.ts, runtime budget in kv.ts) or bundled static data, memoized per request so a
// series read by several ladders (CPI for groceries + shelter + the rent card's fallback, the U.S. gas
// average as both comparison and last rung) is fetched once.
//
// Static-pipeline rungs (Zillow county/metro rent, Alaska DCRA survey, Puerto Rico DACO) read bundled JSON
// through small lookup modules exposed here as context accessors; the rung in ladders.ts calls them.

import type { CachedResult } from '@/lib/cache/kv'
import type { CpiData } from '@/types'
import {
  getCpiCached, getGasSeriesCached, getElectricityCached, getHeatingCached, getNyserdaCached, type FetchOpts,
} from '@/lib/api/cached-sources'
import type { GasLookupResult, GasSeriesData } from '@/lib/api/eia'
import type { ElectricitySeriesData } from '@/lib/api/eia-electricity'
import type { HeatingProduct, HeatingSeriesData } from '@/lib/api/eia-heating'
import type { NyserdaHeatingOil } from '@/lib/api/nyserda'
import { lookupCountyRent, lookupMetroRent } from '@/lib/rent'
import { lookupAkGas, lookupPrGas } from '@/lib/static-gas'
import { getCensusData } from '@/lib/data/census-acs'
import { resolveLadder, type Ladder, type LadderResult } from './resolve'
import { LADDERS, type CpiArea, type LadderContext, type LadderLocation, type MetricId } from './ladders'

function memo<T>(map: Map<string, Promise<T>>, key: string, label: string, run: () => Promise<T>): Promise<T> {
  let p = map.get(key)
  if (!p) {
    p = run().catch((e) => {
      console.error(`[${label}] unavailable:`, e instanceof Error ? e.message : e)
      throw e
    })
    map.set(key, p)
  }
  return p
}

export interface ServerLadderContext extends LadderContext {
  gasSeries(lookup: GasLookupResult): Promise<CachedResult<GasSeriesData>>
  cpi(area: CpiArea): Promise<CachedResult<CpiData>>
  electricity(state: string): Promise<CachedResult<ElectricitySeriesData>>
  heating(product: HeatingProduct, area: string): Promise<CachedResult<HeatingSeriesData>>
  nyserda(): Promise<CachedResult<NyserdaHeatingOil>>
  ladder(metric: MetricId): Promise<LadderResult<unknown>>
}

export function serverLadderContext(loc: LadderLocation, now: Date, opts: FetchOpts = {}): ServerLadderContext {
  const gas = new Map<string, Promise<CachedResult<GasSeriesData>>>()
  const cpi = new Map<string, Promise<CachedResult<CpiData>>>()
  const elec = new Map<string, Promise<CachedResult<ElectricitySeriesData>>>()
  const heat = new Map<string, Promise<CachedResult<HeatingSeriesData>>>()
  const ny = new Map<string, Promise<CachedResult<NyserdaHeatingOil>>>()
  const ladders = new Map<string, Promise<LadderResult<unknown>>>()
  const ctx: ServerLadderContext = {
    now,
    gasSeries: (lookup) => memo(gas, lookup.cacheKey, lookup.source === 'bls' ? 'bls-gas' : 'eia-gas', () => getGasSeriesCached(lookup, opts)),
    cpi: (area) => memo(cpi, area.areaCode, 'bls-cpi', () => getCpiCached(area, opts)),
    electricity: (state) => memo(elec, state, 'eia-electricity', () => getElectricityCached(state, opts)),
    heating: (product, area) => memo(heat, `${product}:${area}`, 'eia-heating', () => getHeatingCached(product, area, opts)),
    nyserda: () => memo(ny, 'all', 'nyserda', () => getNyserdaCached(opts)),
    countyRent: lookupCountyRent,
    metroRent: lookupMetroRent,
    akGas: lookupAkGas,
    prGas: lookupPrGas,
    censusRent: getCensusData,
    ladder: (metric) =>
      memo(ladders, metric, `ladder:${metric}`, () =>
        resolveLadder(LADDERS[metric] as unknown as Ladder<LadderLocation, unknown, LadderContext>, loc, ctx)),
  }
  return ctx
}
