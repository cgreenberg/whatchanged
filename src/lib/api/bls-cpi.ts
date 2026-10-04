import type { CpiData, CpiPoint } from '@/types'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import {
  fetchBlsSeries,
  parseBlsMonthly,
  blsUnpublishedMonths,
  findBaseline,
  findLatest,
  pctChange,
  type BlsRawPoint,
  type MonthlyPoint,
} from './bls-common'

export const NATIONAL_CPI_AREA = '0000'

export function cpiSeriesIds(areaCode: string) {
  return {
    groceries: `CUUR${areaCode}SAF11`,
    shelter: `CUUR${areaCode}SAH1`,
    energy: `CUUR${areaCode}SA0E`,
    /** Rent of primary residence: used only for the shelter card's dollar figure (not charted). */
    rent: `CUUR${areaCode}SEHA`,
  }
}

export function cpiCacheKey(areaCode: string): string {
  return `bls:cpi:${areaCode}:all`
}

function buildCpiPoints(g: MonthlyPoint[], s: MonthlyPoint[], e: MonthlyPoint[], unpublished: string[] = []): CpiPoint[] {
  // Union of months across the three items: an area with a gap in one series
  // (e.g. Phoenix food-at-home 2026M02–M07) keeps the other items' months. Months BLS listed but
  // published for no item (e.g. Oct 2025) stay as empty rows inside the span, so charts mark the gap.
  const maps = [g, s, e].map((series) => new Map(series.map((p) => [p.date, p])))
  const valued = [...new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()])].sort()
  const inSpan = unpublished.filter((d) => valued.length && d > valued[0] && d < valued[valued.length - 1])
  const dates = [...new Set([...valued, ...inSpan])].sort()
  return dates.map((date) => {
    const [gp, sp, ep] = maps.map((m) => m.get(date))
    const preliminary = gp?.preliminary || sp?.preliminary || ep?.preliminary
    return {
      date,
      groceries: gp?.value ?? null,
      shelter: sp?.value ?? null,
      energy: ep?.value ?? null,
      ...(preliminary ? { preliminary: true as const } : {}),
    }
  })
}

/**
 * Pure parser for a BLS CPI batch response (exported for tests).
 *
 * Each series uses its OWN baseline and latest valid month:
 *  - baseline = Jan 2025, or the latest published month in [Nov 2024, Jan 2025]
 *    for areas that skip January (bimonthly even-month schedule)
 *  - latest = most recent non-"-" month
 * Groceries without a usable baseline/latest → throws (source unavailable).
 * Shelter without a usable baseline/latest → shelter fields omitted.
 */
export function parseCpiResponse(
  seriesMap: Record<string, BlsRawPoint[]>,
  area: { areaCode: string; areaName: string; tier: 1 | 2 | 3 | 4 }
): CpiData {
  const ids = cpiSeriesIds(area.areaCode)
  const g = parseBlsMonthly(seriesMap[ids.groceries])
  const s = parseBlsMonthly(seriesMap[ids.shelter])
  const e = parseBlsMonthly(seriesMap[ids.energy])

  if (!g.length) {
    throw new Error(`No groceries CPI data returned for area ${area.areaCode}`)
  }

  const gBase = findBaseline(g)
  const gLatest = findLatest(g)
  const groceriesChange = gBase && gLatest ? pctChange(gLatest.value, gBase.value) : null
  if (!gBase || !gLatest || groceriesChange === null) {
    throw new Error(`No Jan 2025 groceries CPI baseline for area ${area.areaCode}`)
  }

  const sBase = findBaseline(s)
  const sLatest = findLatest(s)
  const shelterChange = sBase && sLatest ? pctChange(sLatest.value, sBase.value) : null

  // Rent of primary residence (SEHA): its own baseline and latest month, like every other item.
  const r = parseBlsMonthly(seriesMap[ids.rent])
  const rBase = findBaseline(r)
  const rLatest = findLatest(r)
  const rentIndexChange = rBase && rLatest ? pctChange(rLatest.value, rBase.value) : null

  let nationalSeries: CpiPoint[] | undefined
  if (area.areaCode !== NATIONAL_CPI_AREA) {
    const nat = cpiSeriesIds(NATIONAL_CPI_AREA)
    const ng = parseBlsMonthly(seriesMap[nat.groceries])
    if (ng.length) {
      nationalSeries = buildCpiPoints(ng, parseBlsMonthly(seriesMap[nat.shelter]), parseBlsMonthly(seriesMap[nat.energy]), [
        ...blsUnpublishedMonths(seriesMap[nat.groceries]),
        ...blsUnpublishedMonths(seriesMap[nat.shelter]),
        ...blsUnpublishedMonths(seriesMap[nat.energy]),
      ])
    }
  }

  return {
    groceriesCurrent: gLatest.value,
    groceriesBaseline: gBase.value,
    groceriesChange,
    groceriesBaselinePeriod: gBase.period,
    groceriesLatestPeriod: gLatest.period,
    ...(shelterChange !== null && sBase && sLatest
      ? {
          shelterChange,
          shelterCurrent: sLatest.value,
          shelterBaseline: sBase.value,
          shelterBaselinePeriod: sBase.period,
          shelterLatestPeriod: sLatest.period,
        }
      : {}),
    ...(rentIndexChange !== null && rBase && rLatest
      ? {
          rentIndexChange,
          rentIndexCurrent: rLatest.value,
          rentIndexBaseline: rBase.value,
          rentIndexBaselinePeriod: rBase.period,
          rentIndexLatestPeriod: rLatest.period,
        }
      : {}),
    series: buildCpiPoints(g, s, e, [
      ...blsUnpublishedMonths(seriesMap[ids.groceries]),
      ...blsUnpublishedMonths(seriesMap[ids.shelter]),
      ...blsUnpublishedMonths(seriesMap[ids.energy]),
    ]),
    metro: area.areaName,
    tier: area.tier,
    areaCode: area.areaCode,
    seriesIds: ids,
    ...(nationalSeries ? { nationalSeries } : {}),
  }
}

/**
 * Fetch CPI (groceries, shelter, energy, rent of primary residence + national overlay) for one BLS CPI
 * area in a single batched call (8 series).
 */
export async function fetchCpiArea(area: {
  areaCode: string
  areaName: string
  tier: 1 | 2 | 3 | 4
}): Promise<CpiData> {
  const ids = cpiSeriesIds(area.areaCode)
  const nat = cpiSeriesIds(NATIONAL_CPI_AREA)
  const allSeriesIds = [...new Set([
    ids.groceries, ids.shelter, ids.energy, ids.rent,
    nat.groceries, nat.shelter, nat.energy,
  ])]
  const seriesMap = await fetchBlsSeries(allSeriesIds, { label: 'BLS CPI' })
  return parseCpiResponse(seriesMap, area)
}

export async function fetchCpi(countyFips: string, stateAbbr: string): Promise<CpiData> {
  return fetchCpiArea(getMetroCpiAreaForCounty(countyFips, stateAbbr))
}
