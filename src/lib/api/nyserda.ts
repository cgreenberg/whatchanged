// NYSERDA "Average Home Heating Oil Prices by Region: Beginning 1997" (data.ny.gov rc94-5y2u, Open NY):
// New York statewide + 8 regional averages, $/gal, surveyed weekly September–March and twice a month
// April–August (year-round, unlike EIA SHOPP). Keyless Socrata API; one request returns every column since
// 2016, cached as one key (nyserda:heating-oil) and warmed by the refresh job.

import { NYSERDA_REGIONS, NYSERDA_STATEWIDE_COLUMN } from '@/lib/mappings/nyserda-regions'
import { buildWeeklyHeatingSeries, HEATING_SERIES_START, type HeatingPoint, type HeatingSeriesData } from './eia-heating'

export const NYSERDA_API = 'https://data.ny.gov/resource/rc94-5y2u.json'
export const NYSERDA_DATASET_URL = 'https://data.ny.gov/Energy-Environment/Average-Home-Heating-Oil-Prices-by-Region-Beginning/rc94-5y2u'
export const NYSERDA_PAGE = 'https://www.nyserda.ny.gov/Researchers-and-Policymakers/Energy-Prices/Home-Heating-Oil/Average-Home-Heating-Oil-Prices'
export const NYSERDA_CACHE_KEY = 'nyserda:heating-oil'
export const NYSERDA_TIMEOUT_MS = 10_000
/** Biweekly off-season: a latest reading older than this means a missed update. */
export const NYSERDA_STALE_DAYS = 24

/** Every column's weekly points since HEATING_SERIES_START (the cached value). */
export interface NyserdaHeatingOil {
  columns: Record<string, HeatingPoint[]>
}

export const NYSERDA_COLUMNS = [NYSERDA_STATEWIDE_COLUMN, ...NYSERDA_REGIONS.map((r) => r.column)]

/** Pure: Socrata rows → per-column points. */
export function parseNyserdaRows(rows: ReadonlyArray<Record<string, unknown>>): NyserdaHeatingOil {
  const columns: Record<string, HeatingPoint[]> = {}
  for (const c of NYSERDA_COLUMNS) columns[c] = []
  for (const r of rows) {
    const date = typeof r.date === 'string' ? r.date.slice(0, 10) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < HEATING_SERIES_START) continue
    for (const c of NYSERDA_COLUMNS) {
      const v = Number(r[c])
      if (r[c] !== undefined && r[c] !== null && r[c] !== '' && Number.isFinite(v) && v > 0) columns[c].push({ date, price: v })
    }
  }
  for (const c of NYSERDA_COLUMNS) columns[c].sort((a, b) => a.date.localeCompare(b.date))
  if (!columns[NYSERDA_STATEWIDE_COLUMN].length) throw new Error('No NYSERDA heating oil data')
  return { columns }
}

export function nyserdaSeries(d: NyserdaHeatingOil, column: string): HeatingSeriesData {
  return buildWeeklyHeatingSeries(d.columns[column] ?? [], 'oil', column, `NYSERDA ${column}`)
}

export function isValidNyserda(d: NyserdaHeatingOil | null | undefined): boolean {
  if (!d?.columns) return false
  return NYSERDA_COLUMNS.every((c) => Array.isArray(d.columns[c]) && d.columns[c].length > 50 &&
    d.columns[c].every((p) => p.price >= 0.5 && p.price <= 15))
}

export async function fetchNyserdaHeatingOil(opts: { timeoutMs?: number } = {}): Promise<NyserdaHeatingOil> {
  const params = new URLSearchParams({
    $where: `date >= '${HEATING_SERIES_START}T00:00:00'`,
    $order: 'date',
    $limit: '5000',
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? NYSERDA_TIMEOUT_MS)
  try {
    const res = await fetch(`${NYSERDA_API}?${params.toString()}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`NYSERDA API error: ${res.status} ${res.statusText}`)
    const rows = await res.json()
    if (!Array.isArray(rows) || !rows.length) throw new Error('No NYSERDA heating oil rows')
    return parseNyserdaRows(rows)
  } finally {
    clearTimeout(timer)
  }
}
