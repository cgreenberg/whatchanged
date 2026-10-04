// SOURCE-RESOLUTION LADDERS — the single source of truth for "which series does this zip get?"
//
// One ladder per metric: an ORDERED list of rungs, most local first. For a place, the first rung that
// applies and answers is the number shown (resolve.ts walks the ladder and records every rung's outcome
// as the `trace` returned by /api/data). getGasLookup() and getMetroCpiAreaForCounty() are thin
// wrappers over these ladders (first applicable rung), so the refresh plan, map, scripts and the live
// snapshot all agree. The About page ("How we pick your numbers") and docs/DATA_RESOLUTION.md
// (`npm run docs:ladders`) are generated from this file.
//
// Client-safe by design: rungs read mapping tables only. Fetching is injected through the
// LadderContext (server: cached BLS/EIA accessors + bundled static data; client: the county shard), so a
// static source's JSON is loaded by the context, never imported here.
//
// To add a rung: see "How to add a rung" in docs/DATA_RESOLUTION.md (generated from doc.ts).

import cbsaCrosswalk from '@/lib/data/cbsa-cpi-crosswalk.json'
import type { CachedResult } from '@/lib/cache/kv'
import type { CpiData, RentData } from '@/types'
import type { GeoLevel } from './types'
import { defineRung, firstApplicable, type Ladder, type LadderResult, type RungOutcome } from './resolve'
import {
  CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES, STATE_LEVEL_CODES, STATE_TO_PAD, PAD_NAMES, PAD_DUOAREA,
} from '@/lib/mappings/eia-gas'
import { BLS_GAS_STATE_AREA, isBlsGasMetro } from '@/lib/mappings/bls-gas'
import { BLS_CPI_AREAS, STATE_TO_DIVISION, STATE_TO_REGION } from '@/lib/mappings/county-metro-cpi'
import { describeDuoarea, isGasStale, type GasLookupResult, type GasSeriesData } from '@/lib/api/eia'
import { describeBlsGasArea } from '@/lib/api/bls-gas'
import { cpiSeriesIds } from '@/lib/api/bls-cpi'
import { hasElectricitySeries, electricitySeriesId, type ElectricitySeriesData } from '@/lib/api/eia-electricity'
import { CPI_CHANGE_RANGE } from '@/lib/api/validate'
import { isBlsPeriodStale, isElectricityPeriodStale, monthOlderThan, RENT_STALE_DAYS } from '@/lib/staleness'
import type { CountyRentLookup } from '@/lib/rent'

// ------------------------------------------------------------------ location + context

/** What a ladder resolves for (from the zip's ZipInfo). */
export interface LadderLocation {
  stateAbbr: string
  stateName?: string
  countyFips?: string
  countyName?: string
  /**
   * Gas only: the place's CPI area (first applicable CPI rung). EIA city and BLS metro gas prices follow
   * the BLS CPI metros, so the gas ladder reads the CPI ladder's static pick.
   */
  cpiAreaCode?: string
}

export type CpiArea = { areaCode: string; areaName: string; tier: 1 | 2 | 3 | 4 }

/** Fetchers injected by the caller. A rung only calls the one it needs. */
export interface LadderContext {
  now: Date
  gasSeries?(lookup: GasLookupResult): Promise<CachedResult<GasSeriesData>>
  cpi?(area: CpiArea): Promise<CachedResult<CpiData>>
  electricity?(state: string): Promise<CachedResult<ElectricitySeriesData>>
  /** Static (bundled) county rent: src/lib/data/county-rent.json via lookupCountyRent. */
  countyRent?(countyFips: string): CountyRentLookup
  /** Static county home values (client: the county shard). `null` = no series. */
  countyHomeValue?(countyFips: string): { asOf?: string } | null
  /** Resolve another metric's ladder for the same place (memoized by the caller). */
  ladder?(metric: MetricId): Promise<LadderResult<unknown>>
}

type L = LadderLocation
type C = LadderContext

// ------------------------------------------------------------------ helpers

