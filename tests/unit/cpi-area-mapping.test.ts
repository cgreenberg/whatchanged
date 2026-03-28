import {
  getMetroCpiAreaForCounty,
  BLS_CPI_AREAS,
  STATE_TO_REGION,
} from '@/lib/mappings/county-metro-cpi'

describe('BLS_CPI_AREAS', () => {
  test('contains all 23 metro areas', () => {
    const metroCodes = ['S11A','S12A','S12B','S23A','S23B','S24A','S24B',
      'S35A','S35B','S35C','S35D','S35E','S37A','S37B',
      'S48A','S48B','S49A','S49B','S49C','S49D','S49E','S49F','S49G']
    for (const code of metroCodes) {
      expect(BLS_CPI_AREAS[code]).toBeDefined()
    }
  })

  test('contains 4 regional areas', () => {
    expect(BLS_CPI_AREAS['0100']).toEqual({ code: '0100', name: 'Northeast Urban' })
    expect(BLS_CPI_AREAS['0200']).toEqual({ code: '0200', name: 'Midwest Urban' })
    expect(BLS_CPI_AREAS['0300']).toEqual({ code: '0300', name: 'South Urban' })
    expect(BLS_CPI_AREAS['0400']).toEqual({ code: '0400', name: 'West Urban' })
  })
})

describe('STATE_TO_REGION', () => {
  test('all 50 states + DC are mapped', () => {
    expect(Object.keys(STATE_TO_REGION).length).toBe(51)
  })

  test('regional assignments are correct', () => {
    expect(STATE_TO_REGION['NY']).toBe('0100') // Northeast
    expect(STATE_TO_REGION['IL']).toBe('0200') // Midwest
    expect(STATE_TO_REGION['TX']).toBe('0300') // South
    expect(STATE_TO_REGION['CA']).toBe('0400') // West
  })
})

describe('getMetroCpiAreaForCounty — Tier 1: CBSA metro lookup', () => {
  test('Manhattan → New York CPI (S12A)', () => {
    const result = getMetroCpiAreaForCounty('36061', 'NY')
    expect(result.areaCode).toBe('S12A')
    expect(result.areaName).toBe('New York-Newark-Jersey City')
    expect(result.tier).toBe(1)
  })

  test('Cook County IL → Chicago CPI (S23A)', () => {
    const result = getMetroCpiAreaForCounty('17031', 'IL')
    expect(result.areaCode).toBe('S23A')
    expect(result.tier).toBe(1)
  })

  test('LA County → Los Angeles CPI (S49A)', () => {
    const result = getMetroCpiAreaForCounty('06037', 'CA')
    expect(result.areaCode).toBe('S49A')
    expect(result.tier).toBe(1)
  })

  test('King County WA → Seattle CPI (S49D)', () => {
    const result = getMetroCpiAreaForCounty('53033', 'WA')
    expect(result.areaCode).toBe('S49D')
    expect(result.tier).toBe(1)
  })

  test('Harris County TX → Houston CPI (S37B)', () => {
    const result = getMetroCpiAreaForCounty('48201', 'TX')
    expect(result.areaCode).toBe('S37B')
    expect(result.tier).toBe(1)
  })

  test('Middlesex County MA → Boston CPI (S11A)', () => {
    const result = getMetroCpiAreaForCounty('25017', 'MA')
    expect(result.areaCode).toBe('S11A')
    expect(result.tier).toBe(1)
  })
})

describe('getMetroCpiAreaForCounty — Tier 2: regional fallback', () => {
  test('rural Mississippi county → South regional (0300)', () => {
    // Amite County, MS — not in any CPI metro CBSA
    const result = getMetroCpiAreaForCounty('28005', 'MS')
    expect(result.areaCode).toBe('0300')
    expect(result.areaName).toBe('South Urban')
    expect(result.tier).toBe(2)
  })

  test('Erie County NY (Buffalo) → Northeast regional (0100)', () => {
    // Buffalo not in primary Boston CBSA → falls to regional
    const result = getMetroCpiAreaForCounty('36029', 'NY')
    expect(result.areaCode).toBe('0100')
    expect(result.tier).toBe(2)
  })

  test('Sacramento County CA → West regional (0400)', () => {
    // Sacramento not in primary SF CBSA → falls to regional
    const result = getMetroCpiAreaForCounty('06067', 'CA')
    expect(result.areaCode).toBe('0400')
    expect(result.tier).toBe(2)
  })

  test('state abbreviation is case-insensitive', () => {
    const upper = getMetroCpiAreaForCounty('28005', 'MS')
    const lower = getMetroCpiAreaForCounty('28005', 'ms')
    expect(lower.areaCode).toBe(upper.areaCode)
    expect(lower.tier).toBe(upper.tier)
  })
})

describe('getMetroCpiAreaForCounty — Tier 3: national fallback', () => {
  test('Puerto Rico → National (0000)', () => {
    const result = getMetroCpiAreaForCounty('72001', 'PR')
    expect(result.areaCode).toBe('0000')
    expect(result.areaName).toBe('National')
    expect(result.tier).toBe(3)
  })

  test('unknown state → National (0000)', () => {
    const result = getMetroCpiAreaForCounty('99999', 'XX')
    expect(result.areaCode).toBe('0000')
    expect(result.tier).toBe(3)
  })

  test('empty state → National (0000)', () => {
    const result = getMetroCpiAreaForCounty('99999', '')
    expect(result.areaCode).toBe('0000')
    expect(result.tier).toBe(3)
  })
})
