// Monthly Zillow rent series for the share card's Rent chart: the same seasonally adjusted series as the Rent card
// and the Housing graph's Rent tab (public/data/county/{state}.json, built by scripts/build-local-data.py) — the
// county's own series, or its metro's (`rentMS`) / city's (`rentCS`) when the card uses that rung. Read server-side
// from disk; no upstream calls. The chart is drawn only when its first and last points are the card's baseline and as-of months
// and its end agrees with the card's % change, so the chart can never disagree with the big number.
import fs from 'fs'
import path from 'path'
import type { RentData } from '@/types'
import type { CompactSeries, CountyMap } from '@/lib/county-data'

const shards = new Map<string, CountyMap | null>()

function readShard(state: string): CountyMap | null {
  if (!shards.has(state)) {
    try {
      const file = path.join(process.cwd(), 'public', 'data', 'county', `${state}.json`)
      shards.set(state, JSON.parse(fs.readFileSync(file, 'utf8')) as CountyMap)
    } catch {
      shards.set(state, null)
    }
  }
  return shards.get(state) ?? null
}

const monthIndex = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return y * 12 + (m - 1)
}

/** Points of a compact monthly series from `from` to `to` (inclusive), skipping unpublished months. */
export function expandSeries(s: CompactSeries | undefined, from: string, to: string): Array<{ date: string; value: number }> {
  if (!s || !/^\d{4}-\d{2}$/.test(s.start) || !Array.isArray(s.v)) return []
  const start = monthIndex(s.start)
  const out: Array<{ date: string; value: number }> = []
  for (let k = monthIndex(from); k <= monthIndex(to); k++) {
    const v = s.v[k - start]
    if (k < start || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
    out.push({ date: `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`, value: v })
  }
  return out
}

/** Tolerance (points) between the chart's end and the card's rounded % change. */
const PCT_TOLERANCE = 0.15

/**
 * The Rent card's series from its baseline month to its as-of month, or null when the shard is missing or doesn't
 * match the card (different months, or an end % that disagrees with `rent.pct`).
 */
export function rentChartSeries(rent: RentData | null | undefined): Array<{ date: string; value: number }> | null {
  if (!rent || !/^\d{5}$/.test(rent.countyFips ?? '')) return null
  const rec = readShard(rent.countyFips.slice(0, 2))?.[rent.countyFips]
  if (!rec) return null
  // The card's rung: county `rentS`, metro `rentMS`, or the city rung's `rentCS`
  const key = ({ metro: 'rentMS', city: 'rentCS' } as Record<string, string>)[rent.level ?? 'county'] ?? 'rentS'
  const series = expandSeries((rec as unknown as Record<string, CompactSeries | undefined>)[key], rent.baseMonth, rent.asOf)
  if (series.length < 2 || series[0].date !== rent.baseMonth || series[series.length - 1].date !== rent.asOf) return null
  const endPct = (series[series.length - 1].value / series[0].value - 1) * 100
  return Math.abs(endPct - rent.pct) <= PCT_TOLERANCE ? series : null
}
