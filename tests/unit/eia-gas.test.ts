import { getGasLookup } from '@/lib/api/eia'

describe('getGasLookup — Tier 1: county FIPS override', () => {
  test('Cuyahoga County (Cleveland) maps to YCLE at tier 1', () => {
    const result = getGasLookup('OH', 'S23B', '39035')
    expect(result.duoarea).toBe('YCLE')
    expect(result.tier).toBe(1)
    expect(result.geoLevel).toBe('Cleveland area avg')
    expect(result.cacheKey).toBe('eia:gas:city:YCLE')
  })

  test('Lorain County (Cleveland suburb) also maps to YCLE', () => {
    const result = getGasLookup('OH', 'S23B', '39093')
    expect(result.duoarea).toBe('YCLE')
    expect(result.tier).toBe(1)
  })

  test('county FIPS override takes priority over CPI area mapping', () => {
    const result = getGasLookup('OH', 'S23B', '39035')
    expect(result.tier).toBe(1)
    expect(result.duoarea).toBe('YCLE')
  })
})

describe('getGasLookup — Tier 1: CPI area → EIA city', () => {
  test('Seattle CPI area (S49D) maps to Y48SE', () => {
    const result = getGasLookup('WA', 'S49D')
    expect(result.duoarea).toBe('Y48SE')
    expect(result.tier).toBe(1)
    expect(result.geoLevel).toBe('Seattle area avg')
    expect(result.cacheKey).toBe('eia:gas:city:Y48SE')
  })

  test('Los Angeles CPI area (S49A) maps to Y05LA', () => {
    const result = getGasLookup('CA', 'S49A')
    expect(result.duoarea).toBe('Y05LA')
    expect(result.tier).toBe(1)
  })

  test('San Francisco CPI area (S49B) maps to Y05SF', () => {
    const result = getGasLookup('CA', 'S49B')
    expect(result.duoarea).toBe('Y05SF')
    expect(result.tier).toBe(1)
  })

  test('New York CPI area (S12A) maps to Y35NY', () => {
    const result = getGasLookup('NY', 'S12A')
    expect(result.duoarea).toBe('Y35NY')
    expect(result.tier).toBe(1)
  })

  test('Boston CPI area (S11A) maps to YBOS', () => {
    const result = getGasLookup('MA', 'S11A')
    expect(result.duoarea).toBe('YBOS')
    expect(result.tier).toBe(1)
  })

  test('Chicago CPI area (S23A) maps to YORD', () => {
    const result = getGasLookup('IL', 'S23A')
    expect(result.duoarea).toBe('YORD')
    expect(result.tier).toBe(1)
  })

  test('Houston CPI area (S37B) maps to Y44HO', () => {
    const result = getGasLookup('TX', 'S37B')
    expect(result.duoarea).toBe('Y44HO')
    expect(result.tier).toBe(1)
  })

  test('Miami CPI area (S35B) maps to YMIA', () => {
    const result = getGasLookup('FL', 'S35B')
    expect(result.duoarea).toBe('YMIA')
    expect(result.tier).toBe(1)
  })

  test('Denver CPI area (S48B) maps to YDEN', () => {
    const result = getGasLookup('CO', 'S48B')
    expect(result.duoarea).toBe('YDEN')
    expect(result.tier).toBe(1)
  })
})

describe('getGasLookup — Tier 2: state-level fallback', () => {
  test('WA with unknown CPI area falls back to state tier 2', () => {
    const result = getGasLookup('WA', 'S49G')
    expect(result.duoarea).toBe('SWA')
    expect(result.tier).toBe(2)
    expect(result.geoLevel).toBe('Washington state avg')
    expect(result.cacheKey).toBe('eia:gas:state:WA')
  })

  test('CA with no CPI area falls back to state tier 2', () => {
    const result = getGasLookup('CA')
    expect(result.duoarea).toBe('SCA')
    expect(result.tier).toBe(2)
  })

  test('TX with no CPI area falls back to state tier 2', () => {
    const result = getGasLookup('TX')
    expect(result.duoarea).toBe('STX')
    expect(result.tier).toBe(2)
  })

  test('OH with non-city CPI area falls back to state tier 2', () => {
    const result = getGasLookup('OH')
    expect(result.duoarea).toBe('SOH')
    expect(result.tier).toBe(2)
  })

  test('state abbreviation is case-insensitive', () => {
    const lower = getGasLookup('wa')
    const upper = getGasLookup('WA')
    expect(lower.duoarea).toBe(upper.duoarea)
    expect(lower.tier).toBe(upper.tier)
  })
})

