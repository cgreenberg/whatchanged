// Pure view-model builder for the four hero cards. Everything displayed comes from the
// API snapshot (no frontend dollar fallbacks, no national stand-ins shown as local).

import type { EconomicSnapshot, CensusData, CpiData, GasPriceData } from '@/types'
import type { Provenance } from '@/lib/provenance'
import { cpiGeoLabel, cpiTierOf } from '@/lib/provenance'
import { ANNUAL_GROCERY_BASE } from '@/lib/compute/dollar-translations'
import { STATE_TO_PAD } from '@/lib/mappings/eia-gas'
import {
  BASELINE_MONTH,
  BASELINE_MONTH_LABEL,
  BASELINE_DAY_LABEL,
  gasBaselineIndex,
  gasNationalMatching,
  monthlyChangeSinceBaseline,
  latestIndex,
} from '@/lib/baseline'
import {
  fmtSignedDollars,
  fmtDollars,
  fmtSignedPct,
  fmtMonthYear,
  fmtDay,
  directionOf,
  monthsBetween,
  DATE_UNAVAILABLE,
} from '@/lib/format'

export type HeroCardId = 'gas' | 'rent' | 'shelter' | 'groceries' | 'tariff'

export interface HeroCardModel {
  id: HeroCardId
  label: string
  accentColor: string
  status: 'ok' | 'unavailable'
  value?: string
  change?: string
  direction?: 'up' | 'down' | 'neutral'
  detail?: string
  nationalValue?: string
  provenance: Provenance
  stale?: boolean
  /** Shown in amber under the value: e.g. an outlier flag or a documented data note. */
  caveat?: string
  /** YYYY-MM of the latest data point (for the page-level "as of" range). */
  asOfPeriod?: string
  /** Short geography tag for share card / OG / meta text, e.g. "Buncombe Co.", "South Atlantic region". */
  geoTag?: string
  /** Statistical outlier (county flag): share/OG/meta mark the number with "†" and a footnote. */
  outlier?: boolean
}

/** Marker + footnote used wherever a flagged (outlier) figure is shown without the full caveat. */
export const OUTLIER_MARK = '†'
export const OUTLIER_FOOTNOTE = '† unusual value: far outside most U.S. counties; treat with caution'

/**
 * Hawaii / Alaska gas is the BLS Urban Hawaii / Urban Alaska average price (EIA publishes no HI/AK
 * series). Honest note: an urban average, so prices in rural parts of the state may differ.
 */
export const URBAN_HI_AK_GAS_NOTE = (state: 'HI' | 'AK') => {
  const name = state === 'HI' ? 'Hawaii' : 'Alaska'
  return `Urban ${name} average (BLS); prices in rural ${name} may differ.`
}

/** Territories (PR, VI, GU, …) have no EIA retail gasoline series; their native gas series is the U.S. average. */
export const TERRITORY_GAS_CAVEAT = (place: string) => `No EIA gas price series for ${place}; showing the U.S. average.`
const TERRITORY_NAMES: Record<string, string> = {
  PR: 'Puerto Rico', VI: 'the U.S. Virgin Islands', GU: 'Guam', AS: 'American Samoa', MP: 'the Northern Mariana Islands',
}

/** Caveat for the gas card and gas chart when the series shown is a stand-in for an area EIA does not publish. */
export function gasCaveatFor(s: Pick<EconomicSnapshot, 'gas' | 'location'>): string | undefined {
  const g = s.gas?.data
  const st = s.location?.stateAbbr
  if (!g || !st) return undefined
  if ((st === 'HI' || st === 'AK') && g.source === 'bls' && (g.blsArea === 'S49F' || g.blsArea === 'S49G')) return URBAN_HI_AK_GAS_NOTE(st)
  if (TERRITORY_NAMES[st] && g.duoarea === 'NUS' && g.fallback !== 'national') return TERRITORY_GAS_CAVEAT(TERRITORY_NAMES[st])
  return undefined
}

/** "Buncombe County, NC" → "Buncombe Co."; "Calcasieu Parish, LA" → "Calcasieu Parish". */
export function shortCountyName(name: string | null | undefined): string {
  if (!name) return 'county'
  return name.replace(/,\s*[A-Z]{2}$/, '').replace(/ County$/, ' Co.').trim()
}

