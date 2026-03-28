import crosswalk from '@/lib/data/cbsa-cpi-crosswalk.json'
import { BLS_CPI_AREAS } from '@/lib/mappings/county-metro-cpi'

describe('CBSA CPI crosswalk', () => {
  test('crosswalk has reasonable county count', () => {
    const count = Object.keys(crosswalk).length
    // Expect 150-300 counties in the 23 primary CPI metro CBSAs
    expect(count).toBeGreaterThan(150)
    expect(count).toBeLessThan(300)
  })

  test('all crosswalk values are valid CPI area codes', () => {
    for (const [fips, code] of Object.entries(crosswalk)) {
      expect(BLS_CPI_AREAS).toHaveProperty(code as string)
    }
  })

  test('all 23 CPI metros have at least one county', () => {
    const usedAreas = new Set(Object.values(crosswalk))
    const metroAreas = Object.keys(BLS_CPI_AREAS).filter(
      code => !['0100','0200','0300','0400','0000'].includes(code)
    )
    for (const area of metroAreas) {
      expect(usedAreas).toContain(area)
    }
  })

  test('all FIPS codes are 5-digit strings', () => {
    for (const fips of Object.keys(crosswalk)) {
      expect(fips).toMatch(/^\d{5}$/)
    }
  })

  test('known county mappings are correct', () => {
    const xw = crosswalk as Record<string, string>
    expect(xw['36061']).toBe('S12A') // Manhattan → NYC
    expect(xw['06037']).toBe('S49A') // LA County → LA
    expect(xw['17031']).toBe('S23A') // Cook County → Chicago
    expect(xw['53033']).toBe('S49D') // King County WA → Seattle
    expect(xw['26163']).toBe('S23B') // Wayne County MI → Detroit
  })
})
