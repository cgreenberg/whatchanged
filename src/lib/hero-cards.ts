// Pure view-model builder for the four hero cards. Everything displayed comes from the
// API snapshot (no frontend dollar fallbacks, no national stand-ins shown as local).

import type { EconomicSnapshot, CensusData, CpiData, GasPriceData, ElectricityData, RentData } from '@/types'
import { METRIC_COLORS } from '@/lib/theme'
import type { Provenance } from '@/lib/provenance'
import { RENT_STALE_DAYS, monthOlderThan } from '@/lib/staleness'
import type { TraceMetric } from '@/lib/resolution/types'
import { cpiGeoLabel, cpiTierOf } from '@/lib/provenance'
import { ANNUAL_GROCERY_BASE, fmtRentFigure, fmtRentDollars } from '@/lib/compute/dollar-translations'
import { STATE_TO_PAD } from '@/lib/mappings/eia-gas'
import { cpiMetroShortName } from '@/lib/mappings/county-metro-cpi'
import { notCurrentText, rentSeasonalCaveat } from '@/lib/rent-range'
import {
  DCRA_SOURCE, DCRA_LICENSE, DCRA_DATA_URL, DCRA_ATTRIBUTION, DACO_SOURCE, DACO_DATA_URL, dcraStationsText,
} from '@/lib/static-gas-meta'
import {
  BASELINE_MONTH,
  BASELINE_MONTH_LABEL,
  BASELINE_DAY_LABEL,
  ELECTRICITY_BASELINE_FROM,
  ELECTRICITY_BASELINE_TO,
  ELECTRICITY_BASELINE_LABEL,
  ELECTRICITY_BASELINE_SHORT,
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
  fmtMonthShort,
  directionOf,
  monthsBetween,
  DATE_UNAVAILABLE,
} from '@/lib/format'

export type HeroCardId = 'gas' | 'rent' | 'shelter' | 'groceries' | 'electricity'

/** The ladder trace behind each card: the Shelter (CPI) card is the rent ladder's fallback rung, so it shows that trace. */
export const TRACE_FOR_CARD: Record<HeroCardId, TraceMetric> = {
  gas: 'gas', rent: 'rent', shelter: 'rent', groceries: 'groceries', electricity: 'electricity',
}

export interface HeroCardModel {
  id: HeroCardId
  label: string
  accentColor: string
  status: 'ok' | 'unavailable'
  /** Big number on the card. */
  value?: string
  /** Small qualifier after the big number ("12-mo avg": the latest 12 months). */
  valueNote?: string
  /** Short dollar translation shown beside the big number: "≈ +$87/mo", "≈ +$252/yr", "≈ +$900/yr in rent", "≈ +$33/mo". */
  inline?: string
  /** Gas only: its signed $ change since the baseline, shown under the big number ("+$0.87 since Jan 2025"). */
  change?: string
  direction?: 'up' | 'down' | 'neutral'
  /** The one short secondary line on the card: the window and/or the national comparison, or the basis. */
  secondary?: string
  /** Short source line on the card: "{short area} · {source} · {Mon YYYY}" ("Atlanta metro · BLS · Aug 2026"). */
  sourceLine: string
  /** Short caveat tags on the card, e.g. "⚠ unusual" (the explanation is in the ⓘ disclosure). */
  tags?: string[]
  /** Everything else, shown in the card's ⓘ disclosure above the full provenance line(s). */
  info: string[]
  /** Longer notes kept as named fields (also included in `info`). */
  detail?: string
  nationalValue?: string
  /** Outlier flag text, HI/AK stand-in or fallback explanation (in `info`; the card shows a short tag). */
  caveat?: string
  /** Full dollar-translation wording (in `info`; the card shows `inline`). */
  dollarNote?: string
  provenance: Provenance
  /** Extra provenance lines for the ⓘ disclosure (e.g. the rent index behind the shelter dollar figure). */
  moreProvenance?: Provenance[]
  stale?: boolean
  /** YYYY-MM of the latest data point (for the page-level "as of" range). */
  asOfPeriod?: string
  /** Short geography tag for share card / OG / meta text, e.g. "Buncombe Co.", "South Atlantic region". */
  geoTag?: string
  /** Statistical outlier (county flag): share/OG/meta mark the number with "†" and a footnote. */
  outlier?: boolean
}

/** Short on-card tag for a flagged (outlier) figure; the full explanation is in the ⓘ disclosure. */
export const OUTLIER_TAG = '⚠ unusual'

/** "{short area} · {source} · {Mon YYYY}", skipping empty parts. */
export function sourceLineOf(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(' · ')
}

const compact = (xs: Array<string | null | undefined | false>): string[] =>
  xs.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)

/** Marker + footnote used wherever a flagged (outlier) figure is shown without the full caveat. */
export const OUTLIER_MARK = '†'
export const OUTLIER_FOOTNOTE = '† unusual value: far outside most U.S. counties; treat with caution'

/**
 * Hawaii / Alaska outside the Honolulu / Anchorage CBSAs: EIA publishes no HI/AK series and BLS only
 * Honolulu (S49F) and Anchorage (S49G), so that metro's series stands in — said plainly.
 */
export const HI_AK_STANDIN_GAS_NOTE = (metro: string, place: string) =>
  `${metro}-area price — no BLS or EIA series for ${place}; local prices are typically higher and may have changed differently.`
/** Short marker + footnote for the stand-in on the share card, OG image and og:description. */
export const GAS_STANDIN_MARK = '*'
export const GAS_STANDIN_FOOTNOTE = (place: string) =>
  `${GAS_STANDIN_MARK} no BLS or EIA gas series for ${place} — local prices are typically higher and may have changed differently`
/** BLS monthly gas series failed: the zip's EIA weekly tier is shown instead (local and national both EIA). */
export const GAS_EIA_FALLBACK_NOTE = 'Local BLS monthly gas price unavailable right now; showing the EIA weekly regional average instead.'

