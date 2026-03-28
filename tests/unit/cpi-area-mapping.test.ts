import {
  getMetroCpiAreaForCounty,
  BLS_CPI_AREAS,
  STATE_TO_REGION,
  STATE_TO_DIVISION,
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

  test('contains 9 division areas', () => {
    expect(BLS_CPI_AREAS['0110']).toEqual({ code: '0110', name: 'New England' })
    expect(BLS_CPI_AREAS['0120']).toEqual({ code: '0120', name: 'Middle Atlantic' })
    expect(BLS_CPI_AREAS['0230']).toEqual({ code: '0230', name: 'East North Central' })
    expect(BLS_CPI_AREAS['0240']).toEqual({ code: '0240', name: 'West North Central' })
    expect(BLS_CPI_AREAS['0350']).toEqual({ code: '0350', name: 'South Atlantic' })
    expect(BLS_CPI_AREAS['0360']).toEqual({ code: '0360', name: 'East South Central' })
    expect(BLS_CPI_AREAS['0370']).toEqual({ code: '0370', name: 'West South Central' })
    expect(BLS_CPI_AREAS['0480']).toEqual({ code: '0480', name: 'Mountain' })
    expect(BLS_CPI_AREAS['0490']).toEqual({ code: '0490', name: 'Pacific' })
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

describe('STATE_TO_DIVISION', () => {
  test('all 51 entries (50 states + DC)', () => {
    expect(Object.keys(STATE_TO_DIVISION).length).toBe(51)
  })

  test('division assignments are correct', () => {
    expect(STATE_TO_DIVISION['MA']).toEqual({ code: '0110', name: 'New England' })
    expect(STATE_TO_DIVISION['NY']).toEqual({ code: '0120', name: 'Middle Atlantic' })
    expect(STATE_TO_DIVISION['OH']).toEqual({ code: '0230', name: 'East North Central' })
    expect(STATE_TO_DIVISION['MN']).toEqual({ code: '0240', name: 'West North Central' })
    expect(STATE_TO_DIVISION['FL']).toEqual({ code: '0350', name: 'South Atlantic' })
    expect(STATE_TO_DIVISION['TN']).toEqual({ code: '0360', name: 'East South Central' })
    expect(STATE_TO_DIVISION['TX']).toEqual({ code: '0370', name: 'West South Central' })
    expect(STATE_TO_DIVISION['UT']).toEqual({ code: '0480', name: 'Mountain' })
    expect(STATE_TO_DIVISION['WA']).toEqual({ code: '0490', name: 'Pacific' })
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

describe('getMetroCpiAreaForCounty — Tier 2: division lookup', () => {
  test('rural Mississippi county → East South Central division (0360)', () => {
    // Amite County, MS — not in any CPI metro CBSA
    const result = getMetroCpiAreaForCounty('28005', 'MS')
    expect(result.areaCode).toBe('0360')
    expect(result.areaName).toBe('East South Central')
    expect(result.tier).toBe(2)
  })

  test('Erie County NY (Buffalo) → Middle Atlantic division (0120)', () => {
    // Buffalo not in primary Boston CBSA → falls to division
    const result = getMetroCpiAreaForCounty('36029', 'NY')
    expect(result.areaCode).toBe('0120')
    expect(result.tier).toBe(2)
  })

  test('Sacramento County CA → Pacific division (0490)', () => {
    // Sacramento not in primary SF CBSA → falls to division
    const result = getMetroCpiAreaForCounty('06067', 'CA')
    expect(result.areaCode).toBe('0490')
    expect(result.tier).toBe(2)
  })

  test('state abbreviation is case-insensitive', () => {
    const upper = getMetroCpiAreaForCounty('28005', 'MS')
    const lower = getMetroCpiAreaForCounty('28005', 'ms')
    expect(lower.areaCode).toBe(upper.areaCode)
    expect(lower.tier).toBe(upper.tier)
  })
})

describe('getMetroCpiAreaForCounty — Tier 4: national fallback', () => {
  test('Puerto Rico → National (0000)', () => {
    const result = getMetroCpiAreaForCounty('72001', 'PR')
    expect(result.areaCode).toBe('0000')
    expect(result.areaName).toBe('National')
    expect(result.tier).toBe(4)
  })

  test('unknown state → National (0000)', () => {
    const result = getMetroCpiAreaForCounty('99999', 'XX')
    expect(result.areaCode).toBe('0000')
    expect(result.tier).toBe(4)
  })

  test('empty state → National (0000)', () => {
    const result = getMetroCpiAreaForCounty('99999', '')
    expect(result.areaCode).toBe('0000')
    expect(result.tier).toBe(4)
  })
})
