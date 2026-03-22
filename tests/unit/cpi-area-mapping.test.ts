import {
  getMetroCpiArea,
  getMetroCpiAreaForCounty,
  STATE_TO_CPI_AREA,
  COUNTY_CPI_OVERRIDES,
  BLS_CPI_AREAS,
} from '@/lib/data/county-metro-cpi'

describe('getMetroCpiArea — state defaults', () => {
  test('WA maps to Seattle (S49D)', () => {
    const result = getMetroCpiArea('WA')
    expect(result.areaCode).toBe('S49D')
    expect(result.areaName).toBe('Seattle-Tacoma-Bellevue')
  })

  test('CA maps to Los Angeles (S49A) by default', () => {
    const result = getMetroCpiArea('CA')
    expect(result.areaCode).toBe('S49A')
    expect(result.areaName).toBe('Los Angeles-Long Beach-Anaheim')
  })

  test('NY maps to New York (S12A)', () => {
    const result = getMetroCpiArea('NY')
    expect(result.areaCode).toBe('S12A')
    expect(result.areaName).toBe('New York-Newark-Jersey City')
  })

  test('TX maps to Dallas (S37A) by default', () => {
    const result = getMetroCpiArea('TX')
    expect(result.areaCode).toBe('S37A')
    expect(result.areaName).toBe('Dallas-Fort Worth-Arlington')
  })

  test('IL maps to Chicago (S23A)', () => {
    const result = getMetroCpiArea('IL')
    expect(result.areaCode).toBe('S23A')
    expect(result.areaName).toBe('Chicago-Naperville-Elgin')
  })

  test('OR maps to Seattle (S49D) — Portland has no BLS CPI metro', () => {
    const result = getMetroCpiArea('OR')
    expect(result.areaCode).toBe('S49D')
    expect(result.areaName).toBe('Seattle-Tacoma-Bellevue')
  })

  test('FL maps to Miami (S35B)', () => {
    const result = getMetroCpiArea('FL')
    expect(result.areaCode).toBe('S35B')
    expect(result.areaName).toBe('Miami-Fort Lauderdale-West Palm Beach')
  })

  test('DC maps to Washington (S35A)', () => {
    const result = getMetroCpiArea('DC')
    expect(result.areaCode).toBe('S35A')
    expect(result.areaName).toBe('Washington-Arlington-Alexandria')
  })

  test('MD maps to Baltimore (S35E)', () => {
    const result = getMetroCpiArea('MD')
    expect(result.areaCode).toBe('S35E')
    expect(result.areaName).toBe('Baltimore-Columbia-Towson')
  })

  test('AK maps to Urban Alaska (S49G)', () => {
    const result = getMetroCpiArea('AK')
    expect(result.areaCode).toBe('S49G')
    expect(result.areaName).toBe('Urban Alaska')
  })

  test('HI maps to Urban Hawaii (S49F)', () => {
    const result = getMetroCpiArea('HI')
    expect(result.areaCode).toBe('S49F')
    expect(result.areaName).toBe('Urban Hawaii')
  })

  test('state abbreviation is case-insensitive', () => {
    const upper = getMetroCpiArea('WA')
    const lower = getMetroCpiArea('wa')
    expect(lower.areaCode).toBe(upper.areaCode)
    expect(lower.areaName).toBe(upper.areaName)
  })

  test('unknown state falls back to national (0000)', () => {
    const result = getMetroCpiArea('XX')
    expect(result.areaCode).toBe('0000')
    expect(result.areaName).toBe('National')
  })

  test('empty state falls back to national (0000)', () => {
    const result = getMetroCpiArea('')
    expect(result.areaCode).toBe('0000')
    expect(result.areaName).toBe('National')
  })

  test('PR has no CPI area — falls back to national', () => {
    const result = getMetroCpiArea('PR')
    expect(result.areaCode).toBe('0000')
    expect(result.areaName).toBe('National')
  })
})

describe('getMetroCpiAreaForCounty — county overrides', () => {
  test('San Francisco County (06075) overrides CA default to SF metro (S49B)', () => {
    const result = getMetroCpiAreaForCounty('06075', 'CA')
    expect(result.areaCode).toBe('S49B')
    expect(result.areaName).toBe('San Francisco-Oakland-Hayward')
  })

  test('Santa Clara County (06085) → SF metro, not LA default', () => {
    const result = getMetroCpiAreaForCounty('06085', 'CA')
    expect(result.areaCode).toBe('S49B')
  })

  test('San Diego County (06073) → San Diego metro (S49E)', () => {
    const result = getMetroCpiAreaForCounty('06073', 'CA')
    expect(result.areaCode).toBe('S49E')
    expect(result.areaName).toBe('San Diego-Carlsbad')
  })

  test('Riverside County (06065) → Riverside metro (S49C)', () => {
    const result = getMetroCpiAreaForCounty('06065', 'CA')
    expect(result.areaCode).toBe('S49C')
    expect(result.areaName).toBe('Riverside-San Bernardino-Ontario')
  })

  test('Harris County TX (48201) → Houston metro, not TX default Dallas', () => {
    const result = getMetroCpiAreaForCounty('48201', 'TX')
    expect(result.areaCode).toBe('S37B')
    expect(result.areaName).toBe('Houston-The Woodlands-Sugar Land')
  })

  test('Montgomery County MD (24031) → Washington metro, not MD default Baltimore', () => {
    const result = getMetroCpiAreaForCounty('24031', 'MD')
    expect(result.areaCode).toBe('S35A')
    expect(result.areaName).toBe('Washington-Arlington-Alexandria')
  })

  test('county without override uses state default', () => {
    // King County, WA (53033) — no override, should get WA default (Seattle)
    const result = getMetroCpiAreaForCounty('53033', 'WA')
    expect(result.areaCode).toBe('S49D')
    expect(result.areaName).toBe('Seattle-Tacoma-Bellevue')
  })

  test('unknown county FIPS uses state default', () => {
    const result = getMetroCpiAreaForCounty('99999', 'IL')
    expect(result.areaCode).toBe('S23A') // IL default = Chicago
  })
})

describe('lookup table integrity', () => {
  test('all COUNTY_CPI_OVERRIDES have 5-digit FIPS keys', () => {
    for (const fips of Object.keys(COUNTY_CPI_OVERRIDES)) {
      expect(fips).toMatch(/^\d{5}$/)
    }
  })

  test('all COUNTY_CPI_OVERRIDES values exist in BLS_CPI_AREAS', () => {
    for (const [fips, areaCode] of Object.entries(COUNTY_CPI_OVERRIDES)) {
      expect(BLS_CPI_AREAS[areaCode]).toBeDefined()
    }
  })

  test('all STATE_TO_CPI_AREA values exist in BLS_CPI_AREAS', () => {
    for (const [state, code] of Object.entries(STATE_TO_CPI_AREA)) {
      expect(BLS_CPI_AREAS[code]).toBeDefined()
    }
  })

  test('all BLS_CPI_AREAS have name and code matching their key', () => {
    for (const [key, area] of Object.entries(BLS_CPI_AREAS)) {
      expect(area.code).toBe(key)
      expect(area.name).toBeTruthy()
    }
  })
})
