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
import type { CensusData, CpiData, RentData } from '@/types'
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
import { rentRangeText } from '@/lib/rent-range'
import { fmtRentFigure } from '@/lib/compute/dollar-translations'
import type { StaticGasLookup } from '@/lib/static-gas'
import {
  DCRA_SOURCE, DCRA_PUBLISHER, DCRA_LICENSE, DCRA_DATA_URL, DCRA_HOME, DCRA_STALE_DAYS,
  DACO_SOURCE, DACO_PUBLISHER, DACO_HOME, DACO_DATA_URL, DACO_STALE_DAYS, dcraStationsText,
} from '@/lib/static-gas-meta'
import {
  HEATING_STATES, hasHeatingSeries, isValidHeating, heatingSeriesId, heatingSeriesUrl, heatingSeasonStatus, NATIONAL_HEATING,
  type HeatingProduct, type HeatingSeriesData,
} from '@/lib/api/eia-heating'
import { nyserdaSeries, NYSERDA_DATASET_URL, NYSERDA_PAGE, NYSERDA_STALE_DAYS, type NyserdaHeatingOil } from '@/lib/api/nyserda'
import { nyserdaRegionForCounty, NYSERDA_STATEWIDE_COLUMN, type NyserdaRegion } from '@/lib/mappings/nyserda-regions'

// ------------------------------------------------------------------ location + context

