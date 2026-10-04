import { lookupZip } from '@/lib/data/zip-lookup'
import { getCensusData } from '@/lib/data/census-acs'
import type { CachedResult } from '@/lib/cache/kv'
import type {
  EconomicSnapshot,
  DataResult,
  CensusData,
  CacheStatus,
  CpiData,
  GasPriceData,
  ElectricityData,
  HeatingFuelData,
} from '@/types'
import type { RentData } from '@/types'
import { computeDollarImpact } from '@/lib/compute/dollar-translations'
import { toGasPriceData, type GasLookupResult } from './eia'
import { NATIONAL_CPI_AREA } from './bls-cpi'
import { nationalGasLookupFor, NATIONAL_GAS_LOOKUP, settle } from './cached-sources'
import { hasElectricitySeries, type ElectricitySeriesData } from './eia-electricity'
import { isBlsPeriodStale } from '@/lib/staleness'
import {
  selectCpiArea, selectGasLookup, isNationalRung, LADDERS, type LadderLocation, type GasRungValue, type HeatingRungValue,
} from '@/lib/resolution/ladders'
import { firstApplicable } from '@/lib/resolution/resolve'
import { serverLadderContext } from '@/lib/resolution/server-context'
import type { Attempt, LadderResult } from '@/lib/resolution/resolve'

export { BLS_STALE_DAYS, isBlsPeriodStale, ELECTRICITY_STALE_DAYS, isElectricityPeriodStale } from '@/lib/staleness'

/**
 * Attach the U.S. series and the U.S. seasonally adjusted % change over the SAME months as the
 * local figure (Jan 2025 → the local latest month); omitted when the U.S. lacks either month.
 */
export function withNationalElectricity(local: ElectricitySeriesData, us: ElectricitySeriesData | null): ElectricityData {
  if (!us || local.state === us.state) return { ...local }
  const at = (d: string) => us.series.find((p) => p.date === d)?.sa
  const b = at(local.baselinePeriod)
  const l = at(local.latestPeriod)
  const nationalChange = typeof b === 'number' && typeof l === 'number' && b > 0
    ? Number((((l - b) / b) * 100).toFixed(2))
    : undefined
  return {
    ...local,
    nationalSeries: us.series,
    ...(nationalChange !== undefined ? { nationalChange, nationalLatestPeriod: local.latestPeriod } : {}),
  }
}

export interface SnapshotOptions {
  /** Bypass cache reads and refetch every upstream source (still charged to the upstream budget). */
  forceRefresh?: boolean
}

function cacheStatusOf(r: CachedResult<unknown> | null): 'hit' | 'miss' | 'stale' | 'error' {
  if (!r) return 'error'
  if (r.stale) return 'stale'
  return r.cacheHit ? 'hit' : 'miss'
}

function wrap<T>(
  data: T | null,
  sourceId: string,
  fetchedAt: string | undefined,
  now: string,
  stale = false
): DataResult<T> {
  return {
    data,
    error: data ? null : 'Data unavailable',
    fetchedAt: fetchedAt ?? now,
    sourceId,
    ...(data && stale ? { stale: true } : {}),
  }
}

