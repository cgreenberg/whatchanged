// Client-safe facts about the static (bundled) gas sources — names, links, license — shared by the ladder
// config (src/lib/resolution/ladders.ts, which never imports data files) and src/lib/static-gas.ts.
import { monthOlderThan } from '@/lib/staleness'

export const DCRA_SOURCE = 'Alaska DCRA Community Fuel Price Survey'
export const DCRA_PUBLISHER = 'Alaska DCCED, Division of Community and Regional Affairs'
export const DCRA_LICENSE = 'CC BY 4.0'
export const DCRA_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
/** The survey data (DCRA's open-data mirror of "Gas Prices, All Years"). */
export const DCRA_DATA_URL = 'https://gis.data.alaska.gov/maps/DCCED::gas-prices-all-years'
export const DCRA_HOME = 'https://akenergygateway.alaska.edu/explore/data/public_fuel_prices'
/** CC BY 4.0 attribution (credit, license, changes). */
export const DCRA_ATTRIBUTION =
  `Source: ${DCRA_SOURCE}, ${DCRA_PUBLISHER} (${DCRA_LICENSE}). whatchanged matches each zip to a surveyed community or region average; prices as published.`
/** A survey older than this (from the end of its survey month) means a twice-yearly survey was missed. */
export const DCRA_STALE_DAYS = 270

export const DACO_SOURCE = 'DACO monthly average price, regular gasoline'
export const DACO_PUBLISHER = 'Departamento de Asuntos del Consumidor (DACO), Puerto Rico'
export const DACO_HOME = 'https://www.daco.pr.gov/recursos'
export const DACO_DATA_URL =
  'https://docs.pr.gov/files/DACO/Gasolina/Precios%20Promedio%20Mensual%20al%20Consumidor/Precios-Promedios-de-Gasolina-y-Diesel%20(1).xlsx'
/** Monthly, published a few weeks after the month: older than this = a missed month. */
export const DACO_STALE_DAYS = 75

/**
 * true when a bundled static gas series (Alaska DCRA survey / Puerto Rico DACO) is overdue: its latest survey or month
 * ended more than DCRA_STALE_DAYS / DACO_STALE_DAYS before `now`.
 */
export function isStaticGasStale(kind: 'dcra' | 'daco', latestDate: string, now: Date = new Date()): boolean {
  return monthOlderThan(latestDate.slice(0, 7), kind === 'dcra' ? DCRA_STALE_DAYS : DACO_STALE_DAYS, now)
}

/**
 * How a bundled static gas value is shown — ONE rule for the gas card's ladder (rung status) and the county map
 * (area `stale` flag): an overdue survey / month is still the value shown, marked stale ('stale'); otherwise 'used'.
 * It never falls to the next rung, so the card and the map always show the same series for the same place.
 */
export function staticGasStatus(kind: 'dcra' | 'daco', latestDate: string, now: Date = new Date()): 'used' | 'stale' {
  return isStaticGasStale(kind, latestDate, now) ? 'stale' : 'used'
}

/** "1 station surveyed (University Chevron)." / "3 stations surveyed." / "Station count not published." */
export function dcraStationsText(place: string, stations?: number, retailer?: string): string {
  if (typeof stations !== 'number' || stations < 1) return `DCRA's ${place} figure is a community survey price (station count not published).`
  return stations === 1
    ? `DCRA's ${place} figure is one retailer's reported price (1 station surveyed${retailer ? `: ${retailer}` : ''}).`
    : `DCRA's ${place} figure reflects ${stations} surveyed stations.`
}
