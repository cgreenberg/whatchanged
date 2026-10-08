/**
 * Round 18: "direction uncertain" only on a sign flip (the rent card / share image then show no signed $), caveat
 * points and own-pattern % at the same precision, "0.0%" never "−0.0%", "SINCE JAN 20, 2025" header with no data.
 */
import type { EconomicSnapshot } from '@/types'
import austin from '../fixtures/snapshots/78701.json'
import countyRent from '@/lib/data/county-rent.json'
import metroRent from '@/lib/data/metro-rent.json'
import {
  hasSeasonalCaveat, rentSeasonalCaveat, seasonalCaveatPoints, seasonalDirectionUncertain, seasonalOwnPatternPct,
  type SeasonalCaveat,
} from '@/lib/rent-range'
import { buildHeroCards, DIRECTION_UNCERTAIN_TAG, OUTLIER_TAG } from '@/lib/hero-cards'
import { RANGE_NONE } from '@/lib/share-card/labels'

type Row = { pct: number; curRent: number; saCaveat?: SeasonalCaveat }
const ROWS: Row[] = [
  ...Object.values((countyRent as unknown as { counties: Record<string, Row> }).counties),
  ...Object.values((metroRent as unknown as { metros: Record<string, Row> }).metros),
]
const snap = (): EconomicSnapshot => JSON.parse(JSON.stringify(austin))
const rentCard = (s: EconomicSnapshot) => buildHeroCards(s).find((c) => c.id === 'rent')!

describe('caveat points and own-pattern % add up', () => {
  test('every bundled caveat: shown − signed points = own pattern, all at one decimal', () => {
    const shown = ROWS.filter((r) => hasSeasonalCaveat(r.saCaveat))
    expect(shown.length).toBeGreaterThan(50)
    for (const r of shown) {
      const pts = seasonalCaveatPoints(r.saCaveat!)
      expect(pts).toBe(Math.round(pts * 10) / 10)
      const own = seasonalOwnPatternPct(r.saCaveat!, r.pct)!
      expect(own).toBeCloseTo(r.pct - pts * Math.sign(r.saCaveat!.gap), 6)
    }
  })

  test('direction uncertain ⇔ own pattern has the other sign or rounds to 0', () => {
    for (const r of ROWS.filter((x) => hasSeasonalCaveat(x.saCaveat))) {
      const own = seasonalOwnPatternPct(r.saCaveat!, r.pct)!
      expect(seasonalDirectionUncertain(r.saCaveat!, r.pct)).toBe(own === 0 || Math.sign(own) !== Math.sign(r.pct))
    }
  })
})

test('a shown % that rounds to zero reads "0.0%", never "−0.0%"', () => {
  const text = rentSeasonalCaveat({ gap: -2, month: 8 }, 'county', { pct: -0.04, curRent: 1500 })!
  expect(text).toContain('This August reading (0.0%)')
  expect(text).not.toContain('−0.0%')
  expect(text).toContain('it would be about +2.0%')
  expect(rentSeasonalCaveat({ gap: 2, month: 8 }, 'county', { pct: 2.04, curRent: 1500 })).toContain('it would be about 0.0%;')
})

describe('rent card: no signed $ when the direction is uncertain', () => {
  test('Collier-like (−1.5%, gap −2.2 → own +0.7%): no inline $, "direction uncertain" tag, no $ in the ⓘ', () => {
    const s = snap()
    s.rent = { ...s.rent!, pct: -1.5, monthlyChange: -39, saCaveat: { gap: -2.2, month: 8 } }
    const c = rentCard(s)
    expect(c.status).toBe('ok')
    expect(c.value).toBe('−1.5%')
    expect(c.inline).toBeUndefined()
    expect(c.tags).toEqual([DIRECTION_UNCERTAIN_TAG])
    expect(c.info.join(' ')).not.toMatch(/≈ [+−-]\$\d+\/mo vs/)
    expect(c.info[0]).toMatch(/^No \$\/mo figure: .*even the direction of this change is unclear/)
    expect(c.info.join(' ')).toContain('so even its direction is uncertain')
  })

  test('Blue Earth-like (+6.3%, gap −8.4 → own +14.7%): the $ stays', () => {
    const s = snap()
    s.rent = { ...s.rent!, pct: 6.3, monthlyChange: 64, saCaveat: { gap: -8.4, month: 8 } }
    const c = rentCard(s)
    expect(c.inline).toBe('≈ +$64/mo')
    expect(c.tags).toBeUndefined()
  })

  test('outlier + direction uncertain: both tags', () => {
    const s = snap()
    s.rent = { ...s.rent!, pct: -1.5, monthlyChange: -39, flagged: true, saCaveat: { gap: -2.2, month: 8 } }
    expect(rentCard(s).tags).toEqual([OUTLIER_TAG, DIRECTION_UNCERTAIN_TAG])
  })
})

test('header with no dated card: "SINCE JAN 20, 2025", no arrow, no "LATEST"', () => {
  expect(RANGE_NONE).toBe('SINCE JAN 20, 2025')
})
