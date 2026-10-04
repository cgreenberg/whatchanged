/**
 * BLS CPI average-price gas tiers (APU{area}74714, monthly): lookup order, parser
 * (real recorded BLS response), card / provenance / national comparison, chart
 * baseline, and the snapshot path (MSW serves the recorded fixture).
 */
import zipCounty from '@/lib/data/zip-county.json'
import { getGasLookup } from '@/lib/api/eia'
import { parseBlsGasSeries, describeBlsGasArea, blsGasCacheKey } from '@/lib/api/bls-gas'
import { isValidGasSeries } from '@/lib/api/validate'
import { BLS_CPI_AREAS, STATE_TO_DIVISION, getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import { CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES, STATE_LEVEL_CODES, STATE_TO_PAD } from '@/lib/mappings/eia-gas'
import { BLS_GAS_PUBLISHED_AREAS } from '@/lib/mappings/bls-gas'
import { buildGasCard, gasShortGeo, metadataDescription } from '@/lib/hero-cards'
import { provenanceText } from '@/lib/provenance'
import { gasBaselineIndex, gasNationalMatching } from '@/lib/baseline'
import { filterByTimeframe } from '@/lib/charts/chart-data'
import { getChartInput } from '@/components/charts/chart-inputs'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { clearMemCache, getCachedEnvelope } from '@/lib/cache/kv'
import type { EconomicSnapshot } from '@/types'
import austin from '../fixtures/snapshots/78701.json'
import { blsGasData, blsGasRaw } from '../mocks/bls-gas-data'

const zips = zipCounty as Record<string, { countyFips: string; stateAbbr: string }>
const snap = (): EconomicSnapshot => JSON.parse(JSON.stringify(austin))

describe('lookup order: EIA city > BLS metro > HI/AK urban > EIA state > BLS Midwest division > EIA PADD', () => {
  // Derived from the mapping tables, not hard-coded: every CPI metro either has an EIA city or gets BLS.
  const metros = Object.keys(BLS_CPI_AREAS).filter((c) => c.startsWith('S'))
  const withoutEiaCity = metros.filter((c) => !CPI_TO_EIA_CITY[c])

  test('every CPI metro without an EIA city series resolves to its own BLS metro series', () => {
    expect(withoutEiaCity.length).toBeGreaterThan(0)
    for (const code of withoutEiaCity) {
      expect(BLS_GAS_PUBLISHED_AREAS.has(code)).toBe(true)
      const g = getGasLookup('ZZ', code)
      expect(g).toMatchObject({ source: 'bls', frequency: 'monthly', areaCode: code, cacheKey: `bls:gas:${code}` })
    }
    for (const code of metros.filter((c) => CPI_TO_EIA_CITY[c])) {
      expect(getGasLookup('ZZ', code)).toMatchObject({ source: 'eia', duoarea: CPI_TO_EIA_CITY[code].duoarea })
    }
  })

  test('every zip: tier chosen in spec order (checked against the mapping tables)', () => {
    const bad: string[] = []
    for (const [zip, { countyFips, stateAbbr: st }] of Object.entries(zips)) {
      const cpi = getMetroCpiAreaForCounty(countyFips, st)
      const g = getGasLookup(st, cpi.areaCode, countyFips)
      let want: string
      const div = STATE_TO_DIVISION[st]?.code
      if (COUNTY_EIA_CITY_OVERRIDES[countyFips]) want = `eia:${COUNTY_EIA_CITY_OVERRIDES[countyFips].duoarea}`
      else if (CPI_TO_EIA_CITY[cpi.areaCode]) want = `eia:${CPI_TO_EIA_CITY[cpi.areaCode].duoarea}`
      else if (cpi.areaCode.startsWith('S')) want = `bls:${cpi.areaCode}`
      else if (st === 'HI') want = 'bls:S49F'
      else if (st === 'AK') want = 'bls:S49G'
      else if (STATE_LEVEL_CODES[st]) want = `eia:${STATE_LEVEL_CODES[st].duoarea}`
      else if (div === '0230' || div === '0240') want = `bls:${div}`
      else if (STATE_TO_PAD[st] !== undefined) want = 'eia:pad'
      else want = 'eia:NUS'
      const got = `${g.source}:${g.areaCode}`
      if (want === 'eia:pad' ? !(g.source === 'eia' && g.areaCode.startsWith('R')) : got !== want) bad.push(`${zip} ${st} ${got} != ${want}`)
      if (g.source === 'bls' && !BLS_GAS_PUBLISHED_AREAS.has(g.areaCode)) bad.push(`${zip} unpublished BLS area ${g.areaCode}`)
    }
    expect(bad.slice(0, 20)).toEqual([])
  })

  test('Midwest divisions only where the whole division is in PADD 2; OH/MN keep their EIA state series', () => {
    for (const st of ['IL', 'IN', 'MI', 'WI']) expect(getGasLookup(st, '0230').areaCode).toBe('0230')
    for (const st of ['IA', 'KS', 'MO', 'NE', 'ND', 'SD']) expect(getGasLookup(st, '0240').areaCode).toBe('0240')
    expect(getGasLookup('OH', '0230').areaCode).toBe('SOH')
    expect(getGasLookup('MN', '0240').areaCode).toBe('SMN')
    for (const st of ['KY', 'TN']) expect(getGasLookup(st, '0360').areaCode).toBe('R20')
    expect(getGasLookup('OK', '0370').areaCode).toBe('R20')
  })

  test('labels, tiers and keys derive from the area code', () => {
    expect(describeBlsGasArea('S12B')).toMatchObject({ tier: 1, geoLevel: 'Philadelphia-Camden-Wilmington metro avg', seriesId: 'APUS12B74714' })
    expect(describeBlsGasArea('S49F')).toMatchObject({ tier: 2, geoLevel: 'Urban Hawaii avg', cacheKey: 'bls:gas:S49F' })
    expect(describeBlsGasArea('0230')).toMatchObject({ tier: 3, geoLevel: 'East North Central division avg' })
    expect(blsGasCacheKey('0000')).toBe('bls:gas:0000')
  })
})

describe('parseBlsGasSeries (real recorded BLS response)', () => {
  test('baseline = Jan 2025, current = latest month, same series; dates are YYYY-MM', () => {
    const s = parseBlsGasSeries(blsGasRaw('S12B'), 'Philadelphia-Camden-Wilmington')
    expect(s.baselineDate).toBe('2025-01')
    expect(s.baseline).toBe(3.133)
    expect(s.latestDate).toBe('2026-08')
    expect(s.current).toBe(4.076)
    expect(s.change).toBe(0.943)
    expect(s.series.every((p) => /^\d{4}-\d{2}$/.test(p.date))).toBe(true)
    expect(isValidGasSeries(s)).toBe(true)
  })

  test('no January 2025 value → throws (never a different baseline month)', () => {
    const raw = blsGasRaw('S49F').filter((d) => !(d.year === '2025' && d.period === 'M01'))
    expect(() => parseBlsGasSeries(raw, 'Urban Hawaii')).toThrow(/January 2025/)
    expect(() => parseBlsGasSeries([], 'X')).toThrow(/No BLS gas price data/)
  })

  test('sanity range $1–$10 applies', () => {
    const s = parseBlsGasSeries(blsGasRaw('S49F'), 'Urban Hawaii')
    expect(isValidGasSeries({ ...s, current: 12 })).toBe(false)
    expect(isValidGasSeries({ ...s, baseline: 0.5 })).toBe(false)
  })
})

describe('BLS gas card, provenance, national comparison, chart', () => {
  test('card: $/gal + change since Jan 2025, BLS provenance, BLS national over the same months', () => {
    const s = snap()
    s.location = { ...s.location, stateAbbr: 'PA' }
    s.gas.data = blsGasData('S12B')
    const c = buildGasCard(s)
    expect(c.value).toBe('$4.08/gal')
    expect(c.change).toBe('+$0.94/gal since Jan 2025')
    expect(provenanceText(c.provenance)).toBe(
      'BLS CPI average price, regular gasoline · Philadelphia-Camden-Wilmington metro avg · monthly · since Jan 2025 · Aug 2026 · not seasonally adjusted'
    )
    expect(c.provenance.sourceUrl).toBe('https://data.bls.gov/timeseries/APUS12B74714')
    expect(c.nationalValue).toBe('National: $4.20/gal (+$0.99)') // APU000074714: 3.211 → 4.200
    expect(c.geoTag).toBe('Philadelphia metro')
    expect(c.asOfPeriod).toBe('2026-08')
    expect(metadataDescription(s)).toContain('Gas +$0.94/gal (Philadelphia metro)')
  })

  test('national comparison never covers a different month than the local figure', () => {
    const g = blsGasData('S12B')
    g.nationalSeries = g.nationalSeries!.filter((p) => p.date !== '2026-08') // national lags a month
    expect(gasNationalMatching(g)).toBeNull()
    const s = snap()
    s.gas.data = g
    expect(buildGasCard(s).nationalValue).toBeUndefined()
  })

  test('short geography tags', () => {
    expect(gasShortGeo(blsGasData('S49F'))).toBe('Urban Hawaii')
    expect(gasShortGeo(blsGasData('S35A'))).toBe('Washington metro')
    expect(gasShortGeo(blsGasData('0230'))).toBe('East North Central div.')
    expect(gasShortGeo(blsGasData('0240'))).toBe('West North Central div.')
  })

  test('chart: monthly rows, Jan 2025 view starts at the Jan 2025 month (= card baseline)', () => {
    const s = snap()
    s.gas.data = blsGasData('S49F')
    const input = getChartInput('gas', s)
    expect(input.weeklyGasBaseline).toBe(false)
    expect(input.provenance.source).toBe('BLS CPI average price, regular gasoline')
    expect(input.provenance.asOf).toBe('Aug 2026')
    const rows = filterByTimeframe(input.data, 'Jan 2025', input.weeklyGasBaseline, 'price')
    expect(rows[0]).toEqual({ date: '2025-01', price: 4.413 })
    expect(rows[rows.length - 1]).toEqual({ date: '2026-08', price: 5.402 })
    expect(input.nationalData.every((r) => /^\d{4}-\d{2}$/.test(r.date))).toBe(true)
    expect(gasBaselineIndex(input.data)).toBe(input.data.findIndex((r) => r.date === '2025-01'))
  })
})

describe('snapshot: BLS tier end to end (MSW serves the recorded BLS response)', () => {
  beforeEach(() => clearMemCache())

  test.each([
    ['19103', 'S12B'],
    ['96813', 'S49F'],
    ['53202', '0230'],
  ])('zip %s → BLS %s with the BLS U.S. average as national', async (zip, area) => {
    const s = await fetchSnapshot(zip)
    const g = s!.gas.data!
    expect(g).toMatchObject({ source: 'bls', frequency: 'monthly', blsArea: area, seriesId: `APU${area}74714`, baselineDate: '2025-01' })
    expect(g.duoarea).toBeUndefined()
    expect(s!.gas.sourceId).toBe('bls-gas')
    expect(g.nationalSeries!.find((p) => p.date === '2025-01')!.price).toBe(3.211) // APU000074714, not EIA NUS
    expect(await getCachedEnvelope(`bls:gas:${area}`)).not.toBeNull()
    expect(await getCachedEnvelope('bls:gas:0000')).not.toBeNull()
    expect(s!.dollarImpact!.gas).toBe(g.change)
  })
})