/**
 * The place a HI/AK stand-in does not cover: 'full' for the website ("Hawaii County (Big Island)",
 * "Fairbanks North Star Borough"), 'text' for og:description ("Maui Co."), 'image' for the share card
 * and OG image ("Fairbanks North Star Bor.", "Bethel area").
 */
export function standInPlace(
  location: { countyName?: string; countyFips?: string } | null | undefined,
  style: 'full' | 'text' | 'image' = 'full',
): string {
  const name = (location?.countyName ?? '').replace(/,\s*[A-Z]{2}$/, '').trim()
  if (!name) return 'this area'
  if (location?.countyFips === '15001') return style === 'full' ? 'Hawaii County (Big Island)' : 'Hawaii Co. (Big Island)'
  return style === 'full' ? name : style === 'text' ? shortCountyName(name) : imageCountyName(name)
}

/** true when the gas series is a HI / AK stand-in (see HI_AK_STANDIN_GAS_NOTE). */
export function isGasStandIn(g: GasPriceData | null | undefined): boolean {
  return !!g && g.standIn === true && g.source === 'bls' && !g.fallback
}

/** Alaska zip without its own surveyed community: the nearest surveyed one in the same borough stands in. */
export const DCRA_NEAREST_NOTE = (community: string, km: number | undefined, place: string) =>
  `No survey for this town; ${community}${km !== undefined ? ` (${km} km away)` : ''} is the nearest surveyed community in ${place}.`
export const DCRA_REGION_NOTE = (region: string, place: string) =>
  `No usable surveyed community near this zip in ${place}; this is DCRA's ${region} region average.`

/** true for the bundled per-place gas sources (Alaska DCRA survey, Puerto Rico DACO). */
export function isStaticGas(g: Pick<GasPriceData, 'source'> | null | undefined): boolean {
  return !!g && (g.source === 'dcra' || g.source === 'daco')
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
  if (g.fallback === 'eia') return GAS_EIA_FALLBACK_NOTE
  if (isGasStandIn(g)) return HI_AK_STANDIN_GAS_NOTE(g.areaName ?? g.region, standInPlace(s.location))
  const st0 = g.staticSource
  if (st0?.kind === 'dcra' && st0.match === 'nearest') {
    return DCRA_NEAREST_NOTE(st0.place, st0.km, standInPlace(s.location))
  }
  if (st0?.kind === 'dcra' && st0.match === 'region') return DCRA_REGION_NOTE(st0.place, standInPlace(s.location))
  if (TERRITORY_NAMES[st] && g.duoarea === 'NUS' && g.fallback !== 'national') return TERRITORY_GAS_CAVEAT(TERRITORY_NAMES[st])
  return undefined
}

/**
 * County-equivalent for text (website, og:description): only "County" is shortened, so it never reads
 * as a city name; other types stay whole. "Buncombe County, NC" → "Buncombe Co."; "Lafayette Parish" /
 * "Bethel Census Area" / "Fairbanks North Star Borough" / "Anchorage Municipality" unchanged.
 */
export function shortCountyName(name: string | null | undefined): string {
  if (!name) return 'county'
  return name.replace(/,\s*[A-Z]{2}$/, '').trim().replace(/ County$/, ' Co.')
}

/**
 * County-equivalent for space-limited images (share card, OG image): "Bethel Census Area" → "Bethel area"
 * (never "C.A.", which reads as California), "… Borough" / "City and Borough" → "… Bor.", "… Municipality"
 * → "… Muni."; a parish stays "Parish" when `fits` says it fits its slot, else "Par.".
 */
export function imageCountyName(name: string | null | undefined, fits: (text: string) => boolean = () => true): string {
  const s = shortCountyName(name)
    .replace(/ (City and Borough|Borough)$/, ' Bor.')
    .replace(/ Census Area$/, ' area')
    .replace(/ Municipality$/, ' Muni.')
  return / Parish$/.test(s) && !fits(s) ? s.replace(/ Parish$/, ' Par.') : s
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
  if (tier === 1) return `${cpiMetroShortName(c.areaCode, name)} metro`
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
 * BLS tiers: "Philadelphia metro", "Washington DC metro", "Honolulu metro", and for a HI/AK
 * stand-in "Honolulu-area price*" (the share card, OG image and og:description add the footnote).
 */
export function gasShortGeo(g: GasPriceData | null | undefined, stateAbbr?: string | null): string | undefined {
  if (!g) return undefined
  // Outage fallback (local series failed) vs. an area whose native series is national (e.g. PR).
  // A state with its own EIA series showing NUS is an outage even without `fallback` (older cache).
  if (g.fallback === 'national') return 'U.S. avg; local n/a'
  if (g.source === 'daco') return 'Puerto Rico avg'
  if (g.source === 'dcra') {
    const st = g.staticSource
    if (st?.match === 'region') return `${st.place} AK region avg`
    return `${st?.place ?? g.region} survey${st?.match === 'nearest' ? ' (nearest)' : ''}`
  }
  if (g.isNationalFallback || g.duoarea === 'NUS') return isNativeNationalGas(g, stateAbbr) ? 'U.S. avg' : 'U.S. avg; local n/a'
  if (g.source === 'bls' && g.blsArea) {
    const name = (g.areaName ?? g.region ?? g.blsArea).trim()
    if (isGasStandIn(g)) return `${name}-area price${GAS_STANDIN_MARK}`
    if (/^S/.test(g.blsArea)) return `${g.blsArea === 'S49F' || g.blsArea === 'S49G' ? name : cpiMetroShortName(g.blsArea, name)} metro`
    return /^0\d00$/.test(g.blsArea) ? `${name.replace(/ Urban$/, '')} region` : name
  }
  return (g.geoLevel ?? g.region)
    .replace(/\s*\(PADD [^)]*\)/, '')
    .replace('excl. California', 'excl. CA')
    .trim()
}