/** Short CPI geography: "Chicago metro", "South Atlantic div.", "South region", "U.S. avg". */
export function cpiShortGeo(c: CpiData | null | undefined): string | undefined {
  if (!c) return undefined
  if (c.fallback === 'national') return 'U.S. avg; local n/a'
  const tier = cpiTierOf(c)
  const name = (c.metro ?? '').trim()
  if (tier === 4) return 'U.S. avg'
  if (tier === 3) return `${name.replace(/ Urban$/, '')} region`
  if (tier === 2) return `${name} div.`
  if (tier === 1) return /^Urban /.test(name) ? name : `${name.split('-')[0]} metro`
  return name || undefined
}

/**
 * The national series is this area's native gas series (territories, or a state EIA has no PAD for /
 * unknown) — not an outage stand-in for a state that has a local series.
 */
export function isNativeNationalGas(g: GasPriceData | null | undefined, stateAbbr?: string | null): boolean {
  if (!g || g.fallback === 'national' || g.duoarea !== 'NUS') return false
  return !stateAbbr || !!TERRITORY_NAMES[stateAbbr] || STATE_TO_PAD[stateAbbr] === undefined
}

/**
 * Short gas geography: "Lower Atlantic avg", "West Coast excl. CA avg", "Texas state avg";
 * BLS tiers: "Philadelphia metro", "Urban Hawaii", "East North Central div.".
 */
export function gasShortGeo(g: GasPriceData | null | undefined, stateAbbr?: string | null): string | undefined {
  if (!g) return undefined
  // Outage fallback (local series failed) vs. an area whose native series is national (e.g. PR).
  // A state with its own EIA series showing NUS is an outage even without `fallback` (older cache).
  if (g.fallback === 'national') return 'U.S. avg; local n/a'
  if (g.isNationalFallback || g.duoarea === 'NUS') return isNativeNationalGas(g, stateAbbr) ? 'U.S. avg' : 'U.S. avg; local n/a'
  if (g.source === 'bls' && g.blsArea) {
    const name = (g.areaName ?? g.region ?? g.blsArea).trim()
    if (/^S/.test(g.blsArea)) return /^Urban /.test(name) ? name : `${name.split('-')[0]} metro`
    return /^0\d00$/.test(g.blsArea) ? `${name.replace(/ Urban$/, '')} region` : `${name} div.`
  }
  return (g.geoLevel ?? g.region)
    .replace(/\s*\(PADD [^)]*\)/, '')
    .replace('excl. California', 'excl. CA')
    .trim()
}

/** Stale badge for one CPI item: its own flag when the payload has per-item staleness, else the CPI-wide flag. */
export function cpiItemStale(s: Pick<EconomicSnapshot, 'cpi'>, item: 'groceries' | 'shelter' | 'energy'): boolean {
  const items = s.cpi?.data?.staleItems
  return Array.isArray(items) ? items.includes(item) : !!s.cpi?.stale
}

/**
 * true when a local series failed and the shared national series is shown in
 * its place (an outage). Callers treat this as degraded: short CDN TTL so the
 * page self-heals when the local series is back.
 */
export function usesNationalFallback(s: Pick<EconomicSnapshot, 'gas' | 'cpi'>): boolean {
  return s.gas?.data?.fallback === 'national' || s.cpi?.data?.fallback === 'national'
}

/** Optional county context from the static county shard (flags/notes for displayed county metrics). */
export interface HeroCountyContext {
  flags?: string[]
  note?: Record<string, string>
}

/** Sanity ranges (CLAUDE.md): outside → "Data unavailable". */
export const SANITY = {
  gasPrice: [1, 10] as const,
  pctChange: [-20, 50] as const,
}

const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

const NOT_SA = 'not seasonally adjusted'

/** Shown under the hero cards when the Zillow Rent card is shown. */
export const SHELTER_VS_RENT_NOTE =
  'CPI shelter covers all renters and homeowners and lags market rents by about a year; the Rent card shows new-lease asking rents (Zillow).'
/** Shown with the Housing graph (all three tabs): how the Zillow series differ from CPI shelter. */
export const HOUSING_NOTE =
  'Rent and Home prices are Zillow market measures for your county: asking rents on new leases and the typical home value. ' +
  'Shelter (CPI) is the BLS index of what all renters and homeowners pay, including existing leases, so it trails new-lease rents by about a year.'
