/**
 * Round-12 fixes: gas displayed change from both sides as printed (L1), Zillow series that isn't current
 * (New Kent VA), county-out-of-range metro reason (L3), map uses the card's static-gas staleness rule (L6),
 * DCRA one-station source line, electricity baseline window constants.
 */
import { displayedChange, electricityCenterOf, ELECTRICITY_BASELINE_FROM, ELECTRICITY_BASELINE_TO, addMonths } from '@/lib/baseline'
import { notCurrentText } from '@/lib/rent-range'
import { lookupCountyRent, lookupMetroRent, countyNotCurrent } from '@/lib/rent'
import { rentMetroNote, buildHeroCards } from '@/lib/hero-cards'
import { buildMapMetrics, resetMapMetricsMemo } from '@/lib/api/map-metrics'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache } from '@/lib/cache/kv'

beforeEach(() => {
  clearMemCache()
  resetMapMetricsMemo()
})

describe('L1 displayedChange rounds each side as printed', () => {
  test('3.000 vs 2.905 prints $3.00 and $2.90 → +$0.10 (not +$0.09)', () => {
    expect((2.905).toFixed(2)).toBe('2.90')
    expect(displayedChange(3.0, 2.905)).toBe(0.1)
  })
  test('ordinary values and negatives', () => {
    expect(displayedChange(4.49, 3.12)).toBe(1.37)
    expect(displayedChange(3.1, 3.1)).toBe(0)
    expect(Object.is(displayedChange(3.004, 3.001), -0)).toBe(false)
    expect(displayedChange(2.9, 3.0)).toBe(-0.1)
  })
})

describe('electricity baseline window', () => {
  test('Aug 2024–Jul 2025 (midpoint ~Jan 30, 2025), plotted at its center month Jan 2025', () => {
    expect([ELECTRICITY_BASELINE_FROM, ELECTRICITY_BASELINE_TO]).toEqual(['2024-08', '2025-07'])
    expect(addMonths(ELECTRICITY_BASELINE_FROM, 11)).toBe(ELECTRICITY_BASELINE_TO)
    expect(electricityCenterOf(ELECTRICITY_BASELINE_TO)).toBe('2025-01')
    expect(electricityCenterOf('2026-07')).toBe('2026-01')
    // Midpoints: Jul–Jun window ≈ Jan 1 (19 days before Jan 20); Aug–Jul ≈ Jan 30 (10 days after)
    const mid = (from: string) => {
      const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5)) - 1, 1)
      const b = Date.UTC(Number(from.slice(0, 4)) + 1, Number(from.slice(5)) - 1, 1)
      return (a + b) / 2
    }
    const jan20 = Date.UTC(2025, 0, 20)
    expect(Math.abs(mid('2024-08') - jan20)).toBeLessThan(Math.abs(mid('2024-07') - jan20))
  })
})

describe('Zillow county series that is not current (New Kent County VA)', () => {
  test('wording', () => {
    expect(notCurrentText('New Kent County', { n: 1, last: '2026-07' }))
      .toBe("Zillow's series for New Kent County isn't current (one month, Jul 2026)")
    expect(notCurrentText('X County', { n: 14, last: '2026-03' }))
      .toBe("Zillow's series for X County isn't current (14 months, through Mar 2026)")
  })
  test('county lookup and the metro stand-in say why (card + map panel)', () => {
    expect(countyNotCurrent('51127')).toEqual({ n: 1, last: '2026-07' })
    const c = lookupCountyRent('51127')
    expect(c.data).toBeNull()
    if (!c.data) expect(c.why).toBe('not-current')
    const m = lookupMetroRent('51127', 'New Kent County')
    if (m.data) {
      expect(m.data.countyWhy).toBe('not-current')
      expect(rentMetroNote(m.data)).toMatch(/^Zillow's series for New Kent County isn't current \(one month, Jul 2026\); this is the /)
    }
  })
})

describe('L6 map uses the card staleness rule for DCRA / DACO', () => {
  test('current surveys are on the map; overdue ones fall to the next rung (as the card does)', async () => {
    const now = await buildMapMetrics(new Date('2026-10-04T12:00:00Z'))
    expect(now.gas.some((a) => a.source === 'dcra')).toBe(true)
    expect(now.gas.some((a) => a.source === 'daco')).toBe(true)
    const later = await buildMapMetrics(new Date('2030-01-01T00:00:00Z'))
    expect(later.gas.some((a) => a.source === 'dcra' || a.source === 'daco')).toBe(false)
    // Puerto Rico → EIA U.S. (the card's next rung after DACO); Alaska → the Anchorage stand-in
    const prIdx = later.counties['72001'][0]
    expect(later.gas[prIdx].id).toBe('e:NUS')
  })
})

describe('Alaska DCRA one-station source line', () => {
  test('Fairbanks (1 station surveyed) says so on the card face', async () => {
    const s = (await fetchSnapshot('99701'))!
    const gas = buildHeroCards(s).find((c) => c.id === 'gas')!
    expect(gas.sourceLine).toContain('DCRA, 1 station')
  })
})