/** Stale badge for one CPI item: its own flag when the payload has per-item staleness, else the CPI-wide flag. */
export function cpiItemStale(s: Pick<EconomicSnapshot, 'cpi'>, item: 'groceries' | 'shelter'): boolean {
  const items = s.cpi?.data?.staleItems
  return Array.isArray(items) ? items.includes(item) : !!s.cpi?.stale
}

/**
 * true when a local series failed and a stand-in is shown in its place (an outage): the shared
 * national series, or for a BLS gas tier the zip's EIA weekly tier. Callers treat this as degraded: short CDN TTL so the
 * page self-heals when the local series is back.
 */
export function usesNationalFallback(s: Pick<EconomicSnapshot, 'gas' | 'cpi'>): boolean {
  return !!s.gas?.data?.fallback || s.cpi?.data?.fallback === 'national'
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
  /** EIA residential electricity, ¢/kWh and % change (mirrors validate.ts). */
  electricityPrice: [5, 60] as const,
  electricityChange: [-50, 100] as const,
}

const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

const NOT_SA = 'not seasonally adjusted'

/** Shown under the hero cards when the Zillow Rent card is shown. */
export const SHELTER_VS_RENT_NOTE =
  'CPI shelter (rent, plus owners\' equivalent rent for homeowners) lags market rents by about a year; the Rent card shows new-lease asking rents (Zillow).'
/** Shown with the Housing graph (all three tabs): how the Zillow series differ from CPI shelter. */
export const HOUSING_NOTE =
  'Rent and Home prices are Zillow market measures for your county: asking rents on new leases and the typical home value. ' +
  'Shelter (CPI) is the BLS index of rent, plus owners\' equivalent rent for homeowners — not mortgage payments or home prices — ' +
  'and includes existing leases, so it trails new-lease rents by about a year.'
/** One short line under the Housing graph's Shelter (CPI) tab; the full HOUSING_NOTE is in its ⓘ. */
export const SHELTER_SHORT_NOTE = 'All tenants plus homeowners (owners\' equivalent rent); trails new-lease rents by about a year.'
/** EIA tiers: weekly retail regular gasoline. */
export const GAS_SOURCE = 'EIA weekly retail regular gasoline'
/** BLS tiers: CPI average price data, gasoline (unleaded regular), monthly. */
export const GAS_SOURCE_BLS = 'BLS CPI average price, regular gasoline'

/** true when the gas series is BLS monthly average-price data (dates YYYY-MM). */
export function isMonthlyGas(g: Pick<GasPriceData, 'frequency' | 'source'> | null | undefined): boolean {
  return !!g && (g.frequency === 'monthly' || g.source === 'bls')
}

/** Month-dated gas series (YYYY-MM): BLS and DACO monthly, and DCRA's January / July surveys. */
export function isMonthDatedGas(g: Pick<GasPriceData, 'frequency' | 'source'> | null | undefined): boolean {
  return isMonthlyGas(g) || g?.frequency === 'semiannual'
}