describe('getGasLookup — Tier 3: PAD district fallback', () => {
  test('NC (PAD 1C — Lower Atlantic) maps to R1Z', () => {
    const result = getGasLookup('NC')
    expect(result.duoarea).toBe('R1Z')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('Lower Atlantic (PADD 1C) avg')
    expect(result.cacheKey).toBe('eia:gas:pad:1C')
  })

  test('KS (PAD 2 — Midwest) maps to R20', () => {
    const result = getGasLookup('KS')
    expect(result.duoarea).toBe('R20')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('Midwest (PADD 2) avg')
  })

  test('LA (PAD 3 — Gulf Coast) maps to R30', () => {
    const result = getGasLookup('LA')
    expect(result.duoarea).toBe('R30')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('Gulf Coast (PADD 3) avg')
  })

  test('MT (PAD 4 — Rocky Mountain) maps to R40', () => {
    const result = getGasLookup('MT')
    expect(result.duoarea).toBe('R40')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('Rocky Mountain (PADD 4) avg')
  })

  test('OR (PAD 5 — West Coast) maps to R50', () => {
    const result = getGasLookup('OR')
    expect(result.duoarea).toBe('R50')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('West Coast (PADD 5) avg')
  })
})

describe('getGasLookup — national fallback', () => {
  test('unknown state returns national fallback', () => {
    const result = getGasLookup('XX')
    expect(result.duoarea).toBe('NUS')
    expect(result.geoLevel).toBe('National avg')
    expect(result.tier).toBe(3)
    expect(result.cacheKey).toBe('eia:gas:national')
  })

  test('empty state string returns national fallback', () => {
    const result = getGasLookup('')
    expect(result.duoarea).toBe('NUS')
    expect(result.tier).toBe(3)
  })
})

describe('EIA gas data supports 10Y range', () => {
  test('buildSeriesFromData handles data spanning 10+ years', () => {
    const wideData = [
      { period: '2016-06-20', value: '2.645', 'area-name': 'Washington', duoarea: 'SWA' },
      { period: '2019-06-17', value: '3.125', 'area-name': 'Washington', duoarea: 'SWA' },
      { period: '2025-01-13', value: '3.241', 'area-name': 'Washington', duoarea: 'SWA' },
      { period: '2025-02-24', value: '3.348', 'area-name': 'Washington', duoarea: 'SWA' },
    ]
    const sorted = [...wideData].sort((a, b) => a.period.localeCompare(b.period))
    const series = sorted
      .filter(d => d.value !== null && d.value !== '--' && !isNaN(parseFloat(d.value)))
      .map(d => ({ date: d.period, price: parseFloat(d.value) }))

    expect(series.length).toBe(4)
    expect(series[0].date).toBe('2016-06-20')
    expect(series[series.length - 1].date).toBe('2025-02-24')

    const firstYear = parseInt(series[0].date.slice(0, 4))
    const lastYear = parseInt(series[series.length - 1].date.slice(0, 4))
    expect(lastYear - firstYear).toBeGreaterThanOrEqual(9)
  })

  test('baseline is still anchored to Jan 20 2025 with 10Y data', () => {
    const BASELINE_DATE = '2025-01-20'
    const data = [
      { period: '2016-06-20', value: '2.645', 'area-name': 'WA', duoarea: 'SWA' },
      { period: '2025-01-13', value: '3.241', 'area-name': 'WA', duoarea: 'SWA' },
      { period: '2025-01-20', value: '3.300', 'area-name': 'WA', duoarea: 'SWA' },
      { period: '2025-02-24', value: '3.348', 'area-name': 'WA', duoarea: 'SWA' },
    ]
    const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period))
    const series = sorted
      .filter(d => d.value !== null && !isNaN(parseFloat(d.value)))
      .map(d => ({ date: d.period, price: parseFloat(d.value) }))

    const baselineTime = new Date(BASELINE_DATE).getTime()
    const onOrBefore = series.filter(d => new Date(d.date).getTime() <= baselineTime)
    const baseline = onOrBefore[onOrBefore.length - 1].price

    expect(baseline).toBe(3.300)
    expect(baseline).not.toBe(2.645)
  })
})
