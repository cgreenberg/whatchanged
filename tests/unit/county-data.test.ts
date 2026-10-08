import {
  fmtPct, divergingColor, NO_DATA_COLOR, fmtMoney, moversFor, provenance, METRICS, metricFooter, fetchCounty, fetchUsHousing,
  clearCountyDataCache, seriesRows, seriesChangeSinceBaseline, addMonths, flagNote, FLAG_CAVEAT,
  type CountyMap, type CountyRecord, type LocalMeta, type CompactSeries,
} from '@/lib/county-data'
import fs from 'fs'
import path from 'path'

const META: LocalMeta = {
  baseline: '2025-01',
  sources: {
    zhvi: { latest: '2026-08', label: 'Zillow Home Value Index', url: '', short: 'Zillow ZHVI', adjustment: 'seasonally adjusted by Zillow' },
    zori: { latest: '2026-08', label: 'ZORI', url: '', short: 'Zillow ZORI', adjustment: 'seasonally adjusted by whatchanged' },
  },
}

describe('county-data helpers', () => {
  it('formats percentages without "-0.0%"', () => {
    // Same formatter as the cards: true minus sign, never "-0.0%"
    expect(fmtPct(-0.04)).toBe('0.0%')
    expect(fmtPct(3.25)).toBe('+3.3%')
    expect(fmtPct(-1.2)).toBe('−1.2%')
  })
  it('clamps colors and handles missing data', () => {
    expect(divergingColor(undefined, 10)).toBe(NO_DATA_COLOR)
    expect(divergingColor(100, 10)).toBe(divergingColor(10, 10))
    // no-data must not look like ~0%: clearly lighter than the near-black midpoint
    const lum = (c: string) => {
      const m = /^#(..)(..)(..)$/.exec(c)
      const [r, g, b] = m ? m.slice(1).map(h => parseInt(h, 16)) : c.match(/\d+/g)!.map(Number)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    expect(lum(NO_DATA_COLOR) - lum(divergingColor(0, 10))).toBeGreaterThan(50)
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
  it('offers price metrics only on the map', () => {
    expect(METRICS.map(m => m.key)).toEqual(['hv', 'rent'])
    for (const m of METRICS) expect(m.window(null).replace(/since Jan 2025/, '')).not.toMatch(/20\d\d/)
    expect(metricFooter(METRICS[0], META)).toBe('Zillow ZHVI · county · since Jan 2025 · Aug 2026 · seasonally adjusted by Zillow')
  })
  it('describes counties without dates', () => {
    const c: CountyRecord = { n: 'X County, ST', hv: 2, hvCur: 300000, rent: -1, rentCur: 1500 }
    for (const m of METRICS) expect(m.describe(c) ?? '').not.toMatch(/20\d\d|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/)
  })
  it('flags outliers with the documented note, else a generic caveat', () => {
    expect(flagNote({ n: 'a' }, 'rent')).toBeNull()
    expect(flagNote({ n: 'a', flags: ['rent'] }, 'rent')).toBe(FLAG_CAVEAT)
    expect(flagNote({ n: 'a', note: { rent: 'why' } }, 'rent')).toBe('Unusual value: why')
  })
})

describe('compact series', () => {
  const s: CompactSeries = { start: '2024-11', v: [100, null, 110, 120, 99] }
  it('steps months across year ends', () => {
    expect(addMonths('2024-11', 0)).toBe('2024-11')
    expect(addMonths('2024-11', 2)).toBe('2025-01')
    expect(addMonths('2016-01', 127)).toBe('2026-08')
  })
  it('turns a series into chart rows, skipping unpublished months', () => {
    expect(seriesRows(s, 'rent')).toEqual([
      { date: '2024-11', rent: 100 }, { date: '2025-01', rent: 110 }, { date: '2025-02', rent: 120 }, { date: '2025-03', rent: 99 },
    ])
    expect(seriesRows(undefined, 'rent')).toEqual([])
    expect(seriesRows({ start: 'bad', v: [1] }, 'rent')).toEqual([])
  })
  it('computes the change since the Jan 2025 baseline (latest month vs Jan 2025)', () => {
    expect(seriesChangeSinceBaseline(s)).toBe(-10)
    expect(seriesChangeSinceBaseline({ start: '2025-02', v: [1, 2] })).toBeNull() // no baseline month
    expect(seriesChangeSinceBaseline({ start: '2024-12', v: [1, 2] })).toBeNull() // nothing after baseline
  })
})

describe('movers', () => {
  const mk = (v: number, extra: Partial<CountyRecord> = {}): CountyRecord => ({ n: `C${v}`, hv: v, emp: 100000, ...extra })
  it('never overlaps top and bottom when few counties qualify', () => {
    const data: CountyMap = { a: mk(1), b: mk(2), c: mk(3) }
    const { top, bottom } = moversFor(data, 'hv')
    const ids = [...top, ...bottom].map(([f]) => f)
    expect(new Set(ids).size).toBe(ids.length)
    expect(top.length).toBe(1)
  })
  it('excludes flagged outliers, small counties and an approximated figure for the metric itself', () => {
    const data: CountyMap = {
      a: mk(50, { flags: ['hv'] }), b: mk(40, { approx: ['hv'] }), c: mk(30, { emp: 1000 }),
      d: mk(5), e: mk(4), f: mk(-3), g: mk(-4),
    }
    const { top, bottom } = moversFor(data, 'hv')
    const ids = [...top, ...bottom].map(([f]) => f)
    expect(ids).not.toContain('a'); expect(ids).not.toContain('b'); expect(ids).not.toContain('c')
    expect(top[0][0]).toBe('d'); expect(bottom[0][0]).toBe('g')
  })
  it('a county with an approximated jobs count (approx: emp, e.g. CT) is excluded from movers, however large its change', () => {
    const data: CountyMap = { h: mk(40, { approx: ['emp'] }), d: mk(5), e: mk(4), f: mk(-3), g: mk(-4) }
    const { top, bottom } = moversFor(data, 'hv')
    const ids = [...top, ...bottom].map(([f]) => f)
    expect(ids).not.toContain('h')
    expect(top[0][0]).toBe('d')
  })
})

describe('fetch error handling', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch; clearCountyDataCache() })
  const res = (ok: boolean, status: number, body: unknown = {}) =>
    ({ ok, status, json: () => Promise.resolve(body) }) as unknown as Response

  it('rejects on server errors and does not cache the failure', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(res(false, 500))
      .mockResolvedValueOnce(res(true, 200, { '48453': { n: 'Travis County, TX', hv: 1 } }))
    global.fetch = f as unknown as typeof fetch
    await expect(fetchCounty('48453')).rejects.toThrow(/500/)
    await expect(fetchCounty('48453')).resolves.toEqual({ n: 'Travis County, TX', hv: 1 })
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('treats a missing shard (404) as "no data", not an error', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(false, 404)) as unknown as typeof fetch
    await expect(fetchCounty('99999')).resolves.toBeNull()
    await expect(fetchCounty('abc')).resolves.toBeNull()
  })
  it('loads the U.S. housing series', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(true, 200, { hvS: { start: '2016-01', v: [1] } })) as unknown as typeof fetch
    await expect(fetchUsHousing()).resolves.toEqual({ hvS: { start: '2016-01', v: [1] } })
  })
})

