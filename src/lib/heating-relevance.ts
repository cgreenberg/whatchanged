// Where a home heating fuel matters: the share of a state's occupied homes heating with it (Census ACS table
// B25040, house heating fuel, bundled by scripts/build-heating-fuel-share.ts). The Home heating graph shows a
// fuel's tab only where at least HEATING_RELEVANCE_MIN_PCT of the state's homes use it, so urban gas-heat
// states (e.g. Georgia: 0.2% oil, 3.6% propane) get no heating graph.

import share from '@/lib/data/heating-fuel-share.json'

export const HEATING_RELEVANCE_MIN_PCT = 5

interface ShareFile {
  meta: { source: string; table: string; dataset: string; vintage: number; url: string }
  states: Record<string, { oil: number; propane: number; name: string }>
}
const FILE = share as unknown as ShareFile

export const HEATING_SHARE_META = FILE.meta

/** % of the state's occupied homes heating with this fuel (null: no ACS figure for the state). */
export function heatingFuelShare(state: string | null | undefined, product: 'oil' | 'propane'): number | null {
  const row = state ? FILE.states[state.toUpperCase()] : undefined
  const v = row?.[product]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function isHeatingFuelRelevant(state: string | null | undefined, product: 'oil' | 'propane'): boolean {
  const v = heatingFuelShare(state, product)
  return v !== null && v >= HEATING_RELEVANCE_MIN_PCT
}

/** "In Maine, 50.3% of homes heat with fuel oil or kerosene (Census ACS 2024 1-year, table B25040)." */
export function heatingShareNote(state: string | null | undefined, product: 'oil' | 'propane'): string | null {
  const v = heatingFuelShare(state, product)
  const name = state ? FILE.states[state.toUpperCase()]?.name : undefined
  if (v === null || !name) return null
  const fuel = product === 'oil' ? 'fuel oil or kerosene' : 'propane (bottled, tank or LP gas)'
  const kind = FILE.meta.dataset.endsWith('acs1') ? '1-year' : '5-year'
  return `In ${name}, ${v.toFixed(1)}% of homes heat with ${fuel} (Census ACS ${FILE.meta.vintage} ${kind}, table ${FILE.meta.table}); ` +
    `this graph appears only where at least ${HEATING_RELEVANCE_MIN_PCT}% do.`
}