/** Source text, link and (for BLS) window for the gas card and gas chart. */
export function gasSourceInfo(g: GasPriceData | null | undefined): { source: string; sourceUrl: string } {
  if (g?.source === 'dcra') return { source: `${DCRA_SOURCE} (${DCRA_LICENSE})`, sourceUrl: DCRA_DATA_URL }
  if (g?.source === 'daco') return { source: `${DACO_SOURCE} (DACO, Puerto Rico)`, sourceUrl: DACO_DATA_URL }
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
/** County rent older than this (from the end of its as-of month) gets a stale badge (rules in staleness.ts). */
export { RENT_STALE_DAYS, monthOlderThan }

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

export function censusDonorZip(c: CensusData | null | undefined): string | undefined {
  if (!c) return undefined
  return c.donorZip ?? c.approxFromZip
}

/** "borrowed from zip 10025 (largest residential zip in the city)". */
export function donorPhrase(c: CensusData | null | undefined): string | null {
  // Borrowed bases name their source: "borrowed from zip 35464 (nearest with a reliable Census rent, 5.3 mi)",
  // "Cameron Parish, LA median (no zip figure)", "Louisiana median (no zip or county figure)"; the zip's own
  // top-coded median says so ("top-coded: Census reports only that the median is $3,500 or more, ...")
  if (c?.basisNote && c.basis && (c.basis !== 'zip' || c.rentCoded)) return c.basisNote
  const donor = censusDonorZip(c)
  if (!donor) return null
  const where = c?.donorScope === 'city' ? 'the city' : c?.donorScope === 'county' ? 'the county' : 'the area'
  return `borrowed from zip ${donor} (largest residential zip in ${where})`
}

/** "Census ACS 2023" (the rent base is only used when it is a local ACS figure). */
function censusLabel(c: CensusData): string {
  return `Census ACS ${c.year}`
}

function sinceMonth(period: string | null | undefined): string {
  return `since ${period ? fmtMonthYear(period) : BASELINE_MONTH_LABEL}`
}

export const ACCENTS = {
  gas: METRIC_COLORS.gas,
  rent: METRIC_COLORS.rent,
  shelter: METRIC_COLORS.shelter,
  groceries: METRIC_COLORS.groceries,
  electricity: METRIC_COLORS.electricity,
} as const

// ---------------------------------------------------------------- Gas

/**
 * Source + as-of for the national gas comparison, so two zips' "National" figures are never read as
 * one number: "U.S. city avg, BLS, Aug 2026" (BLS monthly tiers) vs "U.S. avg, EIA, week of Sep 28".
 */
export function gasNationalSourceTag(g: Pick<GasPriceData, 'frequency' | 'source'>, natLatest: string | undefined): string {
  if (isMonthlyGas(g)) return `U.S. city avg, BLS${natLatest ? `, ${fmtMonthYear(natLatest.slice(0, 7))}` : ''}`
  return `U.S. avg, EIA${natLatest ? `, week of ${fmtDay(natLatest).replace(/, \d{4}$/, '')}` : ''}`
}

/**
 * Short gas area for the card's source line: "Atlanta metro", "Midwest avg", "Honolulu-area*" (HI/AK
 * stand-in), "U.S. avg (local n/a)" (national outage stand-in), "Lower Atlantic avg (metro n/a)" (the
 * BLS metro series failed and the zip's EIA tier is shown).
 */
export function gasCardArea(g: GasPriceData | null | undefined, stateAbbr?: string | null): string | undefined {
  const geo = gasShortGeo(g, stateAbbr)
  if (!g || !geo) return undefined
  if (geo === 'U.S. avg; local n/a') return 'U.S. avg (local n/a)'
  const short = geo.replace(/-area price\*$/, `-area${GAS_STANDIN_MARK}`)
  return g.fallback === 'eia' ? `${short} (metro n/a)` : short
}

/** Short CPI area for the card's source line ("Atlanta metro", "South Atlantic div.", "U.S. avg (local n/a)"). */
export function cpiCardArea(c: CpiData | null | undefined): string | undefined {
  const geo = cpiShortGeo(c)
  return geo === 'U.S. avg; local n/a' ? 'U.S. avg (local n/a)' : geo
}

export function buildGasCard(s: EconomicSnapshot): HeroCardModel {
  const g = s.gas.data
  if (g && isStaticGas(g)) return buildStaticGasCard(s, g)
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
  const sourceName = g ? (monthly ? 'BLS' : 'EIA') : 'EIA / BLS'
  const shortDate = latestDate ? (monthly ? fmtMonthYear(latestDate.slice(0, 7)) : fmtDay(latestDate)) : undefined
  const base = {
    id: 'gas' as const,
    label: 'Gas (regular)',
    accentColor: ACCENTS.gas,
    provenance,
    stale: !!s.gas.stale,
    sourceLine: sourceLineOf(gasCardArea(g, s.location?.stateAbbr), sourceName, shortDate),
  }
  if (!g || !inRange(g.current, SANITY.gasPrice) || !inRange(g.baseline, SANITY.gasPrice) || !Number.isFinite(g.change)) {
    return { ...base, status: 'unavailable', info: [] }
  }
  // National from the same source over the same period (BLS monthly → same months).
  const nat = g.isNationalFallback ? null : gasNationalMatching(g)
  const natOk = !!nat && inRange(nat.current, SANITY.gasPrice)
  const caveat = gasCaveatFor(s)
  // Monthly BLS figures run weeks behind the weekly EIA ones: said in the ⓘ and by the source-line month.
  const detail = monthly && latestDate ? `through ${fmtMonthYear(latestDate.slice(0, 7))} (monthly)` : undefined
  const nationalValue = natOk
    ? `National: $${nat!.current.toFixed(2)}/gal (${fmtSignedDollars(nat!.change)}) · ${gasNationalSourceTag(g, nat!.latestDate)}`
    : undefined
  const dollarNote = `${fmtSignedDollars(g.change)}/gal since ${baselineDate ? (monthly ? fmtMonthYear(baselineDate) : `the week of ${fmtDay(baselineDate)}`) : BASELINE_MONTH_LABEL}`
  return {
    ...base,
    status: 'ok',
    geoTag: gasShortGeo(g, s.location?.stateAbbr),
    caveat,
    value: `$${g.current.toFixed(2)}/gal`,
    change: `${fmtSignedDollars(g.change)} since ${BASELINE_MONTH_LABEL}`,
    direction: directionOf(g.change, 2),
    secondary: natOk ? `U.S. ${fmtSignedDollars(nat!.change)}` : undefined,
    detail,
    nationalValue,
    dollarNote,
    info: compact([`${dollarNote}${detail ? `, ${detail}` : ''}.`, nationalValue, caveat]),
    asOfPeriod: latestDate?.slice(0, 7),
  }
}

/** Sanity ranges for the static gas sources ($/gal; remote Alaska villages pay well over $10). */
const STATIC_GAS_RANGE: Record<'dcra' | 'daco', readonly [number, number]> = { dcra: [1, 20], daco: [1, 10] }

/**
 * Alaska community survey (DCRA, twice yearly) or Puerto Rico DACO (monthly): the local series alone — neither
 * source publishes a U.S. figure, so there is no national comparison (never another source's).
 */
function buildStaticGasCard(s: EconomicSnapshot, g: GasPriceData): HeroCardModel {
  const dcra = g.source === 'dcra'
  const latest = g.latestDate?.slice(0, 7)
  const baseline = g.baselineDate?.slice(0, 7) ?? BASELINE_MONTH
  const when = (ym: string | undefined) => (ym ? `${fmtMonthYear(ym)}${dcra ? ' survey' : ''}` : DATE_UNAVAILABLE)
  const info = gasSourceInfo(g)
  const provenance: Provenance = {
    ...info,
    geography: g.geoLevel ?? g.region,
    window: dcra ? `twice yearly (Jan & Jul) · since ${when(baseline)}` : `monthly · since ${fmtMonthYear(baseline)}`,
    asOf: when(latest),
    adjustment: NOT_SA,
  }
  const base = {
    id: 'gas' as const,
    label: 'Gas (regular)',
    accentColor: ACCENTS.gas,
    provenance,
    stale: !!s.gas.stale,
    // A one-station survey price is said on the card face, not only in the ⓘ
    sourceLine: sourceLineOf(
      gasShortGeo(g, s.location?.stateAbbr),
      dcra ? (g.staticSource?.match !== 'region' && g.staticSource?.stations === 1 ? 'DCRA, 1 station' : 'DCRA') : 'DACO',
      latest ? fmtMonthYear(latest) : undefined,
    ),
  }
  const range = STATIC_GAS_RANGE[dcra ? 'dcra' : 'daco']
  if (!inRange(g.current, range) || !inRange(g.baseline, range) || !Number.isFinite(g.change)) {
    return { ...base, status: 'unavailable', info: [] }
  }
  const caveat = gasCaveatFor(s)
  const dollarNote = `${fmtSignedDollars(g.change)}/gal since ${when(baseline)}`
  const detail = dcra
    ? `Twice-yearly community survey: ${when(baseline)} vs ${when(latest)}` +
      (baseline && latest && baseline.slice(5, 7) !== latest.slice(5, 7)
        ? ' (a January and a July survey: different seasons; past surveys show no consistent January–July price gap)'
        : '')
    : `Island-wide monthly average: ${fmtMonthYear(baseline)} vs ${fmtMonthYear(latest)}`
  const noUs = dcra
    ? 'No U.S. comparison: the survey covers Alaska communities only.'
    : 'No U.S. comparison: DACO publishes Puerto Rico prices only.'
  return {
    ...base,
    status: 'ok',
    geoTag: gasShortGeo(g, s.location?.stateAbbr),
    caveat,
    value: `$${g.current.toFixed(2)}/gal`,
    change: `${fmtSignedDollars(g.change)} since ${dcra ? `${fmtMonthYear(baseline)} survey` : BASELINE_MONTH_LABEL}`,
    direction: directionOf(g.change, 2),
    secondary: dcra ? 'twice-yearly survey' : 'island-wide, monthly',
    detail,
    dollarNote,
    info: compact([
      `${dollarNote}.`, detail, caveat,
      dcra && g.staticSource && g.staticSource.match !== 'region'
        ? dcraStationsText(g.staticSource.place, g.staticSource.stations, g.staticSource.retailer)
        : undefined,
      noUs, dcra ? DCRA_ATTRIBUTION : undefined,
    ]),
    asOfPeriod: latest,
  }
}

// ---------------------------------------------------------------- Rent / Shelter

/** "rise" in spring/summer, when asking rents usually climb; a neutral word otherwise. */
function seasonalWord(asOf: string): string {
  const m = Number(asOf.slice(5, 7))
  return m >= 3 && m <= 9 ? 'rise' : 'swing'
}

/** "Fulton County", "Lafayette Parish": the county name without its state. */
function countyOnly(name: string | null | undefined): string {
  return (name ?? '').replace(/,\s*[A-Z]{2}$/, '').trim()
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
  const metro = r.level === 'metro'
  const area = metro ? metroShortName(r.geoName) : countyOnly(r.geoName)
  const base = {
    id: 'rent' as const,
    label: 'Rent (new leases)',
    accentColor: ACCENTS.rent,
    provenance,
    stale: monthOlderThan(r.asOf, RENT_STALE_DAYS, now),
    sourceLine: sourceLineOf(area, 'Zillow', fmtMonthYear(r.asOf)),
  }
  if (!inRange(r.pct, SANITY.pctChange) || !(r.curRent > 0) || !Number.isFinite(r.monthlyChange)) {
    return { ...base, status: 'unavailable', info: [SHELTER_VS_RENT_NOTE] }
  }
  // The $ figure is the seasonally adjusted change expressed in dollars, never a raw then-vs-now gap;
  // the raw level is shown only as a level, with its month.
  const dollarNote = `≈ ${fmtSignedDollars(r.monthlyChange, 0)}/mo vs ${fmtMonthYear(r.baseMonth)}, after adjusting for the usual seasonal ${seasonalWord(r.asOf)}`
  const detail = `Typical asking rent: ${fmtDollars(r.curRent)}/mo (${fmtMonthYear(r.asOf)})`
  const metroNote = metro ? rentMetroNote(r) : undefined
  const poolNote = rentSeasonalNote(r.saPool, r.saW, metro ? 'metro' : 'county')
  const seasonalCaveat = rentSeasonalCaveat(r.saCaveat, metro ? 'metro' : 'county')
  return {
    ...base,
    status: 'ok',
    value: fmtSignedPct(r.pct),
    inline: `≈ ${fmtSignedDollars(r.monthlyChange, 0)}/mo`,
    direction: directionOf(r.pct),
    secondary: sinceMonth(r.baseMonth),
    tags: caveat ? [OUTLIER_TAG] : undefined,
    dollarNote,
    detail,
    caveat,
    info: compact([`${dollarNote}.`, detail, metroNote, poolNote, seasonalCaveat, caveat, SHELTER_VS_RENT_NOTE]),
    asOfPeriod: r.asOf,
    // Long metro titles ("Nashville-Davidson--Murfreesboro--Franklin") shorten to the first city for images/meta
    geoTag: metro ? (area.length > 32 ? `${area.split(/-+/)[0]} metro` : area) : shortCountyName(r.geoName),
    ...(caveat ? { outlier: true } : {}),
  }
}

/** "Portland-South Portland, ME metro" → "Portland-South Portland metro" (state codes dropped). */
export function metroShortName(geoName: string): string {
  return geoName.replace(/, [A-Z]{2}(-[A-Z]{2})* metro$/, ' metro').replace(/, [A-Z]{2}(-[A-Z]{2})*$/, '')
}

/** Why a metro figure is on a county's card. */
export function rentMetroNote(r: Pick<RentData, 'geoName' | 'countyName' | 'countyWhy' | 'countyNotCurrent'>): string {
  const county = r.countyName ? countyOnly(r.countyName) : 'this county'
  const why = r.countyWhy === 'not-current'
    ? notCurrentText(county, r.countyNotCurrent)
    : r.countyWhy === 'too-new'
    ? `Zillow's series for ${county} is too new (it needs data from Jan 2024) to measure since Jan 2025`
    : r.countyWhy === 'no-baseline'
      ? `Zillow's series for ${county} has no Jan 2025 value, so its change since Jan 2025 can't be measured`
      : `Zillow publishes no rent series for ${county}`
  return `${why}; this is the ${r.geoName} series (the county's metro area).`
}

/** How rent is seasonally adjusted (same label as the data's meta.seasonalMethod). */
export const RENT_SA_LABEL =
  'seasonally adjusted by whatchanged (county pattern blended with the state (or U.S.) pattern based on history length)'

/** The seasonal adjustment of one rent series, said plainly: how much of its own pattern vs its state's it uses. */
export function rentSeasonalNote(pool: string | undefined, w: number | undefined, level: 'county' | 'metro' = 'county'): string {
  const head = `Seasonally adjusted by whatchanged (${level} pattern blended with the state (or U.S.) pattern based on history length)`
  if (!pool || typeof w !== 'number' || !Number.isFinite(w)) return `${head}.`
  const own = level === 'metro' ? 'the metro’s own pattern' : 'the county’s own pattern'
  if (w <= 0) return `${head}: this series is too short to estimate its own pattern, so it uses the typical pattern of ${pool}.`
  const ownPct = Math.round(w * 100)
  return `${head}: ${ownPct}% ${own}, ${100 - ownPct}% the typical pattern of ${pool}.`
}

/** Wording for the shelter card's dollar figure (owner-approved). */
export const SHELTER_DOLLAR_BASIS = 'rent of primary residence (BLS) applied to local median rent'

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
    label: 'Shelter (CPI)',
    accentColor: ACCENTS.shelter,
    provenance,
    stale: cpiItemStale(s, 'shelter'),
    sourceLine: sourceLineOf(cpiCardArea(c), 'BLS', latest ? fmtMonthYear(latest) : undefined),
  }
  // BLS shelter also has lodging away from home and tenants'/household insurance (~5% of the index)
  const CONCEPT = "CPI shelter is mainly rents plus owners' equivalent rent for homeowners, and covers existing leases, so new-lease rents can differ."
  const pct = c?.shelterChange
  if (!c || !inRange(pct, SANITY.pctChange)) return { ...base, status: 'unavailable', info: [CONCEPT] }

  const census = s.census.data
  const hasLocalRent = !!census && !census.isFallback && !census.isRentFallback && census.medianRent > 0
  // National CPI (fallback during an outage, or a territory with no local CPI) is never applied to
  // local rent: no dollar figure, and say why.
  const cpiIsNational = c.fallback === 'national' || cpiTierOf(c) === 4
  // The $ uses the same area's rent-of-primary-residence index; without it (e.g. an older cached
  // payload) there is no dollar figure — never the shelter % applied to rent.
  const rentIdx = inRange(c.rentIndexChange, SANITY.pctChange) ? c.rentIndexChange : null
  const rawDollars = s.dollarImpact?.shelter
  const dollars = !cpiIsNational && hasLocalRent && rentIdx !== null && typeof rawDollars === 'number' && Number.isFinite(rawDollars)
    ? rawDollars
    : null
  const nat = nationalChangeMatching(c.nationalSeries, shelterOf, c.shelterBaselinePeriod, latest)
  const natOk = !!nat && c.tier !== 4
  const donor = donorPhrase(census)
  const rentIdxSince = sinceMonth(c.rentIndexBaselinePeriod ?? BASELINE_MONTH)
  const detail = dollars !== null
    ? `Base: ${fmtRentFigure(census!.medianRent, census!.rentCoded)}/mo median rent (${censusLabel(census!)}${donor ? `, ${donor}` : ''}) × 12 × ` +
      `rent of primary residence (BLS) ${fmtSignedPct(rentIdx!)} ${rentIdxSince}.`
    : cpiIsNational
      ? `No dollar estimate: ${c.fallback === 'national' ? 'local shelter CPI is unavailable, so this is the national figure' : 'BLS publishes no local shelter CPI here, so this is the national figure'}, which is not applied to local rent.`
      : !hasLocalRent
        ? 'No local rent figure for a dollar estimate.'
        : 'No dollar estimate: the BLS rent-of-primary-residence index for this area is unavailable right now.'
  // The zip's own top-/bottom-coded median ($3,500+ / under $100) bounds the $ figure: "or more" / "or less" ("… saved" for a decrease)
  const rentDollars = dollars !== null ? fmtRentDollars(dollars, census!.basis === 'zip' ? census!.rentCoded : undefined) : null
  const dollarNote = rentDollars !== null ? `${rentDollars} in rent: ${SHELTER_DOLLAR_BASIS}` : undefined
  const nationalValue = natOk ? `National: ${fmtSignedPct(nat!.pct)} (U.S. city avg, BLS CPI shelter)` : undefined
  const moreProvenance: Provenance[] | undefined = rentIdx !== null && !cpiIsNational
    ? [{
        source: 'BLS CPI rent of primary residence',
        sourceUrl: c.seriesIds?.rent ? `https://data.bls.gov/timeseries/${c.seriesIds.rent}` : 'https://data.bls.gov/cgi-bin/surveymost?cu',
        geography: cpiGeoLabel(c),
        window: rentIdxSince,
        asOf: fmtMonthYear(c.rentIndexLatestPeriod),
        adjustment: NOT_SA,
      }]
    : undefined
  return {
    ...base,
    status: 'ok',
    geoTag: cpiShortGeo(c),
    value: fmtSignedPct(pct),
    inline: rentDollars !== null ? `${rentDollars} in rent` : undefined,
    direction: directionOf(pct),
    secondary: sourceLineOf(sinceMonth(c.shelterBaselinePeriod ?? BASELINE_MONTH), natOk ? `U.S. ${fmtSignedPct(nat!.pct)}` : undefined),
    dollarNote,
    detail,
    nationalValue,
    info: compact([dollarNote && `${dollarNote}.`, detail, CONCEPT, nationalValue]),
    moreProvenance,
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
  const base = {
    id: 'groceries' as const,
    label: 'Groceries',
    accentColor: ACCENTS.groceries,
    provenance,
    stale: cpiItemStale(s, 'groceries'),
    sourceLine: sourceLineOf(cpiCardArea(c), 'BLS', latest ? fmtMonthYear(latest) : undefined),
  }
  const pct = c?.groceriesChange
  if (!c || !inRange(pct, SANITY.pctChange)) return { ...base, status: 'unavailable', info: [] }
  const dollars = s.dollarImpact?.groceries
  const hasDollars = typeof dollars === 'number' && Number.isFinite(dollars)
  const nat = nationalChangeMatching(c.nationalSeries, p => p.groceries, c.groceriesBaselinePeriod, latest)
  const natOk = !!nat && c.tier !== 4
  const dollarNote = hasDollars
    ? `≈ ${fmtSignedDollars(dollars, 0)}/yr on ${fmtDollars(ANNUAL_GROCERY_BASE)}/yr of groceries (typical household food-at-home spending)`
    : undefined
  const nationalValue = natOk ? `National: ${fmtSignedPct(nat!.pct)} (U.S. city avg, BLS CPI food at home)` : undefined
  const national = c.tier === 4 || c.fallback === 'national'
  const detail = hasDollars
    ? undefined
    : national
      ? 'No dollar estimate: only the U.S. average CPI applies here, and a U.S. change isn’t a local cost (same rule as the shelter card).'
      : 'Dollar estimate unavailable'
  return {
    ...base,
    status: 'ok',
    geoTag: cpiShortGeo(c),
    value: fmtSignedPct(pct),
    inline: hasDollars ? `≈ ${fmtSignedDollars(dollars, 0)}/yr` : undefined,
    direction: directionOf(pct),
    secondary: sourceLineOf(sinceMonth(c.groceriesBaselinePeriod ?? BASELINE_MONTH), natOk ? `U.S. ${fmtSignedPct(nat!.pct)}` : undefined),
    dollarNote,
    detail,
    nationalValue,
    info: compact([dollarNote && `${dollarNote}.`, detail, nationalValue]),
    asOfPeriod: latest,
  }
}

