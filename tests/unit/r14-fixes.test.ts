/**
 * Round-14 fixes: seasonal-pattern caveat (a series' own recent seasonal swing differs from the blended pattern used
 * to adjust it by > 1.5 points), ⓘ head names the state (or U.S.) pool and the metro level, coded-rent $ wording is
 * magnitude-style.
 */
import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import { rentSeasonalCaveat } from '@/lib/rent-range'
import { lookupCountyRent } from '@/lib/rent'
import { rentSeasonalNote, buildHeroCards } from '@/lib/hero-cards'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache } from '@/lib/cache/kv'

beforeEach(() => clearMemCache())

type Row = { saCaveat?: { gap: number; month: number; low?: boolean } }
const counties = (countyRent as unknown as { counties: Record<string, Row> }).counties
const metros = (metroRent as unknown as { metros: Record<string, Row> }).metros

describe('seasonal-pattern caveat', () => {
  test('wording: direction-aware, rounded gap, peak or low month, county or metro', () => {
    expect(rentSeasonalCaveat({ gap: 2.5, month: 8 })).toBe(
      'This county’s seasonal pattern is uncertain; readings near its seasonal peak (August) may overstate the change by up to ~3 points.')
    expect(rentSeasonalCaveat({ gap: -2.2, month: 6, low: true }, 'metro')).toBe(
      'This metro’s seasonal pattern is uncertain; readings near its seasonal low (June) may understate the change by up to ~2 points.')
    // At or under the 1.5-point threshold, malformed, or absent → no caveat
    expect(rentSeasonalCaveat({ gap: 1.5, month: 8 })).toBeUndefined()
    expect(rentSeasonalCaveat({ gap: Number.NaN, month: 8 })).toBeUndefined()
    expect(rentSeasonalCaveat({ gap: 3, month: 13 })).toBeUndefined()
    expect(rentSeasonalCaveat(undefined)).toBeUndefined()
  })

  test('data: every flagged row is above the threshold with a valid month; Manhattan and Brooklyn are flagged (overstate)', () => {
    for (const r of [...Object.values(counties), ...Object.values(metros)]) {
      if (!r.saCaveat) continue
      expect(Math.abs(r.saCaveat.gap)).toBeGreaterThan(1.5)
      expect(Number.isInteger(r.saCaveat.month) && r.saCaveat.month >= 2 && r.saCaveat.month <= 12).toBe(true)
    }
    for (const fips of ['36061', '36047']) {
      expect(counties[fips].saCaveat).toMatchObject({ gap: expect.any(Number) })
      expect(counties[fips].saCaveat!.gap).toBeGreaterThan(1.5)
      const r = lookupCountyRent(fips)
      expect(r.data?.saCaveat?.gap).toBe(counties[fips].saCaveat!.gap)
    }
  })

  test('card ⓘ and trace carry the caveat (Manhattan 10001)', async () => {
    const s = (await fetchSnapshot('10001'))!
    expect(s.rent).toMatchObject({ level: 'county', countyFips: '36061' })
    const card = buildHeroCards(s).find((c) => c.id === 'rent')!
    expect(card.info.join(' ')).toMatch(/This county’s seasonal pattern is uncertain; readings near its seasonal peak \(\w+\) may overstate the change by up to ~\d points\./)
    const used = s.trace!.rent!.find((x) => x.status === 'used')!
    expect(used.rungId).toBe('rent.zillow-county')
    expect(used.reason).toMatch(/^This county’s seasonal pattern is uncertain/)
  })
})

describe('ⓘ head names the pool level', () => {
  test('county and metro heads say "state (or U.S.) pattern"', () => {
    expect(rentSeasonalNote('Maine counties', 0)).toMatch(/^Seasonally adjusted by whatchanged \(county pattern blended with the state \(or U\.S\.\) pattern based on history length\): /)
    expect(rentSeasonalNote('Texas counties', 0.5, 'metro')).toBe(
      'Seasonally adjusted by whatchanged (metro pattern blended with the state (or U.S.) pattern based on history length): 50% the metro’s own pattern, 50% the typical pattern of Texas counties.')
  })
})