/** EIA tiers: weekly retail regular gasoline. */
export const GAS_SOURCE = 'EIA weekly retail regular gasoline'
/** BLS tiers: CPI average price data, gasoline (unleaded regular), monthly. */
export const GAS_SOURCE_BLS = 'BLS CPI average price, regular gasoline'

/** true when the gas series is BLS monthly average-price data (dates YYYY-MM). */
export function isMonthlyGas(g: Pick<GasPriceData, 'frequency' | 'source'> | null | undefined): boolean {
  return !!g && (g.frequency === 'monthly' || g.source === 'bls')
}

/** Source text, link and (for BLS) window for the gas card and gas chart. */
export function gasSourceInfo(g: GasPriceData | null | undefined): { source: string; sourceUrl: string } {
  if (g && isMonthlyGas(g)) {
    return {
      source: GAS_SOURCE_BLS,
      sourceUrl: g.seriesId ? `https://data.bls.gov/timeseries/${g.seriesId}` : 'https://www.bls.gov/cpi/factsheets/average-prices.htm',
    }
  }
  return {
    source: GAS_SOURCE,
    sourceUrl: g?.tier === 3 ? 'https://www.eia.gov/petroleum/weekly/includes/padds.php' : 'https://www.eia.gov/petroleum/gasdiesel/',
  }
}
/** County rent older than this (from the end of its as-of month) gets a stale badge. */
export const RENT_STALE_DAYS = 60
const DAY_MS = 86_400_000

/** True when a YYYY-MM month ended more than `days` days before `now`. */
export function monthOlderThan(ym: string | null | undefined, days: number, now: Date = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? '')
  if (!m) return false
  const monthEnd = Date.UTC(Number(m[1]), Number(m[2]), 0) // last day of that month
  return now.getTime() - monthEnd > days * DAY_MS
}

/**
 * National % change over the same months as the local figure (same baseline period and the same latest
 * month), so "National: x%" never covers a later month than the local number. Falls back to the
 * shared baseline rule capped at the local latest month when the exact periods are missing.
 */
export function nationalChangeMatching<T extends { date: string }>(
  series: ReadonlyArray<T> | undefined,
  value: (p: T) => number | null | undefined,
  baselinePeriod: string | undefined,
  latestPeriod: string | undefined,
): { pct: number; baselinePeriod: string; latestPeriod: string } | null {
  if (!series?.length) return null
  const capped = latestPeriod ? series.filter(p => p.date <= latestPeriod) : series
  const at = (d: string | undefined) => (d ? capped.find(p => p.date === d) : undefined)
  const b = at(baselinePeriod)
  const l = at(latestPeriod)
  if (b && l) {
    const bv = value(b)
    const lv = value(l)
    if (typeof bv === 'number' && typeof lv === 'number' && Number.isFinite(bv) && Number.isFinite(lv) && bv !== 0) {
      return { pct: ((lv - bv) / bv) * 100, baselinePeriod: b.date, latestPeriod: l.date }
    }
  }
  return monthlyChangeSinceBaseline(capped, value)
}

/** Where the zip's income figure comes from: its own/city ACS, the county ACS median, or the U.S. median. */
export function censusSourceOf(c: CensusData | null | undefined): 'acs' | 'county' | 'national' | null {
  if (!c) return null
  if (c.source === 'national' || c.incomeGeo === 'national') return 'national'
  if (c.incomeGeo === 'county') return 'county'
  if (c.source === 'acs') return 'acs'
  return c.isFallback ? 'national' : 'acs'
}

export function censusDonorZip(c: CensusData | null | undefined): string | undefined {
  if (!c) return undefined
  return c.donorZip ?? c.approxFromZip
}

/** "borrowed from zip 10025 (largest residential zip in the city)". */
export function donorPhrase(c: CensusData | null | undefined): string | null {
  const donor = censusDonorZip(c)
  if (!donor) return null
  const where = c?.donorScope === 'city' ? 'the city' : c?.donorScope === 'county' ? 'the county' : 'the area'
  return `borrowed from zip ${donor} (largest residential zip in ${where})`
}

