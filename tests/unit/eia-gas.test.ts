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
  test('NC (PAD 1 — East Coast) maps to R10', () => {
    const result = getGasLookup('NC')
    expect(result.duoarea).toBe('R10')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('East Coast avg')
    expect(result.cacheKey).toBe('eia:gas:pad:1')
  })

  test('KS (PAD 2 — Midwest) maps to R20', () => {
    const result = getGasLookup('KS')
    expect(result.duoarea).toBe('R20')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('Midwest avg')
  })

  test('LA (PAD 3 — Gulf Coast) maps to R30', () => {
    const result = getGasLookup('LA')
    expect(result.duoarea).toBe('R30')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('Gulf Coast avg')
  })

  test('MT (PAD 4 — Rocky Mountain) maps to R40', () => {
    const result = getGasLookup('MT')
    expect(result.duoarea).toBe('R40')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('Rocky Mountain avg')
  })

  test('OR (PAD 5 — West Coast) maps to R50', () => {
    const result = getGasLookup('OR')
    expect(result.duoarea).toBe('R50')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('West Coast avg')
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
