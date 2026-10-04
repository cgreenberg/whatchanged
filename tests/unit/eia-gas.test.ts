import { getGasLookup, describeDuoarea, buildSeriesFromData, isGasStale, type EiaRawPoint } from '@/lib/api/eia'
import eiaFixture from '../fixtures/eia-gas.json'

describe('getGasLookup — Tier 1: county FIPS override', () => {
  test('Cuyahoga County (Cleveland) maps to YCLE at tier 1', () => {
    const result = getGasLookup('OH', 'S23B', '39035')
    expect(result.duoarea).toBe('YCLE')
    expect(result.tier).toBe(1)
    expect(result.geoLevel).toBe('Cleveland area avg')
    expect(result.cacheKey).toBe('eia:gas:epmr:city:YCLE')
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
    expect(result.cacheKey).toBe('eia:gas:epmr:city:Y48SE')
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
    const result = getGasLookup('WA', 'S99Z')
    expect(result.duoarea).toBe('SWA')
    expect(result.tier).toBe(2)
    expect(result.geoLevel).toBe('Washington state avg')
    expect(result.cacheKey).toBe('eia:gas:epmr:state:WA')
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
    expect(result.cacheKey).toBe('eia:gas:epmr:pad:1C')
  })

  test('KY (PAD 2 — Midwest; East South Central division is mostly PADD 3) maps to R20', () => {
    const result = getGasLookup('KY')
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

  test('OR (PAD 5 — West Coast) maps to R5XCA (PADD 5 excl. California)', () => {
    const result = getGasLookup('OR')
    expect(result.duoarea).toBe('R5XCA')
    expect(result.tier).toBe(3)
    expect(result.geoLevel).toBe('West Coast excl. California (PADD 5) avg')
    expect(result.cacheKey).toBe('eia:gas:epmr:pad:5XCA')
  })
})

describe('getGasLookup — national fallback', () => {
  test('unknown state returns national fallback', () => {
    const result = getGasLookup('XX')
    expect(result.duoarea).toBe('NUS')
    expect(result.geoLevel).toBe('National avg')
    expect(result.tier).toBe(3)
    expect(result.cacheKey).toBe('eia:gas:epmr:national')
  })

  test('empty state string returns national fallback', () => {
    const result = getGasLookup('')
    expect(result.duoarea).toBe('NUS')
    expect(result.tier).toBe(3)
  })
})

describe('getGasLookup — tier, key and label derive from the duoarea', () => {
  test('county override pointing at a STATE series is tier 2 with the state key', () => {
    const r = getGasLookup('WA', '0490', '53011') // Clark County → SWA
    expect(r.duoarea).toBe('SWA')
    expect(r.tier).toBe(2)
    expect(r.cacheKey).toBe('eia:gas:epmr:state:WA')
    expect(r.cacheKey).toBe(getGasLookup('WA').cacheKey)
  })

  test('county override pointing at a PADD series is tier 3 with the PADD key and PADD label', () => {
    const r = getGasLookup('LA', '0370', '22071') // Orleans Parish → R30
    expect(r.duoarea).toBe('R30')
    expect(r.tier).toBe(3)
    expect(r.cacheKey).toBe('eia:gas:epmr:pad:3')
    expect(r.geoLevel).toBe('Gulf Coast (PADD 3) avg')
    expect(r.cacheKey).toBe(getGasLookup('LA').cacheKey)
  })

  test('a PADD series has one key whether reached via override or state fallback', () => {
    expect(describeDuoarea('R50', 'West Coast avg').cacheKey).toBe('eia:gas:epmr:pad:5')
    expect(describeDuoarea('R50', 'West Coast avg').geoLevel).toBe('West Coast (PADD 5) avg')
  })

  test('R5XCA is labeled West Coast excl. California', () => {
    const r = describeDuoarea('R5XCA')
    expect(r.tier).toBe(3)
    expect(r.geoLevel).toBe('West Coast excl. California (PADD 5) avg')
    expect(r.cacheKey).toBe('eia:gas:epmr:pad:5XCA')
  })

  test('city codes are tier 1, NUS is the shared national key', () => {
    expect(describeDuoarea('Y48SE').tier).toBe(1)
    expect(describeDuoarea('NUS').cacheKey).toBe('eia:gas:epmr:national')
  })
})

describe('buildSeriesFromData (real parser, EIA fixture)', () => {
  const data = eiaFixture.response.data as EiaRawPoint[]

  test('baseline = last weekly reading on or before 2025-01-20 (Jan 13/20/27 trio → Jan 20)', () => {
    const r = buildSeriesFromData(data)
    expect(r.baselineDate).toBe('2025-01-20')
    expect(r.baseline).toBe(3.489)
    expect(r.latestDate).toBe('2025-02-24')
    expect(r.current).toBe(3.752)
    // Change of the prices as displayed ($3.75 − $3.49)
    expect(r.change).toBe(0.26)
    expect(r.series[0].date).toBe('2016-06-20')
  })

  test('without a Jan 20 reading the baseline is Jan 13 (never Jan 27)', () => {
    const r = buildSeriesFromData(data.filter((d) => d.period !== '2025-01-20'))
    expect(r.baselineDate).toBe('2025-01-13')
    expect(r.baseline).toBe(3.512)
  })

  test('"--" values are skipped, both for baseline and latest', () => {
    const r = buildSeriesFromData([
      { period: '2025-03-03', value: '--' },
      ...data.map((d) => (d.period === '2025-01-20' ? { ...d, value: '--' } : d)),
    ])
    expect(r.baselineDate).toBe('2025-01-13')
    expect(r.latestDate).toBe('2025-02-24')
  })

  test('no reading within the week before Jan 20 → throws (no fake baseline)', () => {
    expect(() => buildSeriesFromData(data.filter((d) => d.period >= '2025-01-27' || d.period < '2025-01-01'))).toThrow()
  })

  test('isGasStale flags data older than 10 days', () => {
    const now = new Date('2025-03-10T00:00:00Z').getTime()
    expect(isGasStale('2025-03-03', now)).toBe(false)
    expect(isGasStale('2025-02-24', now)).toBe(true)
  })
})
