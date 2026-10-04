import {
  fmtPct, divergingColor, fmtMoney, moversFor, provenance, METRICS, metricFooter, fetchZipPulse, fetchCounty,
  fetchCity, clearPulseCache, approxNote,
  type CountyMap, type CountyPulse, type PulseMeta,
} from '@/lib/local-pulse'
import fs from 'fs'
import path from 'path'

const META: PulseMeta = {
  baseline: '2025-01',
  paycheckWindow: '12-month averages, Q2 2025–Q1 2026 vs a year earlier',
  sources: {
    zhvi: { latest: '2026-08', label: 'Zillow Home Value Index', url: '', short: 'Zillow ZHVI', adjustment: 'seasonally adjusted by Zillow' },
    zori: { latest: '2026-08', label: 'ZORI', url: '', short: 'Zillow ZORI', adjustment: 'seasonally adjusted by whatchanged' },
    qcew: { latest: '2026-Q1', label: 'QCEW', url: '', short: 'BLS QCEW + CPI', window: '12-month averages, Q2 2025–Q1 2026 vs a year earlier' },
    laus: { latest: '2026-07', label: 'LAUS', url: '', short: 'BLS LAUS', adjustment: 'seasonally adjusted by whatchanged', window: '3-month average, May 2026–Jul 2026 vs Dec 2024–Feb 2025' },
    permits: { latest: '2026-08', label: 'BPS', url: '', short: 'Census BPS', window: 'Jan–Aug 2026 vs Jan–Aug 2025' },
  },
}

describe('local-pulse helpers', () => {
  it('formats percentages without "-0.0%"', () => {
    expect(fmtPct(-0.04)).toBe('0%')
    expect(fmtPct(3.25)).toBe('+3.3%')
    expect(fmtPct(-1.2)).toBe('-1.2%')
  })
  it('clamps colors and handles missing data', () => {
    expect(divergingColor(undefined, 10)).toBe('#18181b')
    expect(divergingColor(100, 10)).toBe(divergingColor(10, 10))
  })
  it('formats money, including the $1M boundary', () => {
    expect(fmtMoney(2_967_210)).toBe('$2.97M')
    expect(fmtMoney(412_000)).toBe('$412K')
    expect(fmtMoney(999_600)).toBe('$1.00M')
    expect(fmtMoney(999_400)).toBe('$999K')
  })
  it('builds provenance footers as Source · geography · window · as-of · adjustment', () => {
    expect(provenance(META, 'zori', 'Travis County', 'since Jan 2025')).toBe(
      'Zillow ZORI · Travis County · since Jan 2025 · Aug 2026 · seasonally adjusted by whatchanged',
    )
    expect(provenance(null, 'zori', 'Travis County')).toBe('Travis County')
  })
  it('takes every metric window from meta, not from code', () => {
    for (const m of METRICS) {
      const footer = metricFooter(m, META)
      const years = footer.match(/20\d\d/g) ?? []
      const metaText = JSON.stringify(META)
      for (const y of years) expect(metaText).toContain(y)
      // Without meta, only the site baseline constant may appear
      expect(m.window(null).replace(/since Jan 2025/, '')).not.toMatch(/20\d\d/)
    }
    expect(metricFooter(METRICS.find(m => m.key === 'permits')!, META)).toContain('Jan–Aug 2026 vs Jan–Aug 2025')
    expect(metricFooter(METRICS.find(m => m.key === 'ur')!, META)).toContain('3-month average')
  })
  it('describes counties without dates', () => {
    const c: CountyPulse = { n: 'X County, ST', hv: 2, hvCur: 300000, rent: -1, rentCur: 1500, ur: 0.4, urBase: 4, urCur: 4.4, wage: 3, cpi: 2.5, real: 0.5, permits: 10, permitsCur: 100 }
    for (const m of METRICS) expect(m.describe(c) ?? '').not.toMatch(/20\d\d|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/)
  })
  it('shows an approximation note only for approximated counties', () => {
    expect(approxNote({ n: 'A, CT' })).toBeNull()
    expect(approxNote({ n: 'Fairfield County, CT', approx: ['ur'], approxFrom: 'Greater Bridgeport Planning Region' }))
      .toMatch(/Greater Bridgeport/)
  })
})