export async function fetchSnapshot(
  zip: string,
  options: SnapshotOptions = {}
): Promise<EconomicSnapshot | null> {
  const location = lookupZip(zip)
  if (!location) return null

  const now = new Date().toISOString()
  const nowDate = new Date(now)

  // Every metric is resolved by walking its ladder (src/lib/resolution/ladders.ts): most local rung
  // first, first one with data wins, every rung's outcome recorded as the trace.
  const cpiArea = selectCpiArea(location.countyFips, location.stateAbbr)
  const loc: LadderLocation = {
    zip: location.zip,
    stateAbbr: location.stateAbbr,
    stateName: location.stateName,
    countyFips: location.countyFips,
    countyName: location.countyName,
    cpiAreaCode: cpiArea.areaCode,
  }
  const ctx = serverLadderContext(loc, nowDate, { forceRefresh: options.forceRefresh })

  // National gas comes from the same source as the local series (BLS monthly tiers → BLS U.S.
  // average; EIA weekly tiers → EIA NUS), so comparisons never mix sources or frequencies. Static
  // sources (Alaska DCRA survey, Puerto Rico DACO) have no U.S. figure: no comparison, nothing fetched.
  const gasPrimary = selectGasLookup(loc)
  const gasFirstStatic = firstApplicable(LADDERS.gas, loc)?.rung.pipeline === 'static'
  const gasNationalLookup = nationalGasLookupFor(gasPrimary)
  const gasIsNational = gasFirstStatic || gasPrimary.cacheKey === gasNationalLookup.cacheKey
  const gasLabel = gasPrimary.source === 'bls' ? 'bls-gas' : 'eia-gas'
  // Electricity: the zip's state (statewide average) + the shared U.S. key. Territories: EIA publishes none.
  const elecState = hasElectricitySeries(location.stateAbbr) ? location.stateAbbr.toUpperCase() : null

  // All ladders and the national comparisons in parallel; each series is fetched once (memoized context).
  const [gasWalk, groceriesWalk, shelterWalk, rentWalk, elecWalk, gasNational, elecNational, oilWalk, propaneWalk] = await Promise.all([
    ctx.ladder('gas') as Promise<LadderResult<GasRungValue>>,
    ctx.ladder('groceries') as Promise<LadderResult<CachedResult<CpiData>>>,
    ctx.ladder('shelter'),
    ctx.ladder('rent'),
    ctx.ladder('electricity') as Promise<LadderResult<CachedResult<ElectricitySeriesData>>>,
    gasIsNational ? Promise.resolve(null) : settle(ctx.gasSeries(gasNationalLookup), `${gasLabel}-national`),
    elecState ? settle(ctx.electricity('US'), 'eia-electricity-national') : Promise.resolve(null),
    ctx.ladder('heatingOil') as Promise<LadderResult<HeatingRungValue>>,
    ctx.ladder('propane') as Promise<LadderResult<HeatingRungValue>>,
  ])

  // CPI (groceries and shelter share one fetch per area): the area the walk ended on. When the local
  // area failed, that is the shared national CPI key, labeled national (tier 4, fallback: 'national').
  const cpiAttempt = shown(groceriesWalk)
  const cpiResult: CachedResult<CpiData> | null = cpiAttempt?.outcome.value ?? null
  const cpiIsNationalFallback = !!cpiAttempt && isNationalRung(cpiAttempt.rung.id) && cpiArea.areaCode !== NATIONAL_CPI_AREA

  // Gas: the winning rung's series + the national overlay from the same source. A national stand-in
  // for a failed local series is composed here and never written under the local cache key.
  let gasData: GasPriceData | null = null
  let gasMeta: CachedResult<unknown> | null = null
  const gw = gasWalk.winner
  if (gw?.outcome.value?.lookup) {
    // Static rung (bundled data): its own series, no national comparison (no U.S. figure from that source)
    const r = gw.outcome.value
    gasMeta = r
    gasData = { ...toGasPriceData(r.lookup!, r.data), ...(r.staticHit ? { staticSource: r.staticHit } : {}) }
  } else if (gw?.outcome.value) {
    const lookup = gw.target as GasLookupResult
    const r = gw.outcome.value
    gasMeta = r
    if (!gasWalk.afterFailure) {
      // A static rung that turned out to have no series for this zip (e.g. a zip new to the crosswalk) falls to a
      // live rung: its same-source national comparison wasn't fetched up front, so fetch it now.
      const nat = gasFirstStatic && lookup.cacheKey !== nationalGasLookupFor(lookup).cacheKey
        ? await settle(ctx.gasSeries(nationalGasLookupFor(lookup)), `${lookup.source}-gas-national`)
        : gasIsNational ? null : gasNational
      gasData = toGasPriceData(lookup, r.data, { nationalSeries: nat?.data.series })
    } else if (isNationalRung(gw.rung.id)) {
      gasData = { ...toGasPriceData(lookup, r.data, { isNationalFallback: true }), fallback: 'national' }
    } else {
      // BLS outage: the zip's EIA weekly tier as a whole — local AND national from EIA, labeled as a
      // fallback — never a BLS local against an EIA national (or vice versa).
      const nat = await settle(ctx.gasSeries(NATIONAL_GAS_LOOKUP), 'eia-gas-national')
      gasData = { ...toGasPriceData(lookup, r.data, { nationalSeries: nat?.data.series }), fallback: 'eia' }
    }
  }
  const gasStale = !!gasData && gw?.outcome.status === 'stale'

  const cpiBase: CpiData | null = cpiResult?.data
    ? cpiIsNationalFallback
      ? { ...cpiResult.data, fallback: 'national' }
      : cpiResult.data
    : null
  // Per-item staleness: each item from its OWN latest month (a lagging series, e.g. Phoenix food at
  // home, gets the badge even when shelter is current). A last-good copy marks every item stale.
  const cpiStaleItems = cpiBase
    ? (['groceries', 'shelter'] as const).filter((item) => {
        if (cpiResult?.stale) return true
        const latest = item === 'groceries' ? cpiBase.groceriesLatestPeriod : cpiBase.shelterLatestPeriod
        return isBlsPeriodStale(latest, nowDate)
      })
    : []
  const cpiData: CpiData | null = cpiBase ? { ...cpiBase, staleItems: [...cpiStaleItems] } : null
  const cpi: DataResult<CpiData> = wrap(cpiData, 'bls-cpi', cpiResult?.fetchedAt, now, cpiStaleItems.length > 0)
  const gasSourceId = gasData?.source === 'bls' ? 'bls-gas' : gasData?.source === 'dcra' ? 'dcra-gas' : gasData?.source === 'daco' ? 'daco-gas' : 'eia-gas'
  const gas: DataResult<GasPriceData> = wrap(gasData, gasSourceId, gasMeta?.fetchedAt, now, gasStale)

  // Census is synchronous (bundled static data): local median rent for the shelter card's $
  const censusData = getCensusData(zip)
  const census: DataResult<CensusData> = {
    data: censusData,
    error: censusData ? null : 'Census data unavailable for this zip',
    fetchedAt: now,
    sourceId: 'census-acs',
  }

  // Electricity: statewide EIA price, with the U.S. average over the same months
  const elecLocal = shown(elecWalk)?.outcome.value ?? null
  const electricityData: ElectricityData | null = elecLocal
    ? withNationalElectricity(elecLocal.data, elecNational?.data ?? null)
    : null
  const electricityStale = !!electricityData && elecWalk.winner?.outcome.status === 'stale'
  const electricity: DataResult<ElectricityData> = elecState
    ? wrap(electricityData, 'eia-electricity', elecLocal?.fetchedAt, now, electricityStale)
    : { data: null, error: 'EIA publishes no residential electricity price for this area', fetchedAt: now, sourceId: 'eia-electricity' }

  // Dollar impact (centralized computation for hero cards).
  // Shelter $ = LOCAL median rent × 12 × the LOCAL CPI area's "rent of primary residence" (SEHA) % —
  // not the CPI shelter % (mostly owners' equivalent rent). No national fallback rent, no national
  // CPI applied to local rent (national CPI fallback, or a territory whose only CPI is national, e.g.
  // Puerto Rico → null), and no figure when the rent index is missing (e.g. older cached CPI).
  const cpiIsNational = cpiIsNationalFallback || cpiArea.areaCode === NATIONAL_CPI_AREA
  const localRent = censusData && !censusData.isFallback && !censusData.isRentFallback && !cpiIsNational
    ? censusData.medianRent
    : null
  const dollarImpact = computeDollarImpact({
    groceriesChangePct: cpi.data?.groceriesChange,
    rentIndexChangePct: cpi.data?.rentIndexChange,
    gasChange: gas.data?.change,
    medianRent: localRent,
    electricitySaChangeCents: electricityData ? electricityData.saCurrent - electricityData.saBaseline : null,
    electricityUsageKwh: electricityData?.usageKwh,
  })

  // Housing card: county rent on new leases (bundled Zillow data) when the rent ladder's Zillow rung
  // wins; otherwise null and the card falls back to CPI shelter (the ladder's next rung).
  const rentRung = rentWalk.winner?.rung.id
  const rent: RentData | null = rentRung === 'rent.zillow-county' || rentRung === 'rent.zillow-metro'
    ? (rentWalk.winner!.outcome.value as RentData)
    : null

  const cacheStatus: CacheStatus = {
    cpi: cacheStatusOf(cpiResult),
    gas: cacheStatusOf(gasMeta),
    ...(elecState ? { electricity: cacheStatusOf(elecLocal) } : {}),
    census: 'hit',
  }

  return {
    zip,
    location,
    cpi,
    gas,
    census,
    electricity,
    rent,
    heating: { oil: heatingResult(oilWalk, 'oil', now), propane: heatingResult(propaneWalk, 'propane', now) },
    dollarImpact,
    fetchedAt: now,
    cacheStatus,
    trace: {
      gas: gasWalk.steps,
      rent: rentWalk.steps,
      groceries: groceriesWalk.steps,
      shelter: shelterWalk.steps,
      electricity: elecWalk.steps,
      heatingOil: oilWalk.steps,
      propane: propaneWalk.steps,
    },
  }
}