describe('no hard-coded dates in user-facing county code', () => {
  const files = ['src/lib/county-data.ts', 'src/components/map/NationalMap.tsx', 'src/components/charts/HousingChart.tsx']
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
    }
    expect(bad).toEqual([])
  })
  it('resolves every zip in the zip-county crosswalk (Census 2020 housing-unit-weighted) to a county record', () => {
    const zc = readJson<Record<string, { countyFips: string }>>(path.join(process.cwd(), 'src/lib/data/zip-county.json'))
    // No source publishes these: Kalawao HI (15005) and the island territories (AS 60, GU 66, MP 69, VI 78).
    const noDataOk = (f: string) => f === '15005' || ['60', '66', '69', '78'].includes(f.slice(0, 2))
    const missing = [...new Set(Object.values(zc).map(v => v.countyFips))].filter(f => !counties[f] && !noDataOk(f))
    expect(missing).toEqual([])
  })
  it('county shards match the full county file, plus the monthly Zillow series', () => {
    for (const f of ['48453', '09001', '51590', '02063']) {
      const shard = readJson<CountyMap>(path.join(dir, 'county', `${f.slice(0, 2)}.json`))
      const { hvS, rentS, rentM, rentMS, ...rest } = shard[f]
      expect(rest).toEqual(counties[f])
      if (counties[f].hv != null) expect(hvS?.v.length).toBeGreaterThan(24)
      if (counties[f].rent != null) expect(rentS?.v.length).toBeGreaterThan(24)
      // Metro rent ships only for counties without a county series, with its own monthly series
      if (rentM) expect(counties[f].rent == null && (rentMS?.v.length ?? 0) > 24).toBe(true)
    }
    expect(Object.values(counties).some(c => c.hvS || c.rentS || c.rentM || c.rentMS)).toBe(false)
  })

  it('metro rent (Rent card + Rent tab) for counties without a county series: same % in the shard and metro-rent.json', () => {
    const mr = readJson<{ metros: Record<string, { pct: number; name: string }>; counties: Record<string, string> }>(
      path.join(process.cwd(), 'src/lib/data/metro-rent.json'))
    const cr = readJson<{ counties: Record<string, unknown> }>(path.join(process.cwd(), 'src/lib/data/county-rent.json'))
    // Sagadahoc ME has no Jan 2025 county series → Portland-South Portland metro (OMB 2020 CBSA 38860)
    expect(mr.counties['23023']).toBe('38860')
    expect(mr.metros['38860'].name).toBe('Portland-South Portland, ME')
    // Androscoggin ME: its short county series (since late 2022) is published with the state (U.S.) seasonal pattern
    expect(cr.counties['23001']).toMatchObject({ saPool: expect.any(String) })
    const me = readJson<CountyMap>(path.join(dir, 'county', '23.json'))
    expect(me['23023'].rentM).toMatchObject({ cbsa: '38860', rent: mr.metros['38860'].pct })
    for (const f of Object.keys(mr.counties)) expect(cr.counties[f]).toBeUndefined()
  })
  it('Rent graph series reproduce the Rent card % for every county (and Home prices the map %)', () => {
    const cr = readJson<{ counties: Record<string, { pct: number }> }>(path.join(process.cwd(), 'src/lib/data/county-rent.json'))
    const shards: CountyMap = {}
    for (const file of fs.readdirSync(path.join(dir, 'county'))) Object.assign(shards, readJson<CountyMap>(path.join(dir, 'county', file)))
    const badRent = Object.entries(cr.counties).filter(([f, v]) => seriesChangeSinceBaseline(shards[f]?.rentS) !== v.pct)
    expect(badRent).toEqual([])
    const badHv = Object.entries(shards).filter(([, c]) => c.hv != null && seriesChangeSinceBaseline(c.hvS) !== c.hv)
    expect(badHv).toEqual([])
    const us = readJson<{ hvS: CompactSeries; rentS: CompactSeries }>(path.join(dir, 'us-housing.json'))
    expect(seriesRows(us.hvS, 'v').length).toBeGreaterThan(100)
    expect(seriesRows(us.rentS, 'v').length).toBeGreaterThan(100)
  })
  it('every county the crosswalk resolves to carries a zip so a map tap can load the place', () => {
    const zc = readJson<Record<string, { countyFips: string }>>(path.join(process.cwd(), 'src/lib/data/zip-county.json'))
    // (A few small Virginia independent cities have no zip of their own in the housing-weighted crosswalk.)
    const inCrosswalk = new Set(Object.values(zc).map(v => v.countyFips))
    const bad = rows.filter(([f, c]) => inCrosswalk.has(f) && (!c.z || !zc[c.z])).map(([f]) => f)
    expect(bad).toEqual([])
  })
  it('meta labels never claim an agency adjusted data we adjusted', () => {
    const meta = readJson<LocalMeta>(path.join(dir, 'meta.json'))
    expect(meta.sources.zori.adjustment).toBe('seasonally adjusted by whatchanged')
    expect(meta.sources.zhvi.adjustment).toBe('seasonally adjusted by Zillow')
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