/** "Census ACS 2023"; for the national fallback, its real source (e.g. "Census CPS ASEC 2022"). */
function censusLabel(c: CensusData): string {
  if (censusSourceOf(c) === 'national') {
    const m = /(Census\b.*?\d{4})/.exec(c.sourceLabel ?? '')
    return m ? m[1] : `Census ${c.year}`
  }
  return `Census ACS ${c.year}`
}

function sinceMonth(period: string | null | undefined): string {
  return `since ${period ? fmtMonthYear(period) : BASELINE_MONTH_LABEL}`
}

export const ACCENTS = {
  gas: '#F59E0B',
  rent: '#3B82F6',
  shelter: '#3B82F6',
  groceries: '#EF4444',
  tariff: '#A855F7',
} as const

// ---------------------------------------------------------------- Gas

export function buildGasCard(s: EconomicSnapshot): HeroCardModel {
  const g = s.gas.data
  const geography = g ? `${g.geoLevel ?? g.region}${g.isNationalFallback ? ' (local data unavailable)' : ''}` : 'area unavailable'
  const series = Array.isArray(g?.series) ? g!.series : []
  const latestDate = g?.latestDate ?? series[series.length - 1]?.date
  const bIdx = gasBaselineIndex(series)
  const baselineDate = g?.baselineDate ?? (bIdx >= 0 ? series[bIdx].date : undefined)
  const monthly = isMonthlyGas(g)
  const provenance: Provenance = {
    ...gasSourceInfo(g),
    geography,
    window: monthly
      ? `monthly · since ${baselineDate ? fmtMonthYear(baselineDate) : BASELINE_MONTH_LABEL}`
      : baselineDate ? `since week of ${fmtDay(baselineDate)}` : `since ${BASELINE_DAY_LABEL}`,
    asOf: latestDate ? (monthly ? fmtMonthYear(latestDate.slice(0, 7)) : `week of ${fmtDay(latestDate)}`) : DATE_UNAVAILABLE,
    adjustment: NOT_SA,
  }
  const base = { id: 'gas' as const, label: 'Gas (regular)', accentColor: ACCENTS.gas, provenance, stale: !!s.gas.stale }
  if (!g || !inRange(g.current, SANITY.gasPrice) || !inRange(g.baseline, SANITY.gasPrice) || !Number.isFinite(g.change)) {
    return { ...base, status: 'unavailable' }
  }
  // National from the same source over the same period (BLS monthly → same months).
  const nat = g.isNationalFallback ? null : gasNationalMatching(g)
  return {
    ...base,
    status: 'ok',
    geoTag: gasShortGeo(g, s.location?.stateAbbr),
    caveat: gasCaveatFor(s),
    value: `$${g.current.toFixed(2)}/gal`,
    change: `${fmtSignedDollars(g.change)}/gal since ${BASELINE_MONTH_LABEL}`,
    direction: directionOf(g.change, 2),
    nationalValue: nat && inRange(nat.current, SANITY.gasPrice)
      ? `National: $${nat.current.toFixed(2)}/gal (${fmtSignedDollars(nat.change)})`
      : undefined,
    asOfPeriod: latestDate?.slice(0, 7),
  }
}

// ---------------------------------------------------------------- Rent / Shelter

/** "rise" in spring/summer, when asking rents usually climb; a neutral word otherwise. */
function seasonalWord(asOf: string): string {
  const m = Number(asOf.slice(5, 7))
  return m >= 3 && m <= 9 ? 'rise' : 'swing'
}