// ---------------------------------------------------------------- Electricity

export const ELECTRICITY_SOURCE = 'EIA average residential electricity price'
export const ELECTRICITY_SOURCE_URL = 'https://www.eia.gov/electricity/data/browser/'
export const ELECTRICITY_ADJUSTMENT = '12-month average prices (no seasonal adjustment needed)'
/** Card label beside the big number (the 12-month average price). */
export const ELECTRICITY_VALUE_NOTE = '12-mo avg'
/** Why the card compares 12-month averages (ⓘ on the card and the graph). */
export const ELECTRICITY_METHOD_NOTE =
  'Why 12-month averages: residential electricity prices swing with the seasons (in many states summer\'s price per kWh ' +
  'runs well above winter\'s), so comparing one month with another mostly measures the calendar. Averaging a full year on ' +
  'both sides counts every season once: the latest 12 months vs the 12 months centered on January 2025 ' +
  `(${fmtMonthYear(ELECTRICITY_BASELINE_FROM)}–${fmtMonthYear(ELECTRICITY_BASELINE_TO)}; a year can't be centered exactly on ` +
  'Jan 20, and this window\'s midpoint, about Jan 30, is the closest). A year ending January 2025 would be centered on ' +
  'mid-2024 and count months of change from before January 2025.'
/** "+7.4% vs yr centered on Jan '25" (the card face; the ⓘ spells out both 12-month windows). */
export function electricityChangePhrase(e: Pick<ElectricityData, 'change'>): string {
  return `${fmtSignedPct(e.change)} vs ${ELECTRICITY_BASELINE_SHORT}`
}
/** "Aug 2025–Jul 2026". */
export const fmtWindow = (from: string | undefined, to: string) => (from ? `${fmtMonthYear(from)}–${fmtMonthYear(to)}` : fmtMonthYear(to))
/** Territories: EIA publishes no residential retail price. */
export const ELECTRICITY_TERRITORY_NOTE = (place: string) => `EIA publishes no residential electricity price for ${place}.`

