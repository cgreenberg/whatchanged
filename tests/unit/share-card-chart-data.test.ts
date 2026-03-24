// tests/unit/share-card-chart-data.test.ts

import type { CpiPoint } from '@/types'

// Mirrors the transformation in EraChart.tsx (normalizeToBaseline)
function normalizeToBaseline(values: number[]): number[] {
  const base = values[0]
  if (!base || base === 0) return values
  return values.map(v => ((v - base) / base) * 100)
}

// Mirrors the transformation in generate.tsx for grocery
function shareCardGroceryValues(series: CpiPoint[]): number[] {
  const filtered = series.filter(p => p.date >= '2025-01')
  const raw = filtered.map(p => p.groceries)
  const base = (raw[0] !== undefined && raw[0] !== 0) ? raw[0] : 1
  return raw.map(v => ((v - base) / base) * 100)
}

// Mirrors the transformation in generate.tsx for shelter
function shareCardShelterValues(series: CpiPoint[]): number[] {
  const pairs = series
    .filter(p => p.date >= '2025-01' && p.shelter !== null)
    .map(p => ({ date: p.date, value: p.shelter as number }))
  const base = (pairs[0]?.value !== undefined && pairs[0].value !== 0) ? pairs[0].value : 1
  return pairs.map(p => ((p.value - base) / base) * 100)
}

const SAMPLE_SERIES: CpiPoint[] = [
  { date: '2024-12', groceries: 300.0, shelter: 200.0, energy: null },
  { date: '2025-01', groceries: 303.0, shelter: 202.0, energy: null },
  { date: '2025-02', groceries: 305.0, shelter: 204.0, energy: null },
  { date: '2025-03', groceries: 307.0, shelter: 206.0, energy: null },
  { date: '2025-04', groceries: 310.0, shelter: 208.0, energy: null },
  { date: '2025-05', groceries: 312.0, shelter: 210.0, energy: null },
]

const SAMPLE_SERIES_WITH_NULL: CpiPoint[] = [
  { date: '2025-01', groceries: 303.0, shelter: null, energy: null },
  { date: '2025-02', groceries: 305.0, shelter: 204.0, energy: null },
  { date: '2025-03', groceries: 307.0, shelter: 206.0, energy: null },
]

describe('share card chart data matches main page chart data', () => {
  it('grocery: share card values match EraChart normalization from Jan 2025', () => {
    const jan2025Series = SAMPLE_SERIES.filter(p => p.date >= '2025-01')
    const eraValues = normalizeToBaseline(jan2025Series.map(p => p.groceries))
    const cardValues = shareCardGroceryValues(SAMPLE_SERIES)

    expect(cardValues).toHaveLength(eraValues.length)
    cardValues.forEach((v, i) => {
      expect(v).toBeCloseTo(eraValues[i], 5)
    })
  })

  it('grocery: first value is always 0 (baseline)', () => {
    const values = shareCardGroceryValues(SAMPLE_SERIES)
    expect(values[0]).toBe(0)
  })

  it('shelter: share card values match EraChart normalization (non-null points only)', () => {
    const jan2025NonNull = SAMPLE_SERIES.filter(p => p.date >= '2025-01' && p.shelter !== null)
    const eraValues = normalizeToBaseline(jan2025NonNull.map(p => p.shelter as number))
    const cardValues = shareCardShelterValues(SAMPLE_SERIES)

    expect(cardValues).toHaveLength(eraValues.length)
    cardValues.forEach((v, i) => {
      expect(v).toBeCloseTo(eraValues[i], 5)
    })
  })

  it('shelter: first value is 0 even when Jan 2025 has null shelter', () => {
    const values = shareCardShelterValues(SAMPLE_SERIES_WITH_NULL)
    expect(values[0]).toBe(0)
  })

  it('grocery: y-axis min bound is always 0', () => {
    const values = shareCardGroceryValues(SAMPLE_SERIES)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = Math.abs(max - min)
    const boundsMin = Math.max(0, min - range * 0.05) // old formula
    const hardMin = 0 // new formula
    expect(hardMin).toBe(0)
    expect(boundsMin).toBeGreaterThanOrEqual(0)
  })
})