/** What a ladder resolves for (from the zip's ZipInfo). */
export interface LadderLocation {
  /** The zip itself (rungs keyed by zip: the Alaska community survey). */
  zip?: string
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
  /** Static metro rent for a county without a county series: src/lib/data/metro-rent.json via lookupMetroRent. */
  metroRent?(countyFips: string, countyName?: string): CountyRentLookup
  /** Static Census ACS median gross rent basis for a zip (src/lib/data/census-acs.ts getCensusData). */
  censusRent?(zip: string): CensusData
  /** Static gas: Alaska DCRA community survey by zip / Puerto Rico DACO (src/lib/static-gas.ts). */
  akGas?(zip: string): StaticGasLookup
  prGas?(): StaticGasLookup
  /** EIA SHOPP weekly residential heating oil / propane for a state or 'US'. */
  heating?(product: HeatingProduct, area: string): Promise<CachedResult<HeatingSeriesData>>
  /** NYSERDA New York heating oil, every region. */
  nyserda?(): Promise<CachedResult<NyserdaHeatingOil>>
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

/** Gas ladder value: the cached series, plus the lookup when a static rung (no cache key) produced it. */
export type GasRungValue = CachedResult<GasSeriesData> & { lookup?: GasLookupResult; staticHit?: StaticHitInfo }
export type StaticHitInfo = {
  kind: 'dcra' | 'daco'; match?: 'community' | 'nearest' | 'region'; place: string; km?: number; stations?: number; retailer?: string
}

/** A static gas series (bundled): used unless its latest survey/month is overdue. */
function staticGasOutcome(kind: 'dcra' | 'daco', r: StaticGasLookup, now: Date, l: L): RungOutcome<GasRungValue> {
  if (!r.hit) {
    return {
      status: 'not-applicable',
      reason: kind === 'dcra'
        ? `No DCRA survey community or region average covers ${countyOnly(l)}.`
        : 'DACO has no usable Puerto Rico series right now.',
    }
  }
  const h = r.hit
  const stale = monthOlderThan(h.data.latestDate.slice(0, 7), kind === 'dcra' ? DCRA_STALE_DAYS : DACO_STALE_DAYS, now)
  const geography = kind === 'daco'
    ? { name: 'Puerto Rico (island-wide)', level: 'island' as const }
    : h.match === 'region'
      ? { name: `${h.place} Alaska region (DCRA average)`, level: 'region' as const }
      : { name: h.match === 'nearest' ? `${h.place} (nearest surveyed community${h.km !== undefined ? `, ${h.km} km` : ''})` : h.place, level: 'community' as const }
  const stationsNote = kind === 'dcra' && h.match !== 'region' ? ` ${dcraStationsText(h.place, h.stations, h.retailer)}` : ''
  const note = kind === 'dcra' && h.match === 'nearest'
    ? `DCRA doesn't survey ${l.countyName ? `this zip's town` : 'this town'}; ${h.place} is the nearest surveyed community in ${countyOnly(l)}.${stationsNote}`
    : kind === 'dcra' && h.match === 'region'
      ? `No usable surveyed community near this zip in ${countyOnly(l)}; this is DCRA's ${h.place} region average.`
      : kind === 'dcra'
        ? stationsNote.trim()
        : undefined
  return {
    status: stale ? 'stale' : 'used',
    value: {
      data: h.data, cacheHit: true, stale: false, fetchedAt: now.toISOString(), lookup: h.lookup,
      staticHit: {
        kind, ...(h.match ? { match: h.match } : {}), place: h.place, ...(h.km !== undefined ? { km: h.km } : {}),
        ...(h.stations !== undefined ? { stations: h.stations } : {}), ...(h.retailer ? { retailer: h.retailer } : {}),
      },
    },
    asOf: h.data.latestDate,
    seriesId: h.lookup.seriesId,
    geography,
    ...(stale ? { reason: STALE_REASON } : note ? { reason: note } : {}),
  }
}

const GAS = {
  metric: 'gas',
  title: 'Gas (regular)',
  comparison: 'U.S. average from the same source over the same weeks or months (EIA U.S. weekly, or the BLS U.S. city average); none for the Alaska survey or Puerto Rico DACO, which publish no U.S. figure.',
  method:
    'Change in $/gal of the prices as shown (each rounded to the cent). Baseline: EIA weekly, the last reading on or before ' +
    'Jan 20, 2025; BLS and DACO monthly, January 2025; Alaska DCRA, the January 2025 survey (a January vs July survey compares ' +
    'different seasons; past surveys show no consistent gap). DCRA community figures can rest on a single retailer\'s price ' +
    '(the ⓘ says how many stations). Not seasonally adjusted. Where EIA publishes a weekly state average (9 states), it is ' +
    'preferred over BLS\'s monthly metro price so all of the state\'s zips are on the same weekly basis. Elsewhere in Hawaii ' +
    '(and Alaska zips the survey doesn\'t cover) the Honolulu or Anchorage price stands in, marked “*” (e.g. “Honolulu-area*”).',
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
      covers: 'Counties in a BLS CPI metro without an EIA city series, in states without an EIA weekly state average (e.g. Philadelphia, Washington DC, Atlanta, Detroit, Phoenix, St. Louis, Honolulu, Anchorage). In the states EIA prices weekly, the weekly state average is used instead, so every zip in the state is on the same weekly basis.',
      applies: (l) => {
        if (!isBlsGasMetro(l.cpiAreaCode)) {
          return `BLS publishes monthly gas prices for ${blsGasMetroCount()} metro areas; ${countyOnly(l)} isn't in one.`
        }
        // A weekly EIA state series exists: prefer it, so neighboring zips in one state never mix a monthly
        // metro figure (weeks older, a different U.S. comparison) with the weekly state figure.
        return !STATE_LEVEL_CODES[up(l)] ||
          `EIA publishes a weekly ${stateLabel(l)} average; it is used instead of BLS's monthly metro price so every ${stateLabel(l)} zip is compared on the same weekly basis.`
      },
      target: (l) => describeBlsGasArea(l.cpiAreaCode!),
      geography: (g) => `${g.areaName} metro`,
      place: countyPlace,
    }),
    defineRung<L, string, GasRungValue, C>({
      id: 'gas.dcra-community',
      label: 'Alaska community fuel survey',
      pill: 'AK community survey',
      source: 'DCRA',
      sourceName: `${DCRA_SOURCE} (${DCRA_PUBLISHER})`,
      level: 'community',
      frequency: 'twice yearly (January and July surveys)',
      license: `${DCRA_LICENSE} (attribution: ${DCRA_PUBLISHER})`,
      pipeline: 'static',
      homepage: DCRA_HOME,
      covers: 'Alaska outside the Anchorage metro: the zip’s own surveyed community, else the nearest surveyed community in the same borough or census area (within 100 km), else the DCRA region average — labeled which.',
      applies: (l) => {
        if (up(l) !== 'AK') return 'The Alaska DCRA community survey covers Alaska only.'
        return !isBlsGasMetro(l.cpiAreaCode) || 'Anchorage-area zips use BLS’s monthly Anchorage price.'
      },
      target: (l) => l.zip ?? '',
      geography: () => 'Alaska community survey',
      place: statePlace,
      citationUrl: () => DCRA_DATA_URL,
      resolve: (zip, ctx, l) => staticGasOutcome('dcra', ctx.akGas!(zip), ctx.now, l),
    }),
    defineRung<L, GasLookupResult, CachedResult<GasSeriesData>, C>({
      ...blsGasRung,
      id: 'gas.bls-hiak-standin',
      label: 'Honolulu / Anchorage price as a stand-in',
      pill: 'HI/AK stand-in',
      level: 'metro',
      covers: 'Hawaii outside the Honolulu metro (and Alaska zips the community survey doesn’t cover): neither EIA nor BLS publishes a closer gas price, so that metro’s BLS price stands in, marked “*”.',
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
    defineRung<L, string, GasRungValue, C>({
      id: 'gas.daco-pr',
      label: 'Puerto Rico monthly average (DACO)',
      pill: 'Puerto Rico (island)',
      source: 'DACO',
      sourceName: `${DACO_SOURCE} (${DACO_PUBLISHER})`,
      level: 'island',
      frequency: 'monthly',
      license: 'Public data of the Government of Puerto Rico (DACO); cited',
      pipeline: 'static',
      homepage: DACO_HOME,
      covers: 'Puerto Rico: DACO’s island-wide monthly average retail price of regular gasoline (EIA and BLS publish none).',
      applies: (l) => up(l) === 'PR' || 'DACO publishes Puerto Rico prices only.',
      target: () => 'PR',
      geography: () => 'Puerto Rico (island-wide)',
      place: statePlace,
      citationUrl: () => DACO_DATA_URL,
      resolve: (_t, ctx, l) => staticGasOutcome('daco', ctx.prGas!(), ctx.now, l),
    }),
    defineRung<L, GasLookupResult, CachedResult<GasSeriesData>, C>({
      ...eiaGasRung,
      id: 'gas.eia-national',
      label: 'EIA weekly U.S. average',
      level: 'national',
      covers: 'Territories other than Puerto Rico (no EIA series), and any place whose local series is down — then labeled “U.S. avg (local n/a)”.',
      applies: () => true,
      target: () => describeDuoarea('NUS'),
      geography: () => 'United States',
      citationUrl: () => EIA_PADD_PAGE,
      usedNote: (_g, l) => (TERRITORY_NAMES[up(l)] ? `EIA publishes no gas price for ${stateLabel(l)}; this is the U.S. average.` : undefined),
    }),
  ],
} satisfies Ladder<L, GasRungValue, C>

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
  method:
    '% change of the CPI food-at-home index since January 2025 (or the nearest earlier month an area publishes). ' +
    'Not seasonally adjusted. ≈ $/yr = $6,000/yr typical household food-at-home spending × that %; no $ where only the ' +
    'U.S. CPI applies (national fallback, Puerto Rico and other territories), because a U.S. change is not a local cost.',
  rungs: cpiRungs('groceries'),
} satisfies Ladder<L, CachedResult<CpiData>, C>

