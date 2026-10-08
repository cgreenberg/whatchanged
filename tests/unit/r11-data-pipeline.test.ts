// Round-11 data pipeline invariants (scripts/build-local-data.py, scripts/build-zip-county.ts outputs).
import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import zipCounty from '@/lib/data/zip-county.json'
import akGas from '@/lib/data/ak-gas.json'

type Row = { pct: number; baseRent: number; curRent: number }
const CR = countyRent as unknown as {
  meta: { pctRange: [number, number] }
  counties: Record<string, Row>
  tooNew: string[]
  noBaseline: string[]
  outOfRange: string[]
}
const MR = metroRent as unknown as {
  meta: { pctRange: [number, number] }
  metros: Record<string, Row>
  counties: Record<string, string>
  outOfRange: string[]
  outOfRangeCounties: Record<string, string>
}
const ZC = zipCounty as unknown as Record<string, { countyFips: string; cityName: string }>

describe('rent sanity range is emitted once and respected', () => {
  it('county and metro files carry the same pctRange (−20…+50)', () => {
    expect(CR.meta.pctRange).toEqual([-20, 50])
    expect(MR.meta.pctRange).toEqual(CR.meta.pctRange)
  })
  it('every published county/metro % lies inside it', () => {
    const [lo, hi] = CR.meta.pctRange
    for (const r of [...Object.values(CR.counties), ...Object.values(MR.metros)]) {
      expect(r.pct).toBeGreaterThanOrEqual(lo)
      expect(r.pct).toBeLessThanOrEqual(hi)
    }
  })
  it('each county is classified at most once (published / tooNew / noBaseline / outOfRange)', () => {
    const lists = [Object.keys(CR.counties), CR.tooNew, CR.noBaseline, CR.outOfRange]
    const seen = new Map<string, number>()
    for (const l of lists) for (const f of l) seen.set(f, (seen.get(f) ?? 0) + 1)
    expect([...seen].filter(([, n]) => n > 1)).toEqual([])
  })
  it('no out-of-range county is replaced by its metro; no out-of-range metro is used', () => {
    expect(CR.outOfRange.filter(f => f in MR.counties)).toEqual([])
    expect(MR.outOfRange.filter(cb => cb in MR.metros)).toEqual([])
    for (const cb of Object.values(MR.outOfRangeCounties)) expect(MR.outOfRange).toContain(cb)
  })
})

describe('mail-only zips use their city’s county', () => {
  it.each([
    ['99519', '02020'], // Anchorage (was North Slope Borough: Prudhoe Bay worksite ZCTA)
    ['99695', '02020'], // Anchorage (was Lake and Peninsula Borough)
    ['28271', '37119'], // Charlotte NC (was Robeson County)
    ['33112', '12086'], // Miami FL (was Putnam County)
    ['92331', '06071'], // Fontana CA (was Imperial County)
  ])('%s → %s', (zip, fips) => {
    expect(ZC[zip].countyFips).toBe(fips)
  })
  it.each([
    ['19088', '42045'], // Wayne PA: genuine border case, post office in Delaware County — unchanged
    ['22038', '51600'], // Fairfax city VA — unchanged
  ])('border case %s stays in %s', (zip, fips) => {
    expect(ZC[zip].countyFips).toBe(fips)
  })
})

describe('Alaska DCRA survey: one reporting retailer per community', () => {
  const C = (akGas as unknown as { communities: Record<string, { stations?: number; retailer?: string }> }).communities
  it('Fairbanks is one station (University Chevron)', () => {
    expect(C.Fairbanks.stations).toBe(1)
    expect(C.Fairbanks.retailer).toBe('University Chevron')
  })
  it('every community row carries a station count', () => {
    for (const v of Object.values(C)) expect(v.stations).toBe(1)
  })
})