export function buildRentCard(
  s: EconomicSnapshot,
  county?: HeroCountyContext | null,
  now: Date = new Date(),
): HeroCardModel | null {
  const r = s.rent
  if (!r) return null
  const provenance: Provenance = {
    source: 'Zillow ZORI',
    sourceUrl: r.sourceUrl,
    geography: r.geoName,
    window: sinceMonth(r.baseMonth),
    asOf: fmtMonthYear(r.asOf),
    adjustment: r.adjustment,
  }
  // Flags/notes come from the client's county shard when present, else from the bundled rent row
  // (so the server-rendered share card and OG image carry the same caveat).
  const note = county?.note?.rent ?? r.note
  const flagged = !!county?.flags?.includes('rent') || r.flagged === true
  const caveat = note
    ? `Unusual value: ${note}`
    : flagged
      ? 'Unusual value: far outside the range most U.S. counties show, so treat it with caution.'
      : undefined
  const base = {
    id: 'rent' as const,
    label: 'Rent (new leases)',
    accentColor: ACCENTS.rent,
    provenance,
    stale: monthOlderThan(r.asOf, RENT_STALE_DAYS, now),
  }
  if (!inRange(r.pct, SANITY.pctChange) || !(r.curRent > 0) || !Number.isFinite(r.monthlyChange)) {
    return { ...base, status: 'unavailable' }
  }
  // The $ figure is the seasonally adjusted change expressed in dollars, never a raw then-vs-now gap;
  // the raw level is shown only as a level, with its month.
  return {
    ...base,
    status: 'ok',
    value: fmtSignedPct(r.pct),
    change: `≈ ${fmtSignedDollars(r.monthlyChange, 0)}/mo vs ${fmtMonthYear(r.baseMonth)}, after adjusting for the usual seasonal ${seasonalWord(r.asOf)}`,
    direction: directionOf(r.pct),
    detail: `Typical asking rent: ${fmtDollars(r.curRent)}/mo (${fmtMonthYear(r.asOf)})`,
    caveat,
    asOfPeriod: r.asOf,
    geoTag: shortCountyName(r.geoName),
    ...(caveat ? { outlier: true } : {}),
  }
}

export function buildShelterCard(s: EconomicSnapshot): HeroCardModel {
  const c = s.cpi.data
  const series = Array.isArray(c?.series) ? c!.series : []
  const shelterOf = (p: { shelter: number | null }) => p.shelter
  const li = latestIndex(series, shelterOf)
  const latest = c?.shelterLatestPeriod ?? (li >= 0 ? series[li].date : undefined)
  const provenance: Provenance = {
    source: 'BLS CPI shelter',
    sourceUrl: c?.seriesIds?.shelter
      ? `https://data.bls.gov/timeseries/${c.seriesIds.shelter}`
      : 'https://data.bls.gov/cgi-bin/surveymost?cu',
    geography: cpiGeoLabel(c),
    window: sinceMonth(c?.shelterBaselinePeriod ?? BASELINE_MONTH),
    asOf: fmtMonthYear(latest),
    adjustment: NOT_SA,
  }
  const base = {
    id: 'shelter' as const,
    label: 'Shelter prices (CPI, all tenants & homeowners)',
    accentColor: ACCENTS.shelter,
    provenance,
    stale: cpiItemStale(s, 'shelter'),
  }
  const pct = c?.shelterChange
  if (!c || !inRange(pct, SANITY.pctChange)) return { ...base, status: 'unavailable' }

  const census = s.census.data
  const hasLocalRent = !!census && !census.isFallback && !census.isRentFallback && census.medianRent > 0
  // National CPI (fallback during an outage, or a territory with no local CPI) is never applied to
  // local rent: no dollar figure, and say why.
  const cpiIsNational = c.fallback === 'national' || cpiTierOf(c) === 4
  const rawDollars = s.dollarImpact?.shelter
  const dollars = !cpiIsNational && hasLocalRent && typeof rawDollars === 'number' && Number.isFinite(rawDollars)
    ? rawDollars
    : null
  const nat = nationalChangeMatching(c.nationalSeries, shelterOf, c.shelterBaselinePeriod, latest)
  const donor = donorPhrase(census)
  const COVERS = 'Covers existing leases and homeowners; new-lease rents can differ.'
  return {
    ...base,
    status: 'ok',
    geoTag: cpiShortGeo(c),
    value: fmtSignedPct(pct),
    change: dollars !== null ? `≈ ${fmtSignedDollars(dollars, 0)}/yr on local median rent` : undefined,
    direction: directionOf(pct),
    detail: dollars !== null
      ? `Base: ${fmtDollars(census!.medianRent)}/mo median rent (${censusLabel(census!)}${donor ? `, ${donor}` : ''}) × 12. ${COVERS}`
      : cpiIsNational
        ? `No dollar estimate: ${c.fallback === 'national' ? 'local shelter CPI is unavailable, so this is the national figure' : 'BLS publishes no local shelter CPI here, so this is the national figure'}, which is not applied to local rent. ${COVERS}`
        : `No local rent figure for a dollar estimate. ${COVERS}`,
    nationalValue: nat && c.tier !== 4 ? `National: ${fmtSignedPct(nat.pct)}` : undefined,
    asOfPeriod: latest,
  }
}