const SHELTER = {
  metric: 'shelter',
  title: 'Shelter (CPI)',
  comparison: 'BLS U.S. city average shelter over the same months.',
  method:
    '% change of the CPI shelter index (rents plus owners\' equivalent rent, existing leases included, so it lags new-lease ' +
    'rents) since January 2025. Not seasonally adjusted. Its ≈ $/yr in rent = the same area\'s CPI rent of primary residence ' +
    '% × the local Census ACS median gross rent × 12 (no $ where only the U.S. CPI applies, or the rent index fails its ' +
    'sanity check). Where Census suppresses a zip\'s rent, the rent base is borrowed and labeled: the nearest zip in the ' +
    'county with a Census rent, else the county median, else the state median.',
  rungs: cpiRungs('shelter'),
} satisfies Ladder<L, CachedResult<CpiData>, C>

// ------------------------------------------------------------------ rent (the housing card)

const ZILLOW_HOME = 'https://www.zillow.com/research/data/'
const ZILLOW_LICENSE = 'Zillow Research data; attribution required'

/** Why the metro series stands in, with the county's true reason. */
function metroStandInReason(why: RentData['countyWhy'], county: string): string {
  if (why === 'too-new') return `Zillow's series for ${county} is too new to measure since Jan 2025; its metro’s series stands in.`
  if (why === 'no-baseline') return `Zillow's series for ${county} has no Jan 2025 value; its metro’s series stands in.`
  return `Zillow publishes no rent series for ${county}; its metro’s series stands in.`
}

