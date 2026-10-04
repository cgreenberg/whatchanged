import type { UnemploymentData, UnemploymentPoint } from '@/types'
import {
  fetchBlsSeries,
  parseBlsMonthly,
  findBaseline,
  findLatest,
  type BlsRawPoint,
  type MonthlyPoint,
} from './bls-common'
import { getLausAreaForCounty, CT_PLANNING_REGION_NAMES } from '@/lib/mappings/laus-area'

// BLS series ID format for county unemployment rate: LAUCN{FIPS}0000000003
// FIPS must be exactly 5 digits (state 2 + county 3). The argument is a LAUS
// area FIPS (see mappings/laus-area.ts); legacy Connecticut county FIPS
// (09001–09015) are translated to their dominant 2022 planning region as a
// fallback — prefer resolving the planning region per zip.
export function buildSeriesId(lausFips: string): string {
  return `LAUCN${getLausAreaForCounty(lausFips).fips}0000000003`
}

/** Display name for a LAUS area: CT planning region name, else undefined (use the county name). */
export function lausAreaName(lausFips: string): string | undefined {
  return CT_PLANNING_REGION_NAMES[getLausAreaForCounty(lausFips).fips]
}

// National unemployment rate, NOT seasonally adjusted — matches the NSA county LAUS series.
export const NATIONAL_UNEMPLOYMENT_SERIES = 'LNU04000000'

function toRatePoint(p: MonthlyPoint): UnemploymentPoint {
  return p.preliminary ? { date: p.date, rate: p.value, preliminary: true } : { date: p.date, rate: p.value }
}

function toRatePoints(raw: BlsRawPoint[] | undefined): UnemploymentPoint[] {
  return parseBlsMonthly(raw).map(toRatePoint)
}

/**
 * Pure parser for a BLS LAUS response (exported for tests).
 * baseline = Jan 2025 (or null if unpublished); latest = most recent valid month.
 */
export function parseUnemploymentResponse(
  seriesMap: Record<string, BlsRawPoint[]>,
  countyFips: string
): UnemploymentData {
  const seriesId = buildSeriesId(countyFips)
  const points = parseBlsMonthly(seriesMap[seriesId])
  if (!points.length) {
    throw new Error(`No valid BLS data returned for county FIPS ${countyFips}`)
  }

  const latest = findLatest(points)!
  const baselineObs = findBaseline(points)
  // LAUS is monthly — only an actual Jan 2025 value counts as the baseline.
  const baseline = baselineObs && baselineObs.period === '2025-01' ? baselineObs : null

  const nationalSeries = toRatePoints(seriesMap[NATIONAL_UNEMPLOYMENT_SERIES])

  return {
    current: latest.value,
    latestPeriod: latest.period,
    latestPreliminary: points[points.length - 1].preliminary === true,
    baseline: baseline ? baseline.value : null,
    baselinePeriod: baseline ? baseline.period : null,
    change: baseline ? parseFloat((latest.value - baseline.value).toFixed(1)) : null,
    series: points.map(toRatePoint),
    countyFips,
    lausFips: getLausAreaForCounty(countyFips).fips,
    ...(lausAreaName(countyFips) ? { lausAreaName: lausAreaName(countyFips) } : {}),
    seriesId,
    ...(nationalSeries.length
      ? { nationalSeries, nationalSeriesId: NATIONAL_UNEMPLOYMENT_SERIES }
      : {}),
  }
}

export async function fetchUnemployment(
  countyFips: string,
  options: { startYear?: string; endYear?: string } = {}
): Promise<UnemploymentData> {
  const seriesId = buildSeriesId(countyFips)
  const seriesMap = await fetchBlsSeries([seriesId, NATIONAL_UNEMPLOYMENT_SERIES], {
    startYear: options.startYear,
    endYear: options.endYear,
    label: 'BLS',
  })
  if (!seriesMap[seriesId]?.length) {
    throw new Error(`No BLS data returned for county FIPS ${countyFips}`)
  }
  return parseUnemploymentResponse(seriesMap, countyFips)
}
