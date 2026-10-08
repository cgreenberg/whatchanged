/**
 * Round-12 fixes: gas displayed change from both sides as printed (L1), Zillow series that isn't current
 * (New Kent VA), county-out-of-range metro reason (L3), map and card share the static-gas staleness rule (L6),
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
      .toBe("Zillow's series for New Kent County is too new to use (only one month, Jul 2026)")
    // Legacy data (no first month): counting back gives only the latest possible start (gaps make it earlier), so
    // no start month is named and "too new" isn't claimed
    expect(notCurrentText('X County', { n: 3, last: '2026-07' }))
      .toBe("Zillow's series for X County isn't usable (only three months of data, through Jul 2026)")
    expect(notCurrentText('X County', { n: 14, last: '2026-03' }))
      .toBe("Zillow's series for X County isn't usable (only 14 months of data, through Mar 2026)")
    // A series that started before Jan 2025 and stopped isn't "too new": it isn't current
    expect(notCurrentText('X County', { n: 40, first: '2022-12', last: '2026-03' }))
      .toBe("Zillow's series for X County isn't current (through Mar 2026)")
    expect(notCurrentText('X County', { n: 30, last: '2026-03' }))
      .toBe("Zillow's series for X County isn't current (through Mar 2026)")
    // Gaps: n counts the months with a value; the first month is the real first one, not counted back
    expect(notCurrentText('X County', { n: 4, first: '2025-11', last: '2026-07' }))
      .toBe("Zillow's series for X County is too new to use (only four months, from Nov 2025)")
    expect(notCurrentText('X County', { n: 1, first: '2026-07', last: '2026-07' }))
      .toBe("Zillow's series for X County is too new to use (only one month, Jul 2026)")
  })
  test('county lookup and the metro stand-in say why (card + map panel)', () => {
    expect(countyNotCurrent('51127')).toEqual({ n: 1, first: '2026-07', last: '2026-07' })
    const c = lookupCountyRent('51127')
    expect(c.data).toBeNull()
    if (!c.data) expect(c.why).toBe('not-current')
    const m = lookupMetroRent('51127', 'New Kent County')
    if (m.data) {
      expect(m.data.countyWhy).toBe('not-current')
      expect(rentMetroNote(m.data)).toMatch(/^Zillow's series for New Kent County is too new to use \(only one month, Jul 2026\); this is the /)
    }
  })
})

describe('L6 map and card agree on static gas (DCRA / DACO), current or overdue', () => {
  // Both sides from one rule (staticGasStatus): an overdue survey / month stays the value shown, marked stale.
  async function bothSides(zip: string, now: Date) {
    clearMemCache()
    resetMapMetricsMemo()
    jest.useFakeTimers({ now, doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] })
    try {
      const s = (await fetchSnapshot(zip))!
      const card = buildHeroCards(s).find((c) => c.id === 'gas')!
      const m = await buildMapMetrics(now)
      const area = m.gas[m.counties[s.location.countyFips][0]]
      return { s, card, area }
    } finally {
      jest.useRealTimers()
    }
  }

  test.each([
    ['00901', 'daco'],
    ['99701', 'dcra'],
  ] as const)('%s: same %s series and same stale flag on the card and the map', async (zip, kind) => {
    for (const [when, stale] of [[new Date('2026-10-04T12:00:00Z'), false], [new Date('2030-01-01T00:00:00Z'), true]] as const) {
      const { s, card, area } = await bothSides(zip, when)
      const g = s.gas.data!
      expect(g.staticSource?.kind).toBe(kind)
      expect(area.source).toBe(kind)
      expect(!!s.gas.stale).toBe(stale)
      expect(!!card.stale).toBe(stale)
      expect(!!area.stale).toBe(stale)
      expect(area.asOf).toBe(g.latestDate)
      if (kind === 'daco') {
        expect(area.current).toBe(g.current)
        expect(area.change).toBeCloseTo(g.change, 3)
      }
    }
  })
})

describe('Alaska DCRA one-station source line', () => {
  test('Fairbanks (1 station surveyed) says so on the card face', async () => {
    const s = (await fetchSnapshot('99701'))!
    const gas = buildHeroCards(s).find((c) => c.id === 'gas')!
    expect(gas.sourceLine).toContain('DCRA, 1 station')
  })
})