/** "Maine", "District of Columbia" → "DC" on space-limited surfaces. */
export function electricityPlace(e: Pick<ElectricityData, 'state' | 'stateName'> | null | undefined, style: 'full' | 'short' = 'full'): string {
  if (!e) return 'state'
  if (e.state === 'DC') return style === 'short' ? 'DC' : 'District of Columbia'
  return e.stateName || e.state
}

/** "32.4¢/kWh". */
export const fmtCents = (v: number) => `${v.toFixed(1)}¢/kWh`

export function buildElectricityCard(s: EconomicSnapshot): HeroCardModel {
  const e = s.electricity?.data ?? null
  const st = s.location?.stateAbbr
  const place = e ? electricityPlace(e) : (st && TERRITORY_NAMES[st]) || s.location?.stateName || 'this area'
  const provenance: Provenance = {
    source: ELECTRICITY_SOURCE,
    sourceUrl: ELECTRICITY_SOURCE_URL,
    geography: e ? `${place} (statewide average)` : place,
    window: e
      ? `12 months ending ${fmtMonthYear(e.latestPeriod)} vs ${ELECTRICITY_BASELINE_LABEL} (${fmtWindow(e.baselineFrom, e.baselinePeriod)})`
      : `since ${BASELINE_MONTH_LABEL}`,
    asOf: e ? fmtMonthYear(e.latestPeriod) : DATE_UNAVAILABLE,
    adjustment: ELECTRICITY_ADJUSTMENT,
  }
  const base = {
    id: 'electricity' as const,
    label: 'Electricity',
    accentColor: ACCENTS.electricity,
    provenance,
    stale: !!s.electricity?.stale,
    sourceLine: sourceLineOf(e ? electricityPlace(e, 'short') : place, 'EIA', e ? fmtMonthYear(e.latestPeriod) : undefined),
  }
  if (!e) {
    const territory = st && TERRITORY_NAMES[st]
    return { ...base, status: 'unavailable', info: compact([territory ? ELECTRICITY_TERRITORY_NOTE(territory) : undefined]) }
  }
  if (!inRange(e.current, SANITY.electricityPrice) || !inRange(e.change, SANITY.electricityChange)) {
    return { ...base, status: 'unavailable', info: [ELECTRICITY_METHOD_NOTE] }
  }
  const dollars = s.dollarImpact?.electricity
  const hasDollars = typeof dollars === 'number' && Number.isFinite(dollars) && typeof e.usageKwh === 'number'
  const usage = hasDollars
    ? `${Math.round(e.usageKwh!).toLocaleString('en-US')} kWh` +
      (e.usageFrom && e.usageTo ? `, 12-mo avg ${fmtWindow(e.usageFrom, e.usageTo)}` : ', 12-mo avg')
    : null
  const priceChange = e.current - e.baseline
  const dollarNote = hasDollars
    ? `≈ ${fmtSignedDollars(dollars!, 0)}/mo: change in the 12-month average price (${priceChange >= 0 ? '+' : '−'}${Math.abs(priceChange).toFixed(2)}¢/kWh) × an average ${place} home's monthly use (${usage})`
    : undefined
  const detail = `12-month average price: ${fmtCents(e.current)} (${fmtWindow(e.currentFrom, e.latestPeriod)}) vs ` +
    `${fmtCents(e.baseline)} (${fmtWindow(e.baselineFrom, e.baselinePeriod)}, centered on ${BASELINE_MONTH_LABEL}). ` +
    `Latest month as published: ${fmtCents(e.latestMonthPrice)} in ${fmtMonthYear(e.latestPeriod)}.`
  const natOk = typeof e.nationalChange === 'number' && Number.isFinite(e.nationalChange)
  const nationalValue = natOk ? `National: ${fmtSignedPct(e.nationalChange!)} (U.S. average, EIA, same 12-month windows)` : undefined
  return {
    ...base,
    status: 'ok',
    geoTag: electricityPlace(e, 'short'),
    value: fmtCents(e.current),
    valueNote: ELECTRICITY_VALUE_NOTE,
    inline: hasDollars ? `≈ ${fmtSignedDollars(dollars!, 0)}/mo` : undefined,
    direction: directionOf(e.change),
    secondary: sourceLineOf(electricityChangePhrase(e), natOk ? `U.S. ${fmtSignedPct(e.nationalChange!)}` : undefined),
    dollarNote,
    detail,
    nationalValue,
    info: compact([
      dollarNote ? `${dollarNote}.` : 'Dollar estimate unavailable (no recent usage figure for this state).',
      detail,
      ELECTRICITY_METHOD_NOTE,
      nationalValue,
      `Statewide average across utilities: your own rate and bill can differ.`,
    ]),
    asOfPeriod: e.latestPeriod,
  }
}

