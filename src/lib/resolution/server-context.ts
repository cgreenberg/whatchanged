// Server-side LadderContext: every rung fetch goes through the shared cache accessors
// (cached-sources.ts, runtime budget in kv.ts) or bundled static data, memoized per request so a
// series read by several ladders (CPI for groceries + shelter + the rent card's fallback, the U.S. gas
// average as both comparison and last rung) is fetched once.
//
// Adding a static-pipeline rung (Zillow metro rent, AK DCRA, PR DACO…): load its bundled JSON in a
// small lookup module and expose it here as a context accessor; the rung in ladders.ts calls it.

import type { CachedResult } from '@/lib/cache/kv'
import type { CpiData } from '@/types'
import {
  getCpiCached, getGasSeriesCached, getElectricityCached, type FetchOpts,
} from '@/lib/api/cached-sources'
import type { GasLookupResult, GasSeriesData } from '@/lib/api/eia'
import type { ElectricitySeriesData } from '@/lib/api/eia-electricity'
import { lookupCountyRent } from '@/lib/rent'
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
  ladder(metric: MetricId): Promise<LadderResult<unknown>>
}

export function serverLadderContext(loc: LadderLocation, now: Date, opts: FetchOpts = {}): ServerLadderContext {
  const gas = new Map<string, Promise<CachedResult<GasSeriesData>>>()
  const cpi = new Map<string, Promise<CachedResult<CpiData>>>()
  const elec = new Map<string, Promise<CachedResult<ElectricitySeriesData>>>()
  const ladders = new Map<string, Promise<LadderResult<unknown>>>()
  const ctx: ServerLadderContext = {
    now,
    gasSeries: (lookup) => memo(gas, lookup.cacheKey, lookup.source === 'bls' ? 'bls-gas' : 'eia-gas', () => getGasSeriesCached(lookup, opts)),
    cpi: (area) => memo(cpi, area.areaCode, 'bls-cpi', () => getCpiCached(area, opts)),
    electricity: (state) => memo(elec, state, 'eia-electricity', () => getElectricityCached(state, opts)),
    countyRent: lookupCountyRent,
    ladder: (metric) =>
      memo(ladders, metric, `ladder:${metric}`, () =>
        resolveLadder(LADDERS[metric] as unknown as Ladder<LadderLocation, unknown, LadderContext>, loc, ctx)),
  }
  return ctx
}