const RENT = {
  metric: 'rent',
  title: 'Rent (housing card)',
  method:
    '% change of Zillow\'s typical asking rent on new leases since January 2025, seasonally adjusted by whatchanged ' +
    '(classical decomposition; seasonal factors use only months whose full 13-month window ends by December 2024, so ' +
    'nothing after the baseline shapes them). A series too short to estimate its own seasonal pattern uses a pooled one ' +
    '(its state\'s counties, or U.S. counties where the state has too few) and says so. ≈ $/mo = today\'s typical rent − ' +
    'today\'s rent ÷ (1 + %). Changes outside −20% to +50% are not shown; a county\'s own unusual figure is tagged ' +
    '“⚠ unusual”, and an unusual metro figure never stands in for a county.',
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
      covers: 'Counties where Zillow’s rent series reaches back to January 2025 (seasonal swings removed; a series too short to estimate its own pattern uses a pooled one — its state’s counties, or U.S. counties where the state has too few — and says so).',
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
            ? `Zillow's figure for ${countyOnly(l)} is outside the plausible range (${rentRangeText()}), so it isn't shown.`
            : r.why === 'too-new'
              ? `Zillow's series for ${countyOnly(l)} is too new (it needs data from Jan 2024) to measure since Jan 2025.`
              : r.why === 'no-baseline'
                ? `Zillow's series for ${countyOnly(l)} has no Jan 2025 value, so its change since Jan 2025 can't be measured.`
                : `Zillow publishes no rent series for ${countyOnly(l)}.`,
        }
      },
    }),
    defineRung<L, string, RentData, C>({
      id: 'rent.zillow-metro',
      label: 'Zillow metro rent (new leases)',
      source: 'Zillow',
      sourceName: 'Zillow Observed Rent Index (ZORI), metro',
      level: 'metro',
      frequency: 'monthly',
      license: ZILLOW_LICENSE,
      pipeline: 'static',
      homepage: ZILLOW_HOME,
      covers: 'Counties without a Zillow county series, in a metro Zillow publishes back to January 2025: that metro’s series (OMB 2020 metro areas, the definitions Zillow uses; county-to-metro by FIPS code, never by name).',
      applies: (l) => (!!l.countyFips && /^\d{5}$/.test(l.countyFips)) || 'No county is known for this zip.',
      target: (l) => l.countyFips!,
      // The metro's name comes from the data (the used row overrides this); otherwise the county checked
      geography: (_f, l) => `${countyLabel(l)}’s metro area`,
      place: countyPlace,
      resolve: (fips, ctx, l) => {
        const r = ctx.metroRent!(fips, l.countyName)
        if (r.data) {
          const stale = monthOlderThan(r.data.asOf, RENT_STALE_DAYS, ctx.now)
          return {
            status: stale ? 'stale' : 'used',
            value: r.data,
            asOf: r.data.asOf,
            geography: { name: r.data.geoName, level: 'metro' },
            reason: stale ? STALE_REASON : metroStandInReason(r.data.countyWhy, countyOnly(l)),
          }
        }
        return {
          status: r.why === 'out-of-range' || r.why === 'flagged' ? 'invalid' : 'not-applicable',
          reason: r.why === 'out-of-range'
            ? `Zillow's metro figure for ${countyOnly(l)} is outside the plausible range (${rentRangeText()}), so it isn't shown.`
            : r.why === 'flagged'
              ? `Zillow's figure for ${countyOnly(l)}’s metro is a statistical outlier among U.S. areas (often a shift in which homes are listed, not in rents), so it doesn't stand in for the county.`
              : `${countyOnly(l)} isn't in a metro with a Zillow rent series back to Jan 2025.`,
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
      covers: 'Where Zillow has no county or metro rent: the Shelter (CPI) card, resolved by the shelter ladder (metro → division → region → U.S.).',
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
  comparison: 'EIA U.S. average, same method and the same 12-month windows.',
  method:
    'The big number is the average of the latest 12 published monthly prices (¢/kWh); the % compares it with the average ' +
    'of the 12 months ending January 2025 (Feb 2024–Jan 2025). Residential prices swing with the seasons (summer often ' +
    'well above winter), so single months mostly measure the calendar; full years count every season once, no seasonal ' +
    'model needed. ≈ $/mo = change in the 12-month average price × the state\'s average home use (residential sales ÷ ' +
    'customers, latest 12 months).',
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
  method:
    '% change of Zillow\'s typical home value (smoothed and seasonally adjusted by Zillow) since January 2025.',
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

// ------------------------------------------------------------------ home heating fuel (Home heating graph)

/** A heating rung's value: the local series, its same-source comparison, and the off-season note. */
export interface HeatingRungValue {
  series: HeatingSeriesData
  /** Same source, same weeks: EIA U.S. average, or the NYSERDA statewide average for a NY region. */
  comparison?: HeatingSeriesData
  comparisonLabel: string
  geography: string
  offSeasonNote?: string
  /** When the cached series was fetched upstream. */
  fetchedAt?: string
}

const HEATING_NAMES: Record<HeatingProduct, string> = { oil: 'heating oil', propane: 'propane' }
const EIA_SHOPP_HOME = 'https://www.eia.gov/petroleum/heatingoilpropane/'

function shoppRung(product: HeatingProduct) {
  const name = HEATING_NAMES[product]
  return defineRung<L, string, HeatingRungValue, C>({
    id: `${product === 'oil' ? 'heatingOil' : 'propane'}.eia-shopp-state`,
    label: `EIA weekly ${name} (state)`,
    source: 'EIA',
    sourceName: `EIA State Heating Oil and Propane Program (SHOPP), residential ${name}`,
    level: 'state',
    frequency: 'weekly, October–March only (heating-season survey)',
    license: 'Public domain (U.S. government)',
    pipeline: 'live',
    homepage: EIA_SHOPP_HOME,
    get covers() {
      const list = HEATING_STATES[product]
      const n = list.filter((st) => st !== 'DC').length
      return `The ${n} states${list.includes('DC') ? ' + DC' : ''} EIA surveys for residential ${name}: ${list.join(', ')}. Off-season (April to mid-October) the latest reading is the end of March, labeled as such.`
    },
    applies: (l) => hasHeatingSeries(product, l.stateAbbr) ||
      `EIA's heating-season survey has no residential ${name} price for ${stateLabel(l)}.`,
    target: (l) => up(l),
    geography: (_st, l) => `${stateLabel(l)} (statewide)`,
    place: statePlace,
    seriesId: (st) => heatingSeriesId(product, st),
    citationUrl: (st) => heatingSeriesUrl(product, st),
    resolve: async (st, ctx, l) => {
      const r = await ctx.heating!(product, st)
      let comparison: HeatingSeriesData | undefined
      try {
        comparison = (await ctx.heating!(product, NATIONAL_HEATING)).data
      } catch { /* U.S. comparison is optional */ }
      const season = heatingSeasonStatus(r.data.latestDate, ctx.now)
      const stale = r.stale || season.stale
      return {
        // Off-season is the survey's schedule: shown as 'stale' (⚠) in the trace, with the honest reason.
        status: stale || season.offSeason ? 'stale' : 'used',
        value: {
          series: r.data, comparison, comparisonLabel: 'U.S. avg, EIA weekly', geography: `${stateLabel(l)} (statewide)`,
          fetchedAt: r.fetchedAt, ...(season.note && !stale ? { offSeasonNote: season.note } : {}),
        },
        asOf: r.data.latestDate,
        ...(stale ? { reason: STALE_REASON } : season.note ? { reason: season.note, seasonal: true } : {}),
      }
    },
  })
}

const NY_REGION = (l: L) => (up(l) === 'NY' ? nyserdaRegionForCounty(l.countyFips) : null)

const HEATING_OIL = {
  metric: 'heatingOil',
  title: 'Home heating oil (Home heating graph)',
  method:
    '% change of the weekly residential price since the week of January 20, 2025 (EIA surveys October–March only, so ' +
    'between seasons the figure is last season\'s, labeled so). Not seasonally adjusted. The graph appears only where at ' +
    'least 5% of the state\'s homes heat with the fuel (Census ACS table B25040).',
  comparison: 'Same survey, same weeks: the EIA U.S. average (SHOPP), or for a New York region the NYSERDA statewide average.',
  noData: 'No Heating oil tab (and no Home heating graph when propane has no data either).',
  rungs: [
    defineRung<L, NyserdaRegion, HeatingRungValue, C>({
      id: 'heatingOil.nyserda-region',
      label: 'NYSERDA New York regional average',
      pill: 'NY region',
      source: 'NYSERDA',
      sourceName: 'NYSERDA Average Home Heating Oil Prices by Region (Open NY)',
      level: 'region',
      frequency: 'weekly September–March, twice a month April–August',
      license: 'Open NY open data (NYSERDA); attribution',
      pipeline: 'live',
      homepage: NYSERDA_PAGE,
      covers: 'New York: the county’s NYSERDA survey region (Long Island, New York City, Lower Hudson, Upper Hudson, Capital District, North Country, Central, Western), year-round.',
      applies: (l) => !!NY_REGION(l) || (up(l) === 'NY' ? 'No NYSERDA region is known for this county.' : 'NYSERDA surveys New York only.'),
      target: (l) => NY_REGION(l)!,
      geography: (r) => `${r.name} region (NY)`,
      place: statePlace,
      seriesId: (r) => `NYSERDA ${r.column}`,
      citationUrl: () => NYSERDA_DATASET_URL,
      resolve: async (region, ctx) => {
        const r = await ctx.nyserda!()
        const series = nyserdaSeries(r.data, region.column)
        if (!isValidHeating(series)) {
          return { status: 'invalid', reason: 'The NYSERDA regional figure failed our sanity checks, so it isn\'t shown.' }
        }
        let comparison: HeatingSeriesData | undefined
        try { comparison = nyserdaSeries(r.data, NYSERDA_STATEWIDE_COLUMN) } catch { /* optional */ }
        const stale = r.stale || ctx.now.getTime() - Date.parse(`${series.latestDate}T00:00:00Z`) > NYSERDA_STALE_DAYS * 86_400_000
        return {
          status: stale ? 'stale' : 'used',
          value: { series, comparison, comparisonLabel: 'NY statewide avg, NYSERDA', geography: `${region.name} region (NY)`, fetchedAt: r.fetchedAt },
          asOf: series.latestDate,
          ...(stale ? { reason: STALE_REASON } : {}),
        }
      },
    }),
    shoppRung('oil'),
  ],
} satisfies Ladder<L, HeatingRungValue, C>

const PROPANE = {
  metric: 'propane',
  title: 'Propane (Home heating graph)',
  method:
    'Same as heating oil: weekly residential price since the week of January 20, 2025, October–March survey, shown only ' +
    'where at least 5% of the state\'s homes heat with propane (Census ACS table B25040).',
  comparison: 'EIA U.S. average, same survey and weeks.',
  noData: 'No Propane tab (and no Home heating graph when heating oil has no data either).',
  rungs: [shoppRung('propane')],
} satisfies Ladder<L, HeatingRungValue, C>

// ------------------------------------------------------------------ registry


// ------------------------------------------------------------------ rent base (Shelter card's $ figure)

const CENSUS_RENT_SOURCE = 'U.S. Census Bureau, American Community Survey 5-year (table B25064, median gross rent)'
const CENSUS_RENT_HOME = 'https://data.census.gov/table/ACSDT5Y2023.B25064'
type RentBasis = NonNullable<CensusData['basis']>

/** One rung per basis tier; the bundled lookup picks the tier, each rung reports whether it was the one. */
function rentBaseRung(basis: Exclude<RentBasis, 'none'>, o: { label: string; pill?: string; level: GeoLevel; covers: string; why: (l: L) => string }) {
  return defineRung<L, string, CensusData, C>({
    id: `rentBase.${basis}`,
    label: o.label,
    ...(o.pill ? { pill: o.pill } : {}),
    source: 'Census',
    sourceName: CENSUS_RENT_SOURCE,
    level: o.level,
    frequency: 'yearly (5-year estimates)',
    license: 'Public domain (U.S. government)',
    pipeline: 'static',
    homepage: CENSUS_RENT_HOME,
    covers: o.covers,
    applies: (l) => !!l.zip || 'No zip.',
    target: (l) => l.zip!,
    geography: (z, l) => (o.level === 'county' ? countyLabel(l) : o.level === 'state' ? stateLabel(l) : `zip ${z}`),
    resolve: (zip, ctx, l) => {
      const c = ctx.censusRent!(zip)
      if (c.basis === basis && c.medianRent > 0) {
        const name = basis === 'zip' ? `zip ${zip}` : basis === 'county' || basis === 'state' ? c.basisArea ?? o.label : `zip ${c.donorZip}`
        const moe = c.donorMoe ? ` ± $${c.donorMoe.toLocaleString('en-US')}` : ''
        const figure = `${fmtRentFigure(c.medianRent, c.rentCoded)}${moe}/mo (Census ACS ${c.year} 5-year)`
        return {
          status: 'used', value: c,
          geography: { name, level: o.level },
          reason: c.basisNote && basis !== 'zip'
            ? `${c.basisNote}: ${figure}.`
            : `Median gross rent ${figure}${c.rentCoded && c.basisNote ? `; ${c.basisNote}` : ''}.`,
        }
      }
      return { status: 'not-applicable', reason: o.why(l) }
    },
  })
}

const RENT_BASE = {
  metric: 'rentBase',
  title: 'Rent base for the Shelter (CPI) $ figure',
  method:
    'The Shelter (CPI) card\'s ≈ $/yr in rent applies the CPI rent-of-primary-residence % to a median gross rent × 12. ' +
    'That rent is the zip\'s own Census figure (a top-coded median is shown as "$3,500+", and the $ is then a floor); ' +
    'where Census suppresses it (small samples) or the zip is a PO box, it is borrowed and labeled: a PO box\'s ' +
    'residential donor zip, else the nearest zip in the same county with a reliable Census rent (margin of error at ' +
    'most 30% of the estimate, not top- or bottom-coded) within 100 miles, preferring one in the same town, else the ' +
    'county median (Connecticut: the planning region), else the state median. Never a national constant.',
  noData: 'No $ figure (Guam, the Virgin Islands and other areas the ACS doesn’t cover).',
  rungs: [
    rentBaseRung('zip', {
      label: 'Census median rent for the zip', level: 'zip',
      covers: 'Zips with a published ACS median gross rent (a top-coded median shows as "$3,500+").',
      why: (l) => `Census publishes no median rent for zip ${l.zip} (suppressed for a small sample, or a PO-box zip with no Census area).`,
    }),
    rentBaseRung('po-donor', {
      label: 'PO-box zip: residential donor zip', pill: 'PO-box donor', level: 'zip',
      covers: 'USPS-only zips (PO boxes): the largest residential zip in the same city, else the most populous in the county, with a reliable Census rent (margin of error ≤ 30%, not top/bottom-coded).',
      why: () => 'Not a PO-box zip with a reliable residential donor.',
    }),
    rentBaseRung('nearest-zip', {
      label: 'Nearest zip in the county with a reliable Census rent', pill: 'Nearest zip', level: 'zip',
      covers: 'Zips whose rent Census suppresses: the nearest zip in the same county with a reliable published rent (margin of error ≤ 30% of the estimate, not top/bottom-coded) within 100 miles; within that, a zip in the same town is preferred.',
      why: (l) => `No zip in ${countyOnly(l)} with a reliable Census rent (margin of error ≤ 30%, not top/bottom-coded) within 100 miles.`,
    }),
    rentBaseRung('county', {
      label: 'County median rent', level: 'county',
      covers: 'Counties with no usable zip figure: the county’s ACS median gross rent (Connecticut: the zip’s planning region, the county-level geography Census now reports).',
      why: () => 'Census publishes no median rent for this county-level area.',
    }),
    rentBaseRung('state', {
      label: 'State median rent', level: 'state',
      covers: 'Last resort: the state’s ACS median gross rent.',
      why: (l) => `No Census rent for ${stateLabel(l)}.`,
    }),
  ],
} satisfies Ladder<L, CensusData, C>

export const LADDERS = {
  gas: GAS,
  rent: RENT,
  groceries: GROCERIES,
  shelter: SHELTER,
  electricity: ELECTRICITY,
  homePrices: HOME_PRICES,
  heatingOil: HEATING_OIL,
  propane: PROPANE,
  rentBase: RENT_BASE,
} as const

export type MetricId = keyof typeof LADDERS

/** Display order (About page, docs). */
export const LADDER_ORDER: MetricId[] = ['gas', 'rent', 'shelter', 'rentBase', 'homePrices', 'groceries', 'electricity', 'heatingOil', 'propane']

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
 * The LIVE gas series a place resolves to when every source answers: first applicable live gas rung (what
 * the refresh plan warms and the map shows). Static rungs (Alaska community survey, Puerto Rico DACO) are
 * bundled data resolved per zip in the snapshot; for those places this is the live fallback behind them.
 * `eiaOnly`: the BLS-outage fallback (first applicable EIA rung) — what the refresh plan also warms.
 */
export function selectGasLookup(loc: LadderLocation, opts: { eiaOnly?: boolean } = {}): GasLookupResult {
  const hit = firstApplicable(GAS, loc, (r) => r.pipeline === 'live' && (!opts.eiaOnly || r.source === 'EIA'))
  return hit!.target as GasLookupResult
}

/** Rung ids of the national (last) rung of each ladder that has one: an outage stand-in when used after a failure. */
export const isNationalRung = (rungId: string | undefined) => !!rungId && /-national$/.test(rungId)