describe('movers', () => {
  const mk = (v: number, extra: Partial<CountyPulse> = {}): CountyPulse => ({ n: `C${v}`, hv: v, emp: 100000, ...extra })
  it('never overlaps top and bottom when few counties qualify', () => {
    const data: CountyMap = { a: mk(1), b: mk(2), c: mk(3) }
    const { top, bottom } = moversFor(data, 'hv')
    const ids = [...top, ...bottom].map(([f]) => f)
    expect(new Set(ids).size).toBe(ids.length)
    expect(top.length).toBe(1)
  })
  it('excludes approximated counties, flagged outliers and small counties', () => {
    const data: CountyMap = {
      a: mk(50, { flags: ['hv'] }), b: mk(40, { approx: ['ur'] }), c: mk(30, { emp: 1000 }),
      d: mk(5), e: mk(4), f: mk(-3), g: mk(-4),
    }
    const { top, bottom } = moversFor(data, 'hv')
    const ids = [...top, ...bottom].map(([f]) => f)
    expect(ids).not.toContain('a'); expect(ids).not.toContain('b'); expect(ids).not.toContain('c')
    expect(top[0][0]).toBe('d'); expect(bottom[0][0]).toBe('g')
  })
})

describe('fetch error handling', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch; clearPulseCache() })
  const res = (ok: boolean, status: number, body: unknown = {}) =>
    ({ ok, status, json: () => Promise.resolve(body) }) as unknown as Response

  it('rejects on server errors and does not cache the failure', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(res(false, 500))
      .mockResolvedValueOnce(res(true, 200, { '98683': { hv: { pct: 1 } } }))
    global.fetch = f as unknown as typeof fetch
    await expect(fetchZipPulse('98683')).rejects.toThrow(/500/)
    await expect(fetchZipPulse('98683')).resolves.toEqual({ hv: { pct: 1 } })
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('treats a missing shard (404) as "no data", not an error', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(false, 404)) as unknown as typeof fetch
    await expect(fetchZipPulse('00000')).resolves.toBeNull()
    await expect(fetchCounty('99999')).resolves.toBeNull()
  })
  it('matches a Zillow city only within the same county, and only if unambiguous', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(true, 200, {
      '1': { n: 'Springfield', county: 'Greene County', hv: { pct: 1, cur: 1, asOf: '' } },
      '2': { n: 'Springfield', county: 'Clark County', hv: { pct: 2, cur: 2, asOf: '' } },
    })) as unknown as typeof fetch
    await expect(fetchCity('OH', 'Springfield', 'Clark County')).resolves.toMatchObject({ hv: { pct: 2 } })
    await expect(fetchCity('OH', 'Springfield', 'Miami County')).resolves.toBeNull()
  })
})

