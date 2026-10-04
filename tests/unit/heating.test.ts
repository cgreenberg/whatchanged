/** Home heating fuel: EIA SHOPP parsing + heating-season staleness, NYSERDA parsing + region mapping, graph inputs. */
import shopp from '../fixtures/eia-heating-shopp.json'
import nyRows from '../fixtures/nyserda-heating-oil.json'
import zipCounty from '@/lib/data/zip-county.json'
import {
  buildHeatingSeries, heatingSeasonStatus, isHeatingOffSeason, isValidHeating, heatingSeriesId, HEATING_STATES,
  type EiaHeatingRow,
} from '@/lib/api/eia-heating'
import { parseNyserdaRows, nyserdaSeries, isValidNyserda } from '@/lib/api/nyserda'
import { NYSERDA_REGIONS, nyserdaRegionForCounty } from '@/lib/mappings/nyserda-regions'
import { withSeasonGaps } from '@/components/charts/chart-inputs'

const rows = shopp.response.data as EiaHeatingRow[]

describe('EIA SHOPP weekly residential heating oil / propane', () => {
  test('Maine heating oil: baseline = the week of Jan 20 2025, latest = end of the 2025-26 season', () => {
    const s = buildHeatingSeries(rows, 'oil', 'ME')
    expect(s).toMatchObject({ seriesId: 'W_EPD2F_PRS_SME_DPG', baselineDate: '2025-01-20', baseline: 3.669, latestDate: '2026-03-30', current: 5.371 })
    expect(s.change).toBeCloseTo(((5.371 - 3.669) / 3.669) * 100, 2)
    expect(isValidHeating(s)).toBe(true)
  })

  test('Georgia: propane only (no SHOPP heating oil)', () => {
    expect(HEATING_STATES.oil).not.toContain('GA')
    expect(HEATING_STATES.propane).toContain('GA')
    expect(() => buildHeatingSeries(rows, 'oil', 'GA')).toThrow()
    expect(buildHeatingSeries(rows, 'propane', 'GA').seriesId).toBe('W_EPLLPA_PRS_SGA_DPG')
    expect(heatingSeriesId('propane', 'US')).toBe('W_EPLLPA_PRS_NUS_DPG')
  })

  test('heating season: off-season (Apr – mid-Oct) with the season\'s last weeks is labeled, not stale', () => {
    expect(isHeatingOffSeason(new Date('2026-10-04T12:00:00Z'))).toBe(true)
    expect(isHeatingOffSeason(new Date('2026-10-20T12:00:00Z'))).toBe(false)
    expect(isHeatingOffSeason(new Date('2026-03-10T12:00:00Z'))).toBe(false)
    expect(heatingSeasonStatus('2026-03-30', new Date('2026-10-04T12:00:00Z'))).toEqual({
      offSeason: true, stale: false, note: 'Heating-season survey (Oct–Mar) · latest Mar 30, 2026 · next update mid-Oct',
    })
    // Early October once the new season's first week is out: in season again (not "between seasons")
    expect(heatingSeasonStatus('2026-10-05', new Date('2026-10-08T12:00:00Z'))).toEqual({ offSeason: false, stale: false })
    // A series that stopped before March is stale even off-season
    expect(heatingSeasonStatus('2026-01-05', new Date('2026-06-01T12:00:00Z'))).toMatchObject({ offSeason: false, stale: true })
    // In season: overdue after 10 days
    expect(heatingSeasonStatus('2026-11-02', new Date('2026-11-09T12:00:00Z')).stale).toBe(false)
    expect(heatingSeasonStatus('2026-11-02', new Date('2026-11-20T12:00:00Z')).stale).toBe(true)
  })

  test('the graph draws the April–September break as a gap (empty rows at both ends)', () => {
    const s = buildHeatingSeries(rows, 'oil', 'ME')
    const r = withSeasonGaps(s.series)
    const empty = r.map((x, i) => (x.price === undefined ? i : -1)).filter((i) => i >= 0)
    expect(empty).toHaveLength(2) // one summer break in the fixture (Oct 2024 – Mar 2026)
    const [a, b] = empty
    expect(b).toBe(a + 1)
    // a week after the last spring reading … a week before the first October reading
    const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000
    expect(day(r[a].date) - day(r[a - 1].date)).toBe(7)
    expect(day(r[b + 1].date) - day(r[b].date)).toBe(7)
    expect(r[b + 1].date.startsWith('2025-10')).toBe(true)
  })
})

describe('NYSERDA New York regional heating oil', () => {
  const d = parseNyserdaRows(nyRows)
  test('parses every region + statewide; Upper Hudson baseline = Jan 20 2025', () => {
    expect(isValidNyserda(d)).toBe(true)
    const s = nyserdaSeries(d, 'upper_hudson_average_gal')
    expect(s.baselineDate).toBe('2025-01-20')
    expect(s.latestDate >= '2026-09-01').toBe(true)
  })

  test('every New York county is in exactly one NYSERDA region (62 counties)', () => {
    const ny = [...new Set(Object.values(zipCounty as Record<string, { countyFips: string; stateAbbr: string }>)
      .filter((v) => v.stateAbbr === 'NY').map((v) => v.countyFips))]
    expect(ny).toHaveLength(62)
    const all = NYSERDA_REGIONS.flatMap((r) => r.counties)
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual(ny.sort())
    expect(nyserdaRegionForCounty('36071')?.name).toBe('Upper Hudson') // Orange County (Monroe 10950)
    expect(nyserdaRegionForCounty('36119')?.name).toBe('Lower Hudson') // Westchester
  })
})
