// National headline numbers (used by the OG image). Reuses the main fetchers
// and their shared Redis keys (eia:gas:epmr:national, bls:cpi:0000:all, eia:electricity:US) — no
// duplicated fetch code and no hard-coded fallback numbers: on failure the
// metric is null and callers must show "Data unavailable".

import type { CpiData } from '@/types'
import { getCpiCached, getNationalGasCached, getNationalElectricityCached, NATIONAL_CPI, settle } from './cached-sources'
import { isGasStale } from './eia'
import { isBlsPeriodStale, isElectricityPeriodStale } from './snapshot'

// --- Types ---

export interface NationalDataPoint {
  date: string
  value: number
}

export interface NationalMetric {
  current: number
  baseline: number
  change: number // for gas: dollar change; for CPI: percent change
  baselinePeriod: string
  latestPeriod: string
  series: NationalDataPoint[]
  /** Last-good copy served (live fetch failed) or the latest period is too old — callers use a short cache. */
  stale: boolean
}

export interface NationalData {
  gas: NationalMetric | null
  groceries: NationalMetric | null
  shelter: NationalMetric | null
  /** EIA U.S. average residential electricity: 12-month average price ¢/kWh and its % change vs the 12 months ending Jan 2025. */
  electricity: { current: number; change: number; latestPeriod: string; stale: boolean } | null
}

/** CPI series expressed as % change from the series' own baseline. */
function cpiMetric(cpi: CpiData, item: 'groceries' | 'shelter', fetchStale = false): NationalMetric | null {
  const baseline = item === 'groceries' ? cpi.groceriesBaseline : cpi.shelterBaseline
  const current = item === 'groceries' ? cpi.groceriesCurrent : cpi.shelterCurrent
  const change = item === 'groceries' ? cpi.groceriesChange : cpi.shelterChange
  const baselinePeriod = item === 'groceries' ? cpi.groceriesBaselinePeriod : cpi.shelterBaselinePeriod
  const latestPeriod = item === 'groceries' ? cpi.groceriesLatestPeriod : cpi.shelterLatestPeriod
  if (
    baseline === undefined || current === undefined || change === undefined ||
    !baselinePeriod || !latestPeriod || !(baseline > 0)
  ) {
    return null
  }
  const series: NationalDataPoint[] = []
  for (const p of cpi.series) {
    const raw = item === 'groceries' ? p.groceries : p.shelter
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    series.push({ date: p.date, value: parseFloat((((raw - baseline) / baseline) * 100).toFixed(1)) })
  }
  return { current, baseline, change, baselinePeriod, latestPeriod, series, stale: fetchStale || isBlsPeriodStale(latestPeriod) }
}

export async function fetchNationalData(): Promise<NationalData> {
  const [gasResult, cpiResult, elecResult] = await Promise.all([
    settle(getNationalGasCached(), 'national-gas'),
    settle(getCpiCached(NATIONAL_CPI), 'national-cpi'),
    settle(getNationalElectricityCached(), 'national-electricity'),
  ])

  const gas: NationalMetric | null = gasResult
    ? {
        current: gasResult.data.current,
        baseline: gasResult.data.baseline,
        change: gasResult.data.change,
        baselinePeriod: gasResult.data.baselineDate,
        latestPeriod: gasResult.data.latestDate,
        series: gasResult.data.series.map((p) => ({ date: p.date, value: p.price })),
        stale: !!gasResult.stale || isGasStale(gasResult.data.latestDate ?? ''),
      }
    : null

  const e = elecResult?.data
  return {
    gas,
    groceries: cpiResult ? cpiMetric(cpiResult.data, 'groceries', !!cpiResult.stale) : null,
    shelter: cpiResult ? cpiMetric(cpiResult.data, 'shelter', !!cpiResult.stale) : null,
    electricity: e
      ? { current: e.current, change: e.change, latestPeriod: e.latestPeriod, stale: !!elecResult!.stale || isElectricityPeriodStale(e.latestPeriod) }
      : null,
  }
}

/** Kept for existing callers; caching now lives in Redis via the shared keys. */
export const getCachedNationalData = fetchNationalData