const TERRITORY_NAMES: Record<string, string> = {
  PR: 'Puerto Rico', VI: 'the U.S. Virgin Islands', GU: 'Guam', AS: 'American Samoa', MP: 'the Northern Mariana Islands',
}
const up = (l: L) => (l.stateAbbr ?? '').toUpperCase()
/** "Maine", "Puerto Rico" (falls back to the state code). */
const stateLabel = (l: L) => TERRITORY_NAMES[up(l)] ?? l.stateName ?? (up(l) || 'this area')
/** "Androscoggin County, ME". */
const countyLabel = (l: L) => (l.countyName ? `${l.countyName}${up(l) ? `, ${up(l)}` : ''}` : 'this county')
const countyPlace = (l: L) => ({ name: countyLabel(l), level: 'county' as const })
const statePlace = (l: L) => ({ name: stateLabel(l), level: 'state' as const })
const countyOnly = (l: L) => l.countyName ?? 'this county'

const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

const STALE_REASON = "The source hasn't updated on schedule (or the latest refresh failed), so this is the last good data."

const blsSeriesUrl = (id: string) => `https://data.bls.gov/timeseries/${id}`

/** Distinct EIA city series (Cleveland's county override + CPI metros with an EIA city). */
const eiaCityCount = () =>
  new Set([...Object.values(CPI_TO_EIA_CITY), ...Object.values(COUNTY_EIA_CITY_OVERRIDES)].map((c) => c.duoarea)).size
const cpiMetroCount = () => Object.keys(BLS_CPI_AREAS).filter((c) => c.startsWith('S')).length
const blsGasMetroCount = () => Object.keys(BLS_CPI_AREAS).filter((c) => isBlsGasMetro(c)).length

// ------------------------------------------------------------------ gas

const EIA_GAS_HOME = 'https://www.eia.gov/petroleum/gasdiesel/'
const EIA_PADD_PAGE = 'https://www.eia.gov/petroleum/weekly/includes/padds.php'
const BLS_AVG_PRICE_HOME = 'https://www.bls.gov/cpi/factsheets/average-prices.htm'
const EIA_GAS_SOURCE = 'EIA weekly retail gasoline (regular)'
const BLS_GAS_SOURCE = 'BLS CPI average price, regular gasoline'

/** Display name for an EIA target: its label without " avg" ("New England (PADD 1A)", "Boston area"). */
const eiaGeo = (g: GasLookupResult) => (g.duoarea === 'NUS' ? 'United States' : g.geoLevel.replace(/ avg$/, ''))

async function resolveGas(lookup: GasLookupResult, ctx: C): Promise<RungOutcome<CachedResult<GasSeriesData>>> {
  const r = await ctx.gasSeries!(lookup)
  const latest = r.data.latestDate
  const stale = r.stale || (lookup.frequency === 'monthly'
    ? isBlsPeriodStale(latest, ctx.now)
    : isGasStale(latest ?? '', ctx.now.getTime()))
  return {
    status: stale ? 'stale' : 'used',
    value: r,
    asOf: latest,
    seriesId: lookup.seriesId,
    ...(stale ? { reason: STALE_REASON } : {}),
  }
}

const eiaGasRung = {
  source: 'EIA',
  sourceName: EIA_GAS_SOURCE,
  frequency: 'weekly',
  license: 'Public domain (U.S. government)',
  pipeline: 'live' as const,
  homepage: EIA_GAS_HOME,
  seriesId: (g: GasLookupResult) => g.seriesId,
  resolve: resolveGas,
  // A failed EIA series goes straight to the shared, always-warm U.S. average (same source).
  onUnavailable: 'last' as const,
}

const blsGasRung = {
  source: 'BLS',
  sourceName: BLS_GAS_SOURCE,
  frequency: 'monthly',
  license: 'Public domain (U.S. government)',
  pipeline: 'live' as const,
  homepage: BLS_AVG_PRICE_HOME,
  seriesId: (g: GasLookupResult) => g.seriesId,
  citationUrl: (g: GasLookupResult) => blsSeriesUrl(g.seriesId),
  resolve: resolveGas,
  // BLS outage: the zip's EIA weekly tier as a whole (local and national both EIA) — never BLS mixed with EIA.
  onUnavailable: 'next-source' as const,
}