/**
 * Home heating graph tab: the winning rung's series (with its same-source comparison), "Data unavailable"
 * when a source covers the place but failed, or null when no source publishes this fuel there (no tab).
 */
function heatingResult(w: LadderResult<HeatingRungValue>, product: 'oil' | 'propane', now: string): DataResult<HeatingFuelData> | null {
  const v = w.winner?.outcome.value
  if (!v) {
    const applicable = w.steps.some((st) => st.status !== 'not-applicable')
    return applicable ? { data: null, error: 'Data unavailable', fetchedAt: now, sourceId: `${product}-heating` } : null
  }
  const nyserda = w.winner!.rung.source === 'NYSERDA'
  const step = w.steps.find((st) => st.rungId === w.winner!.rung.id)
  const s = v.series
  const data: HeatingFuelData = {
    product,
    source: nyserda ? 'nyserda' : 'eia',
    seriesId: s.seriesId,
    geography: v.geography,
    current: s.current,
    latestDate: s.latestDate,
    baseline: s.baseline,
    baselineDate: s.baselineDate,
    change: s.change,
    series: s.series,
    ...(v.comparison ? { nationalSeries: v.comparison.series, nationalLabel: v.comparisonLabel } : {}),
    ...(v.offSeasonNote ? { offSeasonNote: v.offSeasonNote } : {}),
  }
  // Between survey seasons is the schedule (labeled), not staleness; an overdue series or a last-good copy is stale
  const stale = w.winner!.outcome.status === 'stale' && !step?.seasonal
  return wrap(data, nyserda ? 'nyserda-heating-oil' : `eia-heating-${product}`, v.fetchedAt ?? now, now, stale)
}

/** The attempt whose data is shown: the winner, or a final 'invalid' (its value is still passed on). */
function shown<V>(w: LadderResult<V>): Attempt<V> | undefined {
  if (w.winner) return w.winner
  return w.last?.outcome.value !== undefined ? w.last : undefined
}
