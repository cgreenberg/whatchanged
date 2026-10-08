import share from '@/lib/data/heating-fuel-share.json'
import { STATE_FIPS_MAP } from '@/lib/mappings/state-fips'

// ACS B25040 state shares of homes heated with fuel oil/kerosene and with propane (bundled by
// scripts/build-heating-fuel-share.ts); used to decide which heating-fuel tabs a state gets.
const S = share as { meta: Record<string, unknown>; states: Record<string, { oil: number; propane: number; name: string }> }

describe('heating-fuel-share.json', () => {
  test('meta names the ACS table and vintage', () => {
    expect(S.meta).toMatchObject({ table: 'B25040', source: expect.stringMatching(/American Community Survey/) })
    expect(S.meta.vintage).toBeGreaterThanOrEqual(2023)
  })

  test('50 states + DC present, every share a percent', () => {
    const want = Object.values(STATE_FIPS_MAP).map(s => s.abbr).filter(a => !['AS', 'GU', 'MP', 'VI', 'UM', 'PR'].includes(a))
    for (const a of want) expect(S.states[a]).toBeDefined()
    for (const v of Object.values(S.states)) {
      for (const x of [v.oil, v.propane]) expect(x >= 0 && x <= 100).toBe(true)
      expect(v.oil + v.propane).toBeLessThanOrEqual(100)
    }
  })

  test('known patterns: oil heat in northern New England, almost none in Georgia', () => {
    expect(S.states.ME.oil).toBeGreaterThan(30)
    expect(S.states.GA.oil).toBeLessThan(1)
    expect(S.states.GA.propane).toBeLessThan(5)
  })
})