// ---------------------------------------------------------------- Groceries

export function buildGroceryCard(s: EconomicSnapshot): HeroCardModel {
  const c = s.cpi.data
  const series = Array.isArray(c?.series) ? c!.series : []
  const latest = c?.groceriesLatestPeriod ?? series[series.length - 1]?.date
  const provenance: Provenance = {
    source: 'BLS CPI food at home',
    sourceUrl: c?.seriesIds?.groceries
      ? `https://data.bls.gov/timeseries/${c.seriesIds.groceries}`
      : 'https://data.bls.gov/cgi-bin/surveymost?cu',
    geography: cpiGeoLabel(c),
    window: sinceMonth(c?.groceriesBaselinePeriod ?? BASELINE_MONTH),
    asOf: fmtMonthYear(latest),
    adjustment: NOT_SA,
  }
  const base = { id: 'groceries' as const, label: 'Grocery Prices', accentColor: ACCENTS.groceries, provenance, stale: cpiItemStale(s, 'groceries') }
  const pct = c?.groceriesChange
  if (!c || !inRange(pct, SANITY.pctChange)) return { ...base, status: 'unavailable' }
  const dollars = s.dollarImpact?.groceries
  const nat = nationalChangeMatching(c.nationalSeries, p => p.groceries, c.groceriesBaselinePeriod, latest)
  return {
    ...base,
    status: 'ok',
    geoTag: cpiShortGeo(c),
    value: fmtSignedPct(pct),
    change: typeof dollars === 'number' && Number.isFinite(dollars)
      ? `≈ ${fmtSignedDollars(dollars, 0)}/yr on ${fmtDollars(ANNUAL_GROCERY_BASE)}/yr of groceries`
      : undefined,
    direction: directionOf(pct),
    detail: typeof dollars === 'number' && Number.isFinite(dollars) ? undefined : 'Dollar estimate unavailable',
    nationalValue: nat && c.tier !== 4 ? `National: ${fmtSignedPct(nat.pct)}` : undefined,
    asOfPeriod: latest,
  }
}

// ---------------------------------------------------------------- Tariff

export function buildTariffCard(s: EconomicSnapshot): HeroCardModel {
  const t = s.tariff.data
  const census = s.census.data
  const src = t?.isFallback ? 'national' : censusSourceOf(census)
  const donor = src === 'acs' ? donorPhrase(census) : null
  // County fallback: the lookup's own label names the area it used (CT: the planning region)
  const countyName = /county median \(([^)]+)\)/.exec(census?.sourceLabel ?? '')?.[1] ?? s.location?.countyName
  const geography = !t
    ? 'income unavailable'
    : src === 'national'
      ? 'national'
      : census?.isCityLevel && census.cityName
        ? `${census.cityName} city median income`
        : src === 'county'
          ? `${countyName ?? 'county'} median income (no zip figure)`
          : donor
            ? `zip ${s.zip} area median income (estimate)`
            : `zip ${s.zip} median income`
  const incomeAsOf = typeof census?.year !== 'number'
    ? DATE_UNAVAILABLE
    : src === 'national'
      ? `U.S. median income (${censusLabel(census)}) — no local data`
      : `income: ${censusLabel(census)}${src === 'county' ? ' county median' : ''}${donor ? `, ${donor}` : ''}`
  const provenance: Provenance = {
    source: 'Yale Budget Lab',
    sourceUrl: 'https://budgetlab.yale.edu/research/where-we-stand-fiscal-economic-and-distributional-effects-all-us-tariffs',
    geography,
    window: 'annual cost estimate',
    asOf: incomeAsOf,
    adjustment: 'estimate, not a measured change',
  }
  const base = { id: 'tariff' as const, label: 'Tariff Impact (est.)', accentColor: ACCENTS.tariff, provenance }
  if (!t || !(t.medianIncome > 0) || !(t.estimatedCost > 0)) return { ...base, status: 'unavailable' }
  return {
    ...base,
    status: 'ok',
    geoTag: tariffIncomeTag(s),
    value: `~${fmtDollars(t.estimatedCost)}/yr`,
    change: `${(t.tariffRate * 100).toFixed(2)}% of ${fmtDollars(t.medianIncome)} median household income`,
    direction: 'neutral',
  }
}