describe('no hard-coded dates in user-facing pulse code', () => {
  const files = ['src/lib/local-pulse.ts', 'src/components/pulse/LocalPulse.tsx', 'src/components/pulse/NationalMap.tsx']
  it.each(files)('%s has no year or month literals outside comments and the baseline constant', file => {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    const offenders = src.split('\n')
      .map((line, i) => [i + 1, line.replace(/\/\/.*$/, '')] as const)
      .filter(([, l]) => !/^\s*\*|^\s*\/\*/.test(l))
      .filter(([, l]) => !/export const BASELINE_MONTH = '\d{4}-\d{2}'/.test(l))
      .filter(([, l]) => /20\d\d|['"`>][^'"`<]*\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(l))
    expect(offenders).toEqual([])
  })
})

// ---------- Shipped data ----------

type Json = Record<string, unknown>
const dir = path.join(process.cwd(), 'public/data')
const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T

describe('built local data sanity', () => {
  const counties = readJson<CountyMap>(path.join(dir, 'counties.json'))
  const rows = Object.entries(counties)

  it('covers most US counties', () => {
    expect(rows.filter(([, c]) => c.hv != null).length).toBeGreaterThan(2800)
  })
  it('never uses a FIPS code (or nothing) as a county name', () => {
    const bad = rows.filter(([f, c]) => !c.n || c.n === f || /^\d{5}$/.test(c.n)).map(([f]) => f)
    expect(bad).toEqual([])
  })
  it('ships no CT planning-region rows and no percentile ranks', () => {
    expect(rows.filter(([f]) => /^091[1-9]0$/.test(f)).map(([f]) => f)).toEqual([])
    const rankKeys = rows.flatMap(([f, c]) => Object.keys(c).filter(k => /^[a-z]+R$/.test(k)).map(k => `${f}.${k}`))
    expect(rankKeys).toEqual([])
  })
  it('keeps county metrics within sanity ranges', () => {
    const ranges: Record<string, [number, number]> = {
      hv: [-50, 50], rent: [-50, 80], rentYoY: [-50, 80], ur: [-15, 15], urCur: [0, 25], urBase: [0, 25],
      wage: [-25, 25], real: [-25, 25], cpi: [-20, 50],
    }
    const bad: string[] = []
    for (const [f, c] of rows) {
      for (const [k, [lo, hi]] of Object.entries(ranges)) {
        const v = (c as unknown as Json)[k]
        if (v != null && !(typeof v === 'number' && v >= lo && v <= hi)) bad.push(`${f}.${k}=${v}`)
      }
      if (c.ur != null && c.urBase != null && c.urCur != null) {
        if (Math.abs(c.urCur - c.urBase - c.ur) > 0.11) bad.push(`${f}.ur inconsistent`)
      }
    }
    expect(bad).toEqual([])
  })
  it('only publishes paychecks for counties that pass the job floor (or approximated CT/AK counties)', () => {
    // emp is last-quarter jobs; the floor uses the 4-quarter average, so allow slack.
    const bad = rows.filter(([, c]) => c.wage != null && !c.approx?.length && (c.emp ?? 0) < 4000).map(([f]) => f)
    expect(bad).toEqual([])
  })
  it('resolves every zip in the zip-county crosswalk (Census 2020 housing-unit-weighted) to a county record', () => {
    const zc = readJson<Record<string, { countyFips: string }>>(path.join(process.cwd(), 'src/lib/data/zip-county.json'))
    // No source publishes these: Kalawao HI (15005) and the island territories (AS 60, GU 66, MP 69, VI 78).
    const noDataOk = (f: string) => f === '15005' || ['60', '66', '69', '78'].includes(f.slice(0, 2))
    const missing = [...new Set(Object.values(zc).map(v => v.countyFips))].filter(f => !counties[f] && !noDataOk(f))
    expect(missing).toEqual([])
  })
  it('county shards match the full county file', () => {
    for (const f of ['48453', '09001', '51590', '02063']) {
      const shard = readJson<CountyMap>(path.join(dir, 'county', `${f.slice(0, 2)}.json`))
      expect(shard[f]).toEqual(counties[f])
    }
  })
  it('zip shards: leading-zero zips, honest rent basis, listings in range, no ranks', () => {
    const bad: string[] = []
    let n = 0
    for (const file of fs.readdirSync(path.join(dir, 'zip'))) {
      const shard = readJson<Record<string, Json>>(path.join(dir, 'zip', file))
      for (const [z, v] of Object.entries(shard)) {
        n++
        if (!z.startsWith(file.slice(0, 3))) bad.push(`${z} in ${file}`)
        const rent = v.rent as Json | undefined
        if (rent && !['sa', 'yoy'].includes(rent.basis as string)) bad.push(`${z} rent basis`)
        if (rent && rent.basis === 'yoy' && rent.s) bad.push(`${z} yoy rent has SA series`)
        if ((v.hv as Json | undefined)?.rank != null || rent?.rank != null) bad.push(`${z} rank`)
        const li = v.listings as Json | undefined
        if (li) {
          if ((li.active as number) < 20) bad.push(`${z} active`)
          for (const k of ['priceYoY', 'activeYoY', 'domYoY']) {
            const y = li[k] as number | null
            if (y != null && Math.abs(y) > 1) bad.push(`${z} ${k}`)
          }
          const r = li.reduced as number | null
          if (r != null && (r < 0 || r > 1)) bad.push(`${z} reduced`)
        }
      }
    }
    expect(n).toBeGreaterThan(20000)
    expect(bad).toEqual([])
  })
  it('meta labels never claim an agency adjusted data we adjusted', () => {
    const meta = readJson<PulseMeta>(path.join(dir, 'meta.json'))
    for (const k of ['zori', 'laus']) expect(meta.sources[k].adjustment).toBe('seasonally adjusted by whatchanged')
    for (const k of ['laus', 'permits', 'qcew']) expect(meta.sources[k].window).toBeTruthy()
  })
  it('county-rent.json (server import) is in range and consistent with counties.json', () => {
    const cr = readJson<{ meta: Json; counties: Record<string, { pct: number; baseRent: number; curRent: number; name: string }> }>(
      path.join(process.cwd(), 'src/lib/data/county-rent.json'))
    expect(cr.meta.adjustment).toBe('seasonally adjusted by whatchanged')
    const bad = Object.entries(cr.counties).filter(([f, v]) =>
      !(v.pct >= -30 && v.pct <= 60) || v.curRent <= 0 || v.baseRent <= 0 || counties[f]?.rent !== v.pct || !v.name)
    expect(bad).toEqual([])
    expect(Object.keys(cr.counties).length).toBeGreaterThan(400)
  })
})