const GAS = {
  metric: 'gas',
  title: 'Gas (regular)',
  comparison: 'U.S. average from the same source over the same weeks or months (EIA U.S. weekly, or the BLS U.S. city average).',
  rungs: [
    defineRung<L, GasLookupResult, CachedResult<GasSeriesData>, C>({
      ...eiaGasRung,
      id: 'gas.eia-city',
      label: 'EIA weekly city average',
      level: 'city',
      get covers() {
        const names = [...new Set([...Object.values(CPI_TO_EIA_CITY), ...Object.values(COUNTY_EIA_CITY_OVERRIDES)]
          .map((c) => c.label.replace(/ area avg$/, '')))]
        return `Counties in the ${names.length} metro areas EIA prices weekly (${names.join(', ')}).`
      },
      applies: (l) =>
        !!(l.countyFips && COUNTY_EIA_CITY_OVERRIDES[l.countyFips]) || !!(l.cpiAreaCode && CPI_TO_EIA_CITY[l.cpiAreaCode]) ||
        `EIA publishes weekly city prices for ${eiaCityCount()} metro areas; ${countyOnly(l)} isn't in one.`,
      target: (l) => {
        const city = (l.countyFips && COUNTY_EIA_CITY_OVERRIDES[l.countyFips]) || CPI_TO_EIA_CITY[l.cpiAreaCode!]
        return describeDuoarea(city.duoarea, city.label)
      },
      geography: eiaGeo,
      place: countyPlace,
      citationUrl: () => EIA_GAS_HOME,
    }),
    defineRung<L, GasLookupResult, CachedResult<GasSeriesData>, C>({
      ...blsGasRung,
      id: 'gas.bls-metro',
      label: 'BLS monthly metro average',
      level: 'metro',
      covers: 'Counties in a BLS CPI metro without an EIA city series (e.g. Philadelphia, Washington DC, Atlanta, Phoenix, Honolulu, Anchorage).',
      applies: (l) =>
        isBlsGasMetro(l.cpiAreaCode) ||
        `BLS publishes monthly gas prices for ${blsGasMetroCount()} metro areas; ${countyOnly(l)} isn't in one.`,
      target: (l) => describeBlsGasArea(l.cpiAreaCode!),
      geography: (g) => `${g.areaName} metro`,
      place: countyPlace,
    }),
    defineRung<L, GasLookupResult, CachedResult<GasSeriesData>, C>({
      ...blsGasRung,
      id: 'gas.bls-hiak-standin',
      label: 'Honolulu / Anchorage price as a stand-in',
      pill: 'HI/AK stand-in',
      level: 'metro',
      covers: 'Hawaii and Alaska outside the Honolulu and Anchorage metros: neither EIA nor BLS publishes a closer gas price, so that metro’s BLS price stands in, marked “*”.',
      applies: (l) => !!BLS_GAS_STATE_AREA[up(l)] || 'Only used in Hawaii and Alaska outside the Honolulu and Anchorage metros.',
      target: (l) => describeBlsGasArea(BLS_GAS_STATE_AREA[up(l)], { standIn: true }),
      geography: (g) => `${g.areaName} metro (stand-in)`,
      place: statePlace,
      usedNote: (g, l) =>
        `No BLS or EIA gas series covers ${countyOnly(l)}; the ${g.areaName} price stands in. Local prices are typically higher and may have changed differently.`,
    }),
    defineRung<L, GasLookupResult, CachedResult<GasSeriesData>, C>({
      ...eiaGasRung,
      id: 'gas.eia-state',
      label: 'EIA weekly state average',
      level: 'state',
      get covers() {
        const states = Object.keys(STATE_LEVEL_CODES).sort()
        return `The ${states.length} states EIA prices weekly: ${states.join(', ')}.`
      },
      applies: (l) =>
        !!STATE_LEVEL_CODES[up(l)] ||
        `EIA publishes weekly state averages for ${Object.keys(STATE_LEVEL_CODES).length} states; ${stateLabel(l)} isn't one.`,
      target: (l) => {
        const s = STATE_LEVEL_CODES[up(l)]
        return describeDuoarea(s.duoarea, s.label)
      },
      geography: eiaGeo,
      place: statePlace,
      citationUrl: () => EIA_GAS_HOME,
    }),
    defineRung<L, GasLookupResult, CachedResult<GasSeriesData>, C>({
      ...eiaGasRung,
      id: 'gas.eia-padd',
      label: 'EIA weekly regional (PADD) average',
      level: 'padd',
      covers: 'Everywhere else in the 50 states + DC: the PADD region (PADD 1 split into New England, Central Atlantic, Lower Atlantic; PADD 5 = West Coast excluding California).',
      applies: (l) => {
        const st = up(l)
        if (BLS_GAS_STATE_AREA[st]) return `EIA's West Coast average doesn't reflect ${stateLabel(l)} prices, so it isn't used.`
        return STATE_TO_PAD[st] !== undefined || `${stateLabel(l)} isn't in an EIA PADD region.`
      },
      target: (l) => {
        const pad = STATE_TO_PAD[up(l)]
        return describeDuoarea(PAD_DUOAREA[pad] ?? `R${pad}0`, `${PAD_NAMES[pad]} avg`)
      },
      geography: eiaGeo,
      place: statePlace,
      citationUrl: () => EIA_PADD_PAGE,
    }),
    defineRung<L, GasLookupResult, CachedResult<GasSeriesData>, C>({
      ...eiaGasRung,
      id: 'gas.eia-national',
      label: 'EIA weekly U.S. average',
      level: 'national',
      covers: 'Territories (no EIA series), and any place whose local series is down — then labeled “U.S. avg (local n/a)”.',
      applies: () => true,
      target: () => describeDuoarea('NUS'),
      geography: () => 'United States',
      citationUrl: () => EIA_PADD_PAGE,
      usedNote: (_g, l) => (TERRITORY_NAMES[up(l)] ? `EIA publishes no gas price for ${stateLabel(l)}; this is the U.S. average.` : undefined),
    }),
  ],
} satisfies Ladder<L, CachedResult<GasSeriesData>, C>