/** Where the tariff estimate's income comes from, in one or two words: "county", "nearby zip", "U.S.". */
export function tariffIncomeTag(s: EconomicSnapshot): string | undefined {
  const t = s.tariff.data
  if (!t) return undefined
  const census = s.census.data
  const src = t.isFallback ? 'national' : censusSourceOf(census)
  if (src === 'national') return 'U.S.'
  if (census?.isCityLevel) return 'city'
  if (src === 'county') return 'county'
  return censusDonorZip(census) ? 'nearby zip' : 'zip'
}

// ---------------------------------------------------------------- All

/** Gas, Rent (or CPI shelter fallback), Groceries, Tariff — always four cards. */
export function buildHeroCards(s: EconomicSnapshot, county?: HeroCountyContext | null): HeroCardModel[] {
  return [
    buildGasCard(s),
    buildRentCard(s, county) ?? buildShelterCard(s),
    buildGroceryCard(s),
    buildTariffCard(s),
  ]
}

/** "Jul 2026 – Sep 2026" when the cards' latest data differ by more than one month, else null. */
export function asOfRange(cards: HeroCardModel[]): string | null {
  const periods = cards
    .filter(c => c.status === 'ok' && c.asOfPeriod && /^\d{4}-\d{2}/.test(c.asOfPeriod))
    .map(c => c.asOfPeriod!.slice(0, 7))
    .sort()
  if (periods.length < 2) return null
  const lo = periods[0]
  const hi = periods[periods.length - 1]
  if (monthsBetween(lo, hi) <= 1) return null
  return `${fmtMonthYear(lo)} – ${fmtMonthYear(hi)}`
}

/**
 * Share/OG header end label: the span of the cards' latest data months, so a
 * header never implies every card runs through the newest month (gas is weekly,
 * CPI and rent lag). "SEP 2026", "AUG–SEP 2026", "DEC 2025–JAN 2026"; null if none.
 */
export function dataThroughLabel(cards: HeroCardModel[]): string | null {
  const periods = cards
    .filter(c => c.status === 'ok' && c.asOfPeriod && /^\d{4}-\d{2}/.test(c.asOfPeriod))
    .map(c => c.asOfPeriod!.slice(0, 7))
    .sort()
  if (!periods.length) return null
  const lo = periods[0]
  const hi = periods[periods.length - 1]
  const [loM, loY] = fmtMonthYear(lo).split(' ')
  if (lo === hi) return fmtMonthYear(hi).toUpperCase()
  const head = loY === hi.slice(0, 4) ? loM : `${loM} ${loY}`
  return `${head}–${fmtMonthYear(hi)}`.toUpperCase()
}

const tag = (c: HeroCardModel) => (c.geoTag ? ` (${c.geoTag})` : '')
const mark = (c: HeroCardModel) => (c.outlier ? OUTLIER_MARK : '')

/**
 * One short phrase per available hero card, each tagged with its geography (the numbers come from
 * different areas: county rent, regional CPI, regional gas), using the same numbers the page shows.
 * Kept short for a social preview; an outlier gets "†" and a footnote.
 */
export function metadataDescription(snapshot: EconomicSnapshot): string {
  const cards = buildHeroCards(snapshot)
  const parts: string[] = []
  for (const c of cards) {
    if (c.status !== 'ok') continue
    if (c.id === 'gas' && snapshot.gas.data) {
      parts.push(`Gas ${fmtSignedDollars(snapshot.gas.data.change)}/gal${tag(c)}`)
    }
    if (c.id === 'rent') parts.push(`Rent ${c.value}${mark(c)}${tag(c)}`)
    if (c.id === 'shelter') parts.push(`Shelter CPI ${c.value}${tag(c)}`)
    if (c.id === 'groceries') parts.push(`Groceries ${c.value}${tag(c)}`)
    if (c.id === 'tariff') parts.push(`Tariffs ${c.value} est.${c.geoTag ? ` (${c.geoTag} income)` : ''}`)
  }
  const head = parts.length ? `Since ${BASELINE_MONTH_LABEL}: ` : ''
  const foot = cards.some(c => c.status === 'ok' && c.outlier) ? ` · ${OUTLIER_MARK}unusual value` : ''
  return `${head}${parts.join(' · ')}${foot} · whatchanged.us`
}
