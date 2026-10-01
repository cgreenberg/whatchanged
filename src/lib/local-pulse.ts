// Zip- and county-level "local pulse" data, built offline by scripts/build-local-data.py
// and served as static JSON from /public/data. No API keys, no runtime upstream calls.

export interface MonthlySeries {
  start: string // YYYY-MM of s[0]
  s: (number | null)[]
  base: number // Jan 2025 value
  cur: number
  pct: number // % change since Jan 2025
  rank: number // national percentile (0-100) of pct among all zips
  asOf: string
}

export interface ListingSnapshot {
  price: number
  priceYoY: number | null // fractional, 0.05 = +5%
  active: number
  activeYoY: number | null
  dom: number | null
  domYoY: number | null
  reduced: number | null // share of listings with a price cut
  volatile: boolean
}

export interface ZipPulse {
  hv?: MonthlySeries
  rent?: MonthlySeries
  listings?: ListingSnapshot
}

export interface CountyPulse {
  n: string
  z?: string
  hv?: number; hvCur?: number; hvR?: number
  rent?: number; rentCur?: number; rentR?: number
  ur?: number; urCur?: number; urR?: number
  wage?: number; wageCur?: number; wageR?: number
  jobs?: number; emp?: number
  cpi?: number; cpiArea?: string
  real?: number; realR?: number
  permits?: number; permitsCur?: number; permitsR?: number
}

export type CountyMap = Record<string, CountyPulse>

export interface PulseMeta {
  baseline: string
  paycheckWindow?: string
  sources: Record<string, { latest: string; label: string; url: string }>
}

let metaPromise: Promise<PulseMeta | null> | null = null
export function fetchPulseMeta(): Promise<PulseMeta | null> {
  if (!metaPromise) metaPromise = fetch('/data/meta.json').then(r => r.json()).catch(() => null)
  return metaPromise
}

const shardCache = new Map<string, Promise<Record<string, ZipPulse>>>()
let countiesPromise: Promise<CountyMap> | null = null

export function fetchZipPulse(zip: string): Promise<ZipPulse | null> {
  const key = zip.slice(0, 3)
  if (!shardCache.has(key)) {
    shardCache.set(
      key,
      fetch(`/data/zip/${key}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
    )
  }
  return shardCache.get(key)!.then(s => s[zip] ?? null)
}

export function fetchCounties(): Promise<CountyMap> {
  if (!countiesPromise) {
    countiesPromise = fetch('/data/counties.json').then(r => r.json()).catch(() => {
      countiesPromise = null
      return {}
    })
  }
  return countiesPromise
}

export function fmtPct(v: number, digits = 1): string {
  const r = Number(v.toFixed(digits))
  if (r === 0) return '0%'
  return `${r > 0 ? '+' : ''}${r.toFixed(digits)}%`
}

export function fmtMoney(v: number): string {
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e4) return `$${Math.round(v / 1e3)}K`
  return `$${Math.round(v).toLocaleString('en-US')}`
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** "higher than 82% of US zip codes" style phrase. rank is a 0-100 percentile. */
export function rankPhrase(rank: number, unit = 'US zip codes'): string {
  if (rank >= 50) return `A bigger increase than ${Math.min(rank, 99)}% of ${unit}`
  return `A smaller increase than ${Math.min(100 - rank, 99)}% of ${unit}`
}

// ---------- Map metrics ----------

export type MetricKey = 'hv' | 'rent' | 'real' | 'ur' | 'permits'

export interface MetricDef {
  key: MetricKey
  label: string
  short: string
  clamp: number // symmetric color domain
  unit: '%' | 'pts'
  describe: (c: CountyPulse) => string | null
  source: string
}

export const METRICS: MetricDef[] = [
  {
    key: 'hv', label: 'Home values', short: 'Home values', clamp: 10, unit: '%',
    describe: c => (c.hv == null ? null : `${fmtPct(c.hv)} since Jan 2025${c.hvCur ? ` · typical home ${fmtMoney(c.hvCur)}` : ''}`),
    source: 'Zillow Home Value Index',
  },
  {
    key: 'rent', label: 'Rent', short: 'Rent', clamp: 10, unit: '%',
    describe: c => (c.rent == null ? null : `${fmtPct(c.rent)} since Jan 2025${c.rentCur ? ` · typical rent ${fmtMoney(c.rentCur)}/mo` : ''}`),
    source: 'Zillow Observed Rent Index (seasonally adjusted)',
  },
  {
    key: 'real', label: 'Paychecks vs. prices', short: 'Paycheck vs prices', clamp: 6, unit: '%',
    describe: c =>
      c.real == null || c.wage == null || c.cpi == null
        ? null
        : `Wages ${fmtPct(c.wage)} vs prices ${fmtPct(c.cpi)} → ${c.real >= 0 ? 'ahead' : 'behind'} by ${Math.abs(c.real).toFixed(1)}%`,
    source: 'BLS QCEW avg weekly wage vs local CPI, last 4 quarters vs the 4 before',
  },
  {
    key: 'ur', label: 'Unemployment', short: 'Unemployment', clamp: 1.5, unit: 'pts',
    describe: c => (c.ur == null ? null : `${c.ur > 0 ? '+' : ''}${c.ur.toFixed(1)} pts since Jan 2025 · ${c.urCur?.toFixed(1)}% now`),
    source: 'BLS LAUS (seasonally adjusted)',
  },
  {
    key: 'permits', label: 'New home construction', short: 'New construction', clamp: 60, unit: '%',
    describe: c => (c.permits == null ? null : `${fmtPct(c.permits, 0)} permitted units vs. same months of 2025 (${c.permitsCur?.toLocaleString('en-US')} units)`),
    source: 'Census Building Permits Survey, Jan–Aug 2026 vs Jan–Aug 2025',
  },
]

// Neutral diverging scale (not good/bad coded): blue = fell, amber = rose.
const NEG = [59, 130, 246]
const MID = [39, 39, 42]
const POS = [245, 158, 11]
export function divergingColor(v: number | undefined, clamp: number): string {
  if (v == null || !Number.isFinite(v)) return '#18181b'
  const t = Math.max(-1, Math.min(1, v / clamp))
  const a = Math.pow(Math.abs(t), 0.7)
  const end = t < 0 ? NEG : POS
  const c = MID.map((m, i) => Math.round(m + (end[i] - m) * a))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