// ------------------------------------------------------------------ CPI (groceries, shelter)

type CpiItem = 'groceries' | 'shelter'
const CPI_ITEM_NAMES: Record<CpiItem, { source: string; short: string }> = {
  groceries: { source: 'BLS CPI food at home', short: 'food at home' },
  shelter: { source: 'BLS CPI shelter', short: 'shelter' },
}

const cpiGeo = (a: CpiArea) =>
  a.tier === 4 ? 'United States (U.S. city average)'
    : a.tier === 3 ? `${a.areaName.replace(/ Urban$/, '')} region`
      : a.tier === 2 ? `${a.areaName} division`
        : `${a.areaName} metro`

const cpiLevel = (a: CpiArea): GeoLevel =>
  a.tier === 4 ? 'national' : a.tier === 3 ? 'region' : a.tier === 2 ? 'division' : 'metro'

/** Groceries and shelter come from one CPI fetch per area; each item checks its own value. */
function cpiResolver(item: CpiItem) {
  return async (area: CpiArea, ctx: C): Promise<RungOutcome<CachedResult<CpiData>>> => {
    const r = await ctx.cpi!(area)
    const d = r.data
    const seriesId = d.seriesIds?.[item] ?? cpiSeriesIds(area.areaCode)[item]
    const change = item === 'groceries' ? d.groceriesChange : d.shelterChange
    const latest = item === 'groceries' ? d.groceriesLatestPeriod : d.shelterLatestPeriod
    if (!inRange(change, CPI_CHANGE_RANGE)) {
      // The area answered: no other area is swapped in for one item (the card shows "Data unavailable").
      return {
        status: 'invalid',
        final: true,
        value: r,
        seriesId,
        reason: change === undefined
          ? `BLS has no usable ${CPI_ITEM_NAMES[item].short} value for this area right now.`
          : `The ${CPI_ITEM_NAMES[item].short} change is outside our sanity range (−20% to +50%).`,
      }
    }
    const stale = r.stale || isBlsPeriodStale(latest, ctx.now)
    return { status: stale ? 'stale' : 'used', value: r, asOf: latest, seriesId, ...(stale ? { reason: STALE_REASON } : {}) }
  }
}