// ---------------------------------------------------------------- All

/**
 * Source credits for the share card / OG footer: "BLS · EIA · Zillow", plus the Alaska survey (CC BY 4.0 requires
 * credit) or DACO where they supply the gas number; "Census" when the shelter card's $ uses local median rent.
 */
export function imageSourcesLine(s: EconomicSnapshot, cards: HeroCardModel[]): string {
  const ok = (id: HeroCardId) => cards.some(c => c.id === id && c.status === 'ok')
  const g = ok('gas') ? s.gas.data : null
  const parts = ['BLS']
  if ((g && (!g.source || g.source === 'eia')) || ok('electricity')) parts.push('EIA')
  parts.push(ok('rent') ? 'Zillow' : 'Census')
  if (g?.source === 'dcra') parts.push('AK DCRA (CC BY 4.0)')
  if (g?.source === 'daco') parts.push('DACO')
  return parts.join(' · ')
}

/** Gas, Rent (or CPI shelter fallback), Groceries, Electricity — always four cards. */
export function buildHeroCards(s: EconomicSnapshot, county?: HeroCountyContext | null): HeroCardModel[] {
  return [
    buildGasCard(s),
    buildRentCard(s, county) ?? buildShelterCard(s),
    buildGroceryCard(s),
    buildElectricityCard(s),
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
  let elec = ''
  for (const c of cards) {
    if (c.status !== 'ok') continue
    if (c.id === 'gas' && snapshot.gas.data) {
      // Monthly BLS gas runs weeks behind weekly EIA: name its month ("Philadelphia metro, thru Aug '26")
      const g = snapshot.gas.data
      const thru = isMonthDatedGas(g) && c.asOfPeriod ? `thru ${fmtMonthShort(c.asOfPeriod)}` : ''
      const gtag = c.geoTag ? ` (${c.geoTag}${thru ? `, ${thru}` : ''})` : thru ? ` (${thru})` : ''
      parts.push(`Gas ${fmtSignedDollars(g.change)}/gal${gtag}`)
    }
    if (c.id === 'rent') parts.push(`Rent ${c.value}${mark(c)}${tag(c)}`)
    if (c.id === 'shelter') parts.push(`Shelter CPI ${c.value}${tag(c)}`)
    if (c.id === 'groceries') parts.push(`Groceries ${c.value}${tag(c)}`)
    if (c.id === 'electricity' && snapshot.electricity?.data) {
      // Its own window (not "since Jan 2025"): latest 12-mo average vs the 12 months centered on Jan 2025
      elec = `Electricity ${fmtSignedPct(snapshot.electricity.data.change)} (${c.geoTag ? `${c.geoTag}, ` : ''}12-mo avg vs ${ELECTRICITY_BASELINE_SHORT})`
    }
  }
  const head = parts.length ? `Since ${BASELINE_MONTH_LABEL}: ` : ''
  const gasStandIn = cards.some(c => c.id === 'gas' && c.status === 'ok') && isGasStandIn(snapshot.gas.data)
  const foot = (cards.some(c => c.status === 'ok' && c.outlier) ? ` · ${OUTLIER_MARK}unusual value` : '') +
    (gasStandIn ? ` · ${GAS_STANDIN_FOOTNOTE(standInPlace(snapshot.location, 'text'))}` : '')
  const body = `${head}${parts.join(' · ')}${elec ? `${parts.length ? '; ' : ''}${elec}` : ''}`
  return `${body}${foot} · whatchanged.us`
}
