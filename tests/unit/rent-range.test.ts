/** One rent sanity range for the build (meta.pctRange in both bundles) and the runtime/trace text. */
import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import { RENT_PCT_RANGE, rentRangeText } from '@/lib/rent-range'
import { lookupCountyRent, lookupMetroRent } from '@/lib/rent'

test('build and runtime use the same range', () => {
  expect((countyRent as { meta: { pctRange: number[] } }).meta.pctRange).toEqual([...RENT_PCT_RANGE])
  expect((metroRent as { meta: { pctRange: number[] } }).meta.pctRange).toEqual([...RENT_PCT_RANGE])
  expect(rentRangeText()).toBe('−20% to +50%')
})

test('every bundled county/metro row is inside the range (the build drops the rest into outOfRange)', () => {
  const [lo, hi] = RENT_PCT_RANGE
  for (const r of Object.values((countyRent as unknown as { counties: Record<string, { pct: number }> }).counties)) {
    expect(r.pct >= lo && r.pct <= hi).toBe(true)
  }
  for (const r of Object.values((metroRent as unknown as { metros: Record<string, { pct: number }> }).metros)) {
    expect(r.pct >= lo && r.pct <= hi).toBe(true)
  }
})

test('a flagged metro never stands in for a county (CPI shelter instead); counties without a county series otherwise get their metro', () => {
  const m = metroRent as unknown as { metros: Record<string, { flagged?: boolean }>; counties: Record<string, string> }
  const flaggedCounty = Object.entries(m.counties).find(([, cbsa]) => m.metros[cbsa]?.flagged)
  const okCounty = Object.entries(m.counties).find(([, cbsa]) => m.metros[cbsa] && !m.metros[cbsa].flagged)
  expect(okCounty).toBeDefined()
  expect(lookupMetroRent(okCounty![0]).data?.level).toBe('metro')
  if (flaggedCounty) expect(lookupMetroRent(flaggedCounty[0])).toEqual({ data: null, why: 'flagged' })
  // A county's own flagged series is still used (shown with ⚠)
  const c = countyRent as unknown as { counties: Record<string, { flagged?: boolean }> }
  const ownFlagged = Object.entries(c.counties).find(([, r]) => r.flagged)
  if (ownFlagged) expect(lookupCountyRent(ownFlagged[0]).data?.flagged).toBe(true)
})