function cpiRungs(item: CpiItem) {
  const base = {
    source: 'BLS',
    sourceName: CPI_ITEM_NAMES[item].source,
    frequency: 'monthly (bimonthly for some metros)',
    license: 'Public domain (U.S. government)',
    pipeline: 'live' as const,
    homepage: 'https://www.bls.gov/cpi/',
    seriesId: (a: CpiArea) => cpiSeriesIds(a.areaCode)[item],
    citationUrl: (a: CpiArea) => blsSeriesUrl(cpiSeriesIds(a.areaCode)[item]),
    geography: cpiGeo,
    resolve: cpiResolver(item),
    // A failed local area goes straight to the shared U.S. city average, labeled "U.S. avg (local n/a)".
    onUnavailable: 'last' as const,
  }
  return [
    defineRung<L, CpiArea, CachedResult<CpiData>, C>({
      ...base,
      id: `${item}.bls-cpi-metro`,
      label: 'BLS CPI metro area',
      level: 'metro',
      // A getter: this module is imported by the mapping modules it reads, so nothing here touches them at load time.
      get covers() {
        return `Counties in one of the ${cpiMetroCount()} metro areas BLS prices separately (the exact 2013 OMB counties BLS samples).`
      },
      applies: (l) => {
        const code = l.countyFips ? (cbsaCrosswalk as Record<string, string>)[l.countyFips] : undefined
        return (!!code && !!BLS_CPI_AREAS[code]) ||
          `BLS publishes its own CPI for ${cpiMetroCount()} metro areas; ${countyOnly(l)} isn't in one.`
      },
      target: (l) => {
        const code = (cbsaCrosswalk as Record<string, string>)[l.countyFips!]
        return { areaCode: code, areaName: BLS_CPI_AREAS[code].name, tier: 1 }
      },
      place: countyPlace,
    }),
    defineRung<L, CpiArea, CachedResult<CpiData>, C>({
      ...base,
      id: `${item}.bls-cpi-division`,
      label: 'BLS CPI Census division',
      level: 'division',
      covers: 'Everywhere else in the 50 states + DC: the state’s Census division (e.g. New England, Mountain).',
      applies: (l) => !!STATE_TO_DIVISION[up(l)] || `BLS publishes no Census-division CPI for ${stateLabel(l)}.`,
      target: (l) => {
        const d = STATE_TO_DIVISION[up(l)]
        return { areaCode: d.code, areaName: d.name, tier: 2 }
      },
      place: statePlace,
    }),
    defineRung<L, CpiArea, CachedResult<CpiData>, C>({
      ...base,
      id: `${item}.bls-cpi-region`,
      label: 'BLS CPI Census region',
      level: 'region',
      covers: 'Defensive only: every state has a division.',
      applies: (l) => {
        const code = STATE_TO_REGION[up(l)]
        return (!!code && !!BLS_CPI_AREAS[code]) || `BLS publishes no regional CPI for ${stateLabel(l)}.`
      },
      target: (l) => {
        const code = STATE_TO_REGION[up(l)]
        return { areaCode: code, areaName: BLS_CPI_AREAS[code].name, tier: 3 }
      },
      place: statePlace,
    }),
    defineRung<L, CpiArea, CachedResult<CpiData>, C>({
      ...base,
      id: `${item}.bls-cpi-national`,
      label: 'BLS CPI U.S. city average',
      level: 'national',
      covers: 'Territories (BLS publishes no local CPI), and any place whose local CPI is down — then labeled “U.S. avg (local n/a)”.',
      applies: () => true,
      target: (): CpiArea => ({ areaCode: '0000', areaName: 'National', tier: 4 }),
      usedNote: (_a, l) => (TERRITORY_NAMES[up(l)] ? `BLS publishes no local CPI for ${stateLabel(l)}; this is the U.S. city average.` : undefined),
    }),
  ]
}

const GROCERIES = {
  metric: 'groceries',
  title: 'Groceries',
  comparison: 'BLS U.S. city average food at home over the same months.',
  rungs: cpiRungs('groceries'),
} satisfies Ladder<L, CachedResult<CpiData>, C>

const SHELTER = {
  metric: 'shelter',
  title: 'Shelter (CPI)',
  comparison: 'BLS U.S. city average shelter over the same months.',
  rungs: cpiRungs('shelter'),
} satisfies Ladder<L, CachedResult<CpiData>, C>

// ------------------------------------------------------------------ rent (the housing card)

const ZILLOW_HOME = 'https://www.zillow.com/research/data/'
const ZILLOW_LICENSE = 'Zillow Research data; attribution required'

