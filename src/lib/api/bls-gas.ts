// BLS CPI average price, regular gasoline (APU{area}74714) — monthly gas tiers.
// Baseline = the series' own January 2025 value; current = its latest month.
// Never mixed with EIA: a BLS-tier location compares to the BLS U.S. city
// average (APU000074714) over the same months.

import type { GasLookupResult, GasSeriesData } from './eia'
import { fetchBlsSeries, parseBlsMonthly, blsUnpublishedMonths, BASELINE_PERIOD_KEY, type BlsRawPoint } from './bls-common'
import {
  blsGasSeriesId,
  blsGasAreaName,
  BLS_GAS_NATIONAL_AREA,
} from '@/lib/mappings/bls-gas'

export const BLS_GAS_KEY_PREFIX = 'bls:gas'

export function blsGasCacheKey(area: string): string {
  return `${BLS_GAS_KEY_PREFIX}:${area}`
}

/**
 * Lookup for a BLS gas area. Metro (incl. Honolulu S49F / Anchorage S49G) → tier 1;
 * region / U.S. → tier 3. `standIn`: a HI / AK zip outside the Honolulu / Anchorage CBSA, shown
 * that metro's series because no EIA or BLS series covers it → tier 2, labeled "Honolulu-area price (BLS)".
 */
export function describeBlsGasArea(area: string, opts: { standIn?: boolean } = {}): GasLookupResult {
  const name = blsGasAreaName(area)
  let tier: 1 | 2 | 3
  let geoLevel: string
  if (area === BLS_GAS_NATIONAL_AREA) {
    tier = 3
    geoLevel = 'National avg'
  } else if (opts.standIn) {
    tier = 2
    geoLevel = `${name}-area price (BLS)`
  } else if (/^S/.test(area)) {
    tier = 1
    geoLevel = `${name} metro avg`
  } else {
    tier = 3
    geoLevel = /^0\d00$/.test(area) ? `${name} region avg` : `${name} division avg`
  }
  return {
    source: 'bls',
    frequency: 'monthly',
    areaCode: area,
    areaName: name,
    seriesId: blsGasSeriesId(area),
    geoLevel,
    tier,
    cacheKey: blsGasCacheKey(area),
    ...(opts.standIn ? { standIn: true } : {}),
  }
}

export const BLS_NATIONAL_GAS_LOOKUP = describeBlsGasArea(BLS_GAS_NATIONAL_AREA)

/**
 * Pure parser for one BLS gas series (exported for tests). Dates are YYYY-MM.
 * Baseline must be exactly January 2025 (every published area has it); throws otherwise.
 */
export function parseBlsGasSeries(data: BlsRawPoint[] | undefined | null, areaName: string): GasSeriesData {
  const points = parseBlsMonthly(data)
  if (!points.length) throw new Error(`No BLS gas price data for ${areaName}`)
  const base = points.find((p) => p.date === BASELINE_PERIOD_KEY)
  if (!base) throw new Error(`No January 2025 BLS gas price for ${areaName}`)
  const latest = points[points.length - 1]
  // Unpublished months inside the series' span (e.g. Oct 2025) stay visible as chart gaps
  const unpublished = blsUnpublishedMonths(data).filter((d) => d > points[0].date && d < latest.date)
  return {
    current: latest.value,
    latestDate: latest.date,
    baseline: base.value,
    baselineDate: base.date,
    change: parseFloat((latest.value - base.value).toFixed(3)),
    series: points.map((p) => ({ date: p.date, price: p.value })),
    regionName: areaName,
    ...(unpublished.length ? { unpublished } : {}),
  }
}

/** Fetch + parse one BLS gas series (runtime cache miss: a single-series BLS call). */
export async function fetchBlsGasSeries(area: string, opts: { timeoutMs?: number } = {}): Promise<GasSeriesData> {
  const id = blsGasSeriesId(area)
  const map = await fetchBlsSeries([id], { label: 'BLS gas', timeoutMs: opts.timeoutMs })
  return parseBlsGasSeries(map[id], blsGasAreaName(area))
}
