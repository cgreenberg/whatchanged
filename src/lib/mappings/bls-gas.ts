// BLS CPI average-price gas tiers: monthly APU{area}74714 ("Gasoline, unleaded
// regular, per gallon") for places EIA publishes no weekly city series.
//
// Verified 2026-10 (BLS API, 3 calls): every area below publishes a MONTHLY
// series with a January 2025 value (also for bimonthly CPI metros). Since June
// 2021 BLS builds these from crowdsourced station prices (~91k stations),
// weighted by county expenditure (https://www.bls.gov/cpi/factsheets/acm-gasoline.htm).
//
// Lookup order (getGasLookup, most local first):
//   1 EIA weekly city (county override / CPI metro → EIA city)
//   2 BLS monthly CPI metro without an EIA city (incl. Honolulu S49F, Anchorage S49G)
//   3 HI / AK zips outside those two CBSAs → the Honolulu (S49F) / Anchorage (S49G)
//     series as a labeled stand-in: neither EIA nor BLS publishes anything closer
//   4 EIA weekly state (9 states)   5 EIA weekly PADD / sub-PADD   6 EIA national
//
// BLS Census-division gas series exist (e.g. East North Central 0230) but are
// NOT used: they are urban averages weighted to the division's big metros, so
// they read as more local than they are. Midwest zips keep EIA PADD 2 (R20).

import { BLS_CPI_AREAS } from './county-metro-cpi'

/** BLS item code for regular unleaded gasoline, per gallon (average price data). */
export const BLS_GAS_ITEM = '74714'

/** U.S. city average — the national comparison for BLS gas tiers. */
export const BLS_GAS_NATIONAL_AREA = '0000'

/** Every area with a verified monthly APU…74714 series including Jan 2025. */
export const BLS_GAS_PUBLISHED_AREAS: ReadonlySet<string> = new Set([
  '0000', '0100', '0200', '0300', '0400',
  '0110', '0120', '0230', '0240', '0350', '0360', '0370', '0480', '0490',
  'S11A', 'S12A', 'S12B', 'S23A', 'S23B', 'S24A', 'S24B',
  'S35A', 'S35B', 'S35C', 'S35D', 'S35E', 'S37A', 'S37B',
  'S48A', 'S48B', 'S49A', 'S49B', 'S49C', 'S49D', 'S49E', 'S49F', 'S49G',
])

/**
 * HI / AK zips outside the Honolulu / Anchorage CBSAs: no EIA or BLS gas series covers them, so
 * the Honolulu (S49F) / Anchorage (S49G) series is shown as a labeled stand-in (GasLookupResult.standIn).
 */
export const BLS_GAS_STATE_AREA: Record<string, string> = { HI: 'S49F', AK: 'S49G' }

/**
 * Proper short names for gas labels. BLS titles S49F / S49G "Urban Hawaii" / "Urban Alaska", but
 * the samples are the Urban Honolulu CBSA (county 15003) and the Anchorage CBSA (02020, 02170) only.
 */
const BLS_GAS_AREA_NAMES: Record<string, string> = {
  S49F: 'Honolulu',
  S49G: 'Anchorage',
}

/** "S12B" → "APUS12B74714". */
export function blsGasSeriesId(area: string): string {
  return `APU${area}${BLS_GAS_ITEM}`
}

/** CPI metro area code (S…) the app knows and BLS publishes gas prices for. */
export function isBlsGasMetro(area: string | undefined): area is string {
  return !!area && /^S/.test(area) && !!BLS_CPI_AREAS[area] && BLS_GAS_PUBLISHED_AREAS.has(area)
}

/** Honolulu (S49F) / Anchorage (S49G): the only BLS gas series for Hawaii / Alaska. */
export function isBlsHiAkArea(area: string): boolean {
  return area === 'S49F' || area === 'S49G'
}

export function blsGasAreaName(area: string): string {
  if (area === BLS_GAS_NATIONAL_AREA) return 'U.S. city average'
  return BLS_GAS_AREA_NAMES[area] ?? BLS_CPI_AREAS[area]?.name ?? area
}