const RENT = {
  metric: 'rent',
  title: 'Rent (housing card)',
  rungs: [
    defineRung<L, string, RentData, C>({
      id: 'rent.zillow-county',
      label: 'Zillow county rent (new leases)',
      source: 'Zillow',
      sourceName: 'Zillow Observed Rent Index (ZORI)',
      level: 'county',
      frequency: 'monthly',
      license: ZILLOW_LICENSE,
      pipeline: 'static',
      homepage: ZILLOW_HOME,
      covers: 'Counties where Zillow’s rent series reaches back to January 2025 with enough history (3+ years) to remove seasonal swings.',
      applies: (l) => (!!l.countyFips && /^\d{5}$/.test(l.countyFips)) || 'No county is known for this zip.',
      target: (l) => l.countyFips!,
      geography: (_f, l) => countyLabel(l),
      place: countyPlace,
      resolve: (fips, ctx, l) => {
        const r = ctx.countyRent!(fips)
        if (r.data) {
          const stale = monthOlderThan(r.data.asOf, RENT_STALE_DAYS, ctx.now)
          return { status: stale ? 'stale' : 'used', value: r.data, asOf: r.data.asOf, ...(stale ? { reason: STALE_REASON } : {}) }
        }
        return {
          status: r.why === 'out-of-range' ? 'invalid' : 'not-applicable',
          reason: r.why === 'out-of-range'
            ? `Zillow's figure for ${countyOnly(l)} is outside our sanity range (−20% to +50%), so it isn't shown.`
            : `Zillow has no rent series for ${countyOnly(l)} with enough history (data back to Jan 2025, and 3+ years to remove seasonal swings).`,
        }
      },
    }),
    defineRung<L, CpiArea, unknown, C>({
      id: 'rent.bls-cpi-shelter',
      label: 'BLS shelter (CPI)',
      pill: 'CPI shelter (metro → U.S.)',
      source: 'BLS',
      sourceName: 'BLS CPI shelter',
      level: 'metro',
      frequency: 'monthly',
      license: 'Public domain (U.S. government)',
      pipeline: 'live',
      homepage: 'https://www.bls.gov/cpi/',
      covers: 'Where Zillow has no county rent: the Shelter (CPI) card, resolved by the shelter ladder (metro → division → region → U.S.).',
      applies: () => true,
      // The area the shelter ladder picks when BLS answers (its first applicable rung).
      target: (l) => firstApplicable(SHELTER, l)!.target as CpiArea,
      geography: cpiGeo,
      levelOf: cpiLevel,
      citationUrl: (a) => blsSeriesUrl(cpiSeriesIds(a.areaCode).shelter),
      seriesId: (a) => cpiSeriesIds(a.areaCode).shelter,
      resolve: async (_a, ctx) => {
        const w = await ctx.ladder!('shelter')
        const step = w.winner && w.steps.find((s) => s.rungId === w.winner!.rung.id)
        if (w.winner && step) {
          return {
            status: w.winner.outcome.status,
            value: w.winner.outcome.value,
            asOf: step.asOf,
            seriesId: step.seriesId,
            geography: step.geography,
            citationUrl: step.citationUrl,
            reason: step.reason,
          }
        }
        const failed = w.last && w.steps.find((s) => s.rungId === w.last!.rung.id)
        return { status: 'unavailable', reason: failed?.reason ?? 'BLS shelter CPI is unavailable for this area right now.' }
      },
    }),
  ],
} satisfies Ladder<L, unknown, C>

// ------------------------------------------------------------------ electricity

