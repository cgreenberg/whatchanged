/**
 * Round-14 fixes: seasonal-pattern caveat (a series' own recent seasonal swing differs from the blended pattern used
 * to adjust it by > 1.5 points; round 15: at the displayed month), ⓘ head names the state (or U.S.) pool and the metro level, coded-rent $ wording is
 * magnitude-style.
 */
import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import { rentSeasonalCaveat, seasonalCaveatDollars } from '@/lib/rent-range'
import zipCounty from '@/lib/data/zip-county.json'
import { lookupCountyRent } from '@/lib/rent'
import { rentSeasonalNote, buildHeroCards } from '@/lib/hero-cards'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache } from '@/lib/cache/kv'

beforeEach(() => clearMemCache())

type Row = { asOf: string; saCaveat?: { gap: number; month: number; low?: boolean } }
const counties = (countyRent as unknown as { counties: Record<string, Row> }).counties
const metros = (metroRent as unknown as { metros: Record<string, Row> }).metros
const metroCounties = (metroRent as unknown as { counties: Record<string, string> }).counties

describe('seasonal-pattern caveat (round 15: measured at the displayed month)', () => {
  test('wording: month of the reading, direction, gap to one decimal, $/mo bias', () => {
    // Manhattan-like: +12.6% on $4,818/mo, Aug reading 2.5 points high → $/mo at 12.6% minus at 10.1%
    const usd = Math.round(Math.abs((4818 - 4818 / 1.126) - (4818 - 4818 / 1.101)))
    expect(rentSeasonalCaveat({ gap: 2.5, month: 8 }, 'county', { pct: 12.6, curRent: 4818 })).toBe(
      `This August reading (+12.6%) may be about 2.5 percentage points too high (≈ $${usd}/mo): the county’s recent seasonal swing differs from the pattern used to adjust it. Under its own recent pattern it would be about +10.1%.`)
    expect(rentSeasonalCaveat({ gap: -2.2, month: 8 }, 'metro')).toBe(
      'This August reading may be about 2.2 percentage points too low: the metro’s recent seasonal swing differs from the pattern used to adjust it.')
    expect(rentSeasonalCaveat({ gap: 1.8, month: 3 })).toMatch(/^This March reading may be about 1\.8 percentage points too high:/)
    expect(rentSeasonalCaveat({ gap: -1.7, month: 8 })).toMatch(/may be about 1\.7 percentage points too low/)
    // At or under the 1.5-point threshold, malformed, or absent → no caveat
    expect(rentSeasonalCaveat({ gap: 1.5, month: 8 })).toBeUndefined()
    expect(rentSeasonalCaveat({ gap: Number.NaN, month: 8 })).toBeUndefined()
    expect(rentSeasonalCaveat({ gap: 3, month: 13 })).toBeUndefined()
    expect(rentSeasonalCaveat(undefined)).toBeUndefined()
  })

  test('$ bias follows the sign of the gap and the shown rent', () => {
    expect(seasonalCaveatDollars({ gap: 2, month: 8 }, 0, 2000)).toBe(Math.round(Math.abs(0 - (2000 - 2000 / 0.98))))
    expect(seasonalCaveatDollars({ gap: -2, month: 8 }, 5, 2000)).toBe(Math.round(Math.abs((2000 - 2000 / 1.05) - (2000 - 2000 / 1.07))))
    expect(seasonalCaveatDollars({ gap: 2, month: 8 }, 5, undefined)).toBeNull()
  })

  test('data: every caveat is at its row’s as-of month with |gap| > 1.5; the reviewed counties', () => {
    for (const r of [...Object.values(counties), ...Object.values(metros)]) {
      if (!r.saCaveat) continue
      expect(Math.abs(r.saCaveat.gap)).toBeGreaterThan(1.5)
      expect(r.saCaveat.month).toBe(Number(r.asOf.slice(5)))
      expect(Object.keys(r.saCaveat).sort()).toEqual(['gap', 'month'])
    }
    // Manhattan and Brooklyn: August readings overstate; Oswego / Skagit / Hawaii County: understate (the round-14
    // peak-month rule pointed Oswego the wrong way); Newport RI: no August gap
    for (const f of ['36061', '36047']) expect(counties[f].saCaveat!.gap).toBeGreaterThan(1.5)
    for (const f of ['36075', '53057', '15001']) expect(counties[f].saCaveat!.gap).toBeLessThan(-1.5)
    expect(counties['44005'].saCaveat).toBeUndefined()
    const r = lookupCountyRent('36061')
    expect(r.data?.saCaveat?.gap).toBe(counties['36061'].saCaveat!.gap)
  })

  test('card ⓘ and trace carry the caveat (Manhattan 10001)', async () => {
    const s = (await fetchSnapshot('10001'))!
    expect(s.rent).toMatchObject({ level: 'county', countyFips: '36061' })
    const card = buildHeroCards(s).find((c) => c.id === 'rent')!
    expect(card.info.join(' ')).toMatch(/This \w+ reading \([+−][\d.]+%\) may be about [\d.]+ percentage points too high \(≈ \$\d+\/mo\): the county’s/)
    const used = s.trace!.rent!.find((x) => x.status === 'used')!
    expect(used.rungId).toBe('rent.zillow-county')
    expect(used.reason).toMatch(/^This \w+ reading \([+−][\d.]+%\) may be about [\d.]+ percentage points too high/)
  })

  test('metro level: card ⓘ and trace name the metro and keep the stand-in reason', async () => {
    const cb = Object.keys(metros).find((k) => metros[k].saCaveat)!
    const fips = Object.entries(metroCounties).find(([, c]) => c === cb)?.[0]
    expect(fips).toBeDefined()
    const zip = Object.entries(zipCounty as Record<string, { countyFips: string }>).find(([, z]) => z.countyFips === fips)![0]
    const s = (await fetchSnapshot(zip))!
    expect(s.rent?.level).toBe('metro')
    const card = buildHeroCards(s).find((c) => c.id === 'rent')!
    expect(card.info.join(' ')).toMatch(/reading \([+−][\d.]+%\) may be about [\d.]+ percentage points too (high|low).*: the metro’s recent seasonal swing/)
    const used = s.trace!.rent!.find((x) => x.status === 'used')!
    expect(used.rungId).toBe('rent.zillow-metro')
    expect(used.reason).toMatch(/the metro’s recent seasonal swing differs/)
  })
})

describe('ⓘ head names the pool level', () => {
  test('county and metro heads say "state (or U.S.) pattern"', () => {
    expect(rentSeasonalNote('Maine counties', 0)).toMatch(/^Seasonally adjusted by whatchanged \(county pattern blended with the state \(or U\.S\.\) pattern based on history length\): /)
    expect(rentSeasonalNote('Texas counties', 0.5, 'metro')).toBe(
      'Seasonally adjusted by whatchanged (metro pattern blended with the state (or U.S.) pattern based on history length): 50% the metro’s own pattern, 50% the typical pattern of Texas counties.')
  })
})