const ELECTRICITY = {
  metric: 'electricity',
  title: 'Electricity',
  comparison: 'EIA U.S. average, same seasonal adjustment and months.',
  noData: 'Territories: EIA publishes no residential price, so the card says “Data unavailable” with the reason.',
  rungs: [
    defineRung<L, string, CachedResult<ElectricitySeriesData>, C>({
      id: 'electricity.eia-state',
      label: 'EIA statewide residential price',
      source: 'EIA',
      sourceName: 'EIA average residential electricity price',
      level: 'state',
      frequency: 'monthly (about two months behind)',
      license: 'Public domain (U.S. government)',
      pipeline: 'live',
      homepage: 'https://www.eia.gov/electricity/data/browser/',
      covers: 'The 50 states + DC (statewide average across utilities; no county or metro series exists).',
      applies: (l) => hasElectricitySeries(l.stateAbbr) || `EIA publishes no residential electricity price for ${stateLabel(l)}.`,
      target: (l) => up(l),
      geography: (_st, l) => `${stateLabel(l)} (statewide)`,
      place: statePlace,
      seriesId: (st) => electricitySeriesId(st),
      resolve: async (st, ctx) => {
        const r = await ctx.electricity!(st)
        const stale = r.stale || isElectricityPeriodStale(r.data.latestPeriod, ctx.now)
        return { status: stale ? 'stale' : 'used', value: r, asOf: r.data.latestPeriod, ...(stale ? { reason: STALE_REASON } : {}) }
      },
    }),
  ],
} satisfies Ladder<L, CachedResult<ElectricitySeriesData>, C>

// ------------------------------------------------------------------ home prices (Housing graph tab)

const HOME_PRICES = {
  metric: 'homePrices',
  title: 'Home prices (Housing graph)',
  noData: 'The Housing graph’s Home prices tab is disabled, with a note.',
  rungs: [
    defineRung<L, string, { asOf?: string }, C>({
      id: 'homePrices.zillow-county',
      label: 'Zillow county home values',
      source: 'Zillow',
      sourceName: 'Zillow Home Value Index (ZHVI)',
      level: 'county',
      frequency: 'monthly',
      license: ZILLOW_LICENSE,
      pipeline: 'static',
      homepage: ZILLOW_HOME,
      covers: 'Counties with a Zillow typical-home-value series reaching back to January 2025.',
      applies: (l) => (!!l.countyFips && /^\d{5}$/.test(l.countyFips)) || 'No county is known for this zip.',
      target: (l) => l.countyFips!,
      geography: (_f, l) => countyLabel(l),
      place: countyPlace,
      resolve: (fips, ctx, l) => {
        const v = ctx.countyHomeValue!(fips)
        if (!v) return { status: 'not-applicable', reason: `Zillow has no home value series for ${countyOnly(l)} back to Jan 2025.` }
        const stale = monthOlderThan(v.asOf, RENT_STALE_DAYS, ctx.now)
        return { status: stale ? 'stale' : 'used', value: v, asOf: v.asOf, ...(stale ? { reason: STALE_REASON } : {}) }
      },
    }),
  ],
} satisfies Ladder<L, { asOf?: string }, C>

// ------------------------------------------------------------------ registry

export const LADDERS = {
  gas: GAS,
  rent: RENT,
  groceries: GROCERIES,
  shelter: SHELTER,
  electricity: ELECTRICITY,
  homePrices: HOME_PRICES,
} as const

export type MetricId = keyof typeof LADDERS

/** Display order (About page, docs). */
export const LADDER_ORDER: MetricId[] = ['gas', 'rent', 'shelter', 'homePrices', 'groceries', 'electricity']

/** Short pill text for a geography level. */
export const LEVEL_LABELS: Record<GeoLevel, string> = {
  zip: 'Zip', city: 'City', county: 'County', metro: 'Metro', state: 'State', division: 'Census division',
  region: 'Census region', padd: 'PADD region', national: 'U.S.', island: 'Island', community: 'Community',
}

// ------------------------------------------------------------------ static picks (no fetching)

/** The CPI area a county resolves to when BLS answers: first applicable CPI rung. */
export function selectCpiArea(countyFips: string, stateAbbr: string): CpiArea {
  return firstApplicable(GROCERIES, { countyFips, stateAbbr })!.target as CpiArea
}

/**
 * The gas series a place resolves to when every source answers: first applicable gas rung.
 * `eiaOnly`: the BLS-outage fallback (first applicable EIA rung) — what the refresh plan also warms.
 */
export function selectGasLookup(loc: LadderLocation, opts: { eiaOnly?: boolean } = {}): GasLookupResult {
  const hit = firstApplicable(GAS, loc, (r) => !opts.eiaOnly || r.source === 'EIA')
  return hit!.target as GasLookupResult
}

/** Rung ids of the national (last) rung of each ladder that has one: an outage stand-in when used after a failure. */
export const isNationalRung = (rungId: string | undefined) => !!rungId && /-national$/.test(rungId)
