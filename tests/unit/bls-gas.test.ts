/**
 * BLS CPI average-price gas tiers (APU{area}74714, monthly): lookup order, parser
 * (real recorded BLS response), card / provenance / national comparison, chart
 * baseline, and the snapshot path (MSW serves the recorded fixture).
 */
import zipCounty from '@/lib/data/zip-county.json'
import { getGasLookup } from '@/lib/api/eia'
import { parseBlsGasSeries, describeBlsGasArea, blsGasCacheKey } from '@/lib/api/bls-gas'
import { isValidGasSeries } from '@/lib/api/validate'
import { BLS_CPI_AREAS, getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import { CPI_TO_EIA_CITY, COUNTY_EIA_CITY_OVERRIDES, STATE_LEVEL_CODES, STATE_TO_PAD } from '@/lib/mappings/eia-gas'
import { BLS_GAS_PUBLISHED_AREAS } from '@/lib/mappings/bls-gas'
import { buildGasCard, gasShortGeo, metadataDescription, gasCaveatFor } from '@/lib/hero-cards'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { blsFixtureFor } from '../mocks/handlers'
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

describe('lookup order: EIA city > BLS metro > HI/AK stand-in > EIA state > EIA PADD', () => {
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
      if (COUNTY_EIA_CITY_OVERRIDES[countyFips]) want = `eia:${COUNTY_EIA_CITY_OVERRIDES[countyFips].duoarea}`
      else if (CPI_TO_EIA_CITY[cpi.areaCode]) want = `eia:${CPI_TO_EIA_CITY[cpi.areaCode].duoarea}`
      else if (cpi.areaCode.startsWith('S')) want = `bls:${cpi.areaCode}`
      else if (st === 'HI') want = 'bls:S49F'
      else if (st === 'AK') want = 'bls:S49G'
      else if (STATE_LEVEL_CODES[st]) want = `eia:${STATE_LEVEL_CODES[st].duoarea}`
      else if (STATE_TO_PAD[st] !== undefined) want = 'eia:pad'
      else want = 'eia:NUS'
      const got = `${g.source}:${g.areaCode}`
      if (want === 'eia:pad' ? !(g.source === 'eia' && g.areaCode.startsWith('R')) : got !== want) bad.push(`${zip} ${st} ${got} != ${want}`)
      if (g.source === 'bls' && !BLS_GAS_PUBLISHED_AREAS.has(g.areaCode)) bad.push(`${zip} unpublished BLS area ${g.areaCode}`)
      if (g.source === 'bls' && !/^S/.test(g.areaCode)) bad.push(`${zip} non-metro BLS gas area ${g.areaCode}`)
      // stand-in exactly when a HI/AK county is outside the Honolulu / Anchorage CBSA
      if (!!g.standIn !== ((st === 'HI' || st === 'AK') && !cpi.areaCode.startsWith('S'))) bad.push(`${zip} standIn ${g.standIn}`)
    }
    expect(bad.slice(0, 20)).toEqual([])
  })

  test('no BLS division tier: Midwest zips outside a CPI metro keep EIA PADD 2 (OH/MN their EIA state series)', () => {
    for (const st of ['IL', 'IN', 'MI', 'WI']) expect(getGasLookup(st, '0230')).toMatchObject({ source: 'eia', areaCode: 'R20' })
    for (const st of ['IA', 'KS', 'MO', 'NE', 'ND', 'SD']) expect(getGasLookup(st, '0240')).toMatchObject({ source: 'eia', areaCode: 'R20' })
    expect(getGasLookup('OH', '0230').areaCode).toBe('SOH')
    expect(getGasLookup('MN', '0240').areaCode).toBe('SMN')
    for (const st of ['KY', 'TN']) expect(getGasLookup(st, '0360').areaCode).toBe('R20')
    expect(getGasLookup('OK', '0370').areaCode).toBe('R20')
  })

  test('labels, tiers and keys derive from the area code', () => {
    expect(describeBlsGasArea('S12B')).toMatchObject({ tier: 1, geoLevel: 'Philadelphia-Camden-Wilmington metro avg', seriesId: 'APUS12B74714' })
    // BLS titles S49F/S49G "Urban Hawaii/Alaska" but they are the Honolulu / Anchorage CBSAs only
    expect(describeBlsGasArea('S49F')).toMatchObject({ tier: 1, geoLevel: 'Honolulu metro avg', cacheKey: 'bls:gas:S49F' })
    expect(describeBlsGasArea('S49G')).toMatchObject({ tier: 1, geoLevel: 'Anchorage metro avg' })
    expect(describeBlsGasArea('S49F', { standIn: true })).toMatchObject({ tier: 2, geoLevel: 'Honolulu-area price (BLS)', standIn: true, cacheKey: 'bls:gas:S49F' })
    expect(describeBlsGasArea('S49G', { standIn: true })).toMatchObject({ geoLevel: 'Anchorage-area price (BLS)' })
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

  test('a month BLS lists as "-" inside the span is kept as an unpublished month (chart gap)', () => {
    const raw = blsGasRaw('S12B').map((d) => (d.year === '2025' && d.period === 'M10' ? { ...d, value: '-' } : d))
    const s = parseBlsGasSeries(raw, 'Philadelphia')
    expect(s.unpublished).toEqual(['2025-10'])
    expect(s.series.some((p) => p.date === '2025-10')).toBe(false)
    const snapS = snap()
    snapS.gas.data = { ...blsGasData('S12B'), series: s.series, unpublished: s.unpublished }
    const rows = getChartInput('gas', snapS).data
    expect(rows.find((r) => r.date === '2025-10')).toEqual({ date: '2025-10' })
    expect(parseBlsGasSeries(blsGasRaw('S12B'), 'Philadelphia').unpublished).toBeUndefined()
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
    expect(c.change).toBe('+$0.94 since Jan 2025')
    // Short card lines: national comparison and "{area} · {source} · {Mon YYYY}"
    expect(c.secondary).toBe('U.S. +$0.99')
    expect(c.sourceLine).toBe('Philadelphia metro · BLS · Aug 2026')
    // The full wording moves into the ⓘ disclosure
    expect(c.info).toContain('+$0.94/gal since Jan 2025, through Aug 2026 (monthly).')
    expect(c.info).toContain('National: $4.20/gal (+$0.99) · U.S. city avg, BLS, Aug 2026')
    expect(provenanceText(c.provenance)).toBe(
      'BLS CPI average price, regular gasoline · Philadelphia-Camden-Wilmington metro avg · monthly · since Jan 2025 · Aug 2026 · not seasonally adjusted'
    )
    expect(c.provenance.sourceUrl).toBe('https://data.bls.gov/timeseries/APUS12B74714')
    // APU000074714: 3.211 → 4.200; source and month named, so it is never read as the EIA national figure
    expect(c.nationalValue).toBe('National: $4.20/gal (+$0.99) · U.S. city avg, BLS, Aug 2026')
    expect(c.detail).toBe('through Aug 2026 (monthly)')
    expect(c.geoTag).toBe('Philadelphia metro')
    expect(c.asOfPeriod).toBe('2026-08')
    expect(metadataDescription(s)).toContain("Gas +$0.94/gal (Philadelphia metro, thru Aug '26)")
  })

  test('national comparison never covers a different month than the local figure', () => {
    const g = blsGasData('S12B')
    g.nationalSeries = g.nationalSeries!.filter((p) => p.date !== '2026-08') // national lags a month
    expect(gasNationalMatching(g)).toBeNull()
    const s = snap()
    s.gas.data = g
    expect(buildGasCard(s).nationalValue).toBeUndefined()
  })

  test('EIA tiers: national tagged EIA with its week; no monthly detail', () => {
    const c = buildGasCard(snap())
    expect(c.nationalValue).toMatch(/^National: \$\d\.\d{2}\/gal \([+−-]\$\d\.\d{2}\) · U\.S\. avg, EIA, week of [A-Z][a-z]{2} \d{1,2}$/)
    expect(c.detail).toBeUndefined()
  })

  test('short geography tags use proper short names (never the CBSA title cut at a hyphen)', () => {
    expect(gasShortGeo(blsGasData('S49F'))).toBe('Honolulu metro')
    expect(gasShortGeo(blsGasData('S49G'))).toBe('Anchorage metro')
    expect(gasShortGeo(blsGasData('S49F', { standIn: true }))).toBe('Honolulu-area price*')
    expect(gasShortGeo(blsGasData('S35A'))).toBe('Washington DC metro')
    expect(gasShortGeo(blsGasData('S37A'))).toBe('Dallas-Fort Worth metro')
    expect(gasShortGeo(blsGasData('S24A'))).toBe('Minneapolis-St. Paul metro')
  })

  test('HI/AK: metro label inside the CBSA; outside, an honest stand-in caveat everywhere', () => {
    const s = snap()
    s.location = { ...s.location, stateAbbr: 'HI', countyFips: '15003', countyName: 'Honolulu County' }
    s.gas.data = blsGasData('S49F')
    expect(buildGasCard(s).caveat).toBeUndefined()
    expect(buildGasCard(s).geoTag).toBe('Honolulu metro')
    s.location = { ...s.location, countyFips: '15001', countyName: 'Hawaii County', cityName: 'Hilo' }
    s.gas.data = blsGasData('S49F', { standIn: true })
    const c = buildGasCard(s)
    expect(c.caveat).toBe('Honolulu-area price — no BLS or EIA series for Hawaii County (Big Island); local prices are typically higher and may have changed differently.')
    expect(c.provenance.geography).toBe('Honolulu-area price (BLS)')
    // On the card: a short "*" after the area; the explanation is in the ⓘ disclosure
    expect(c.sourceLine).toBe('Honolulu-area* · BLS · Aug 2026')
    expect(c.info).toContain(c.caveat)
    expect(getChartInput('gas', s).note).toBe(c.caveat)
    const d = metadataDescription(s)
    expect(d).toContain("Gas +$0.99/gal (Honolulu-area price*, thru Aug '26)")
    expect(d).toContain('* no BLS or EIA gas series for Hawaii Co. (Big Island) — local prices are typically higher and may have changed differently')
    s.location = { ...s.location, stateAbbr: 'AK', countyFips: '02090', countyName: 'Fairbanks North Star Borough' }
    s.gas.data = blsGasData('S49G', { standIn: true })
    expect(gasCaveatFor(s)).toBe('Anchorage-area price — no BLS or EIA series for Fairbanks North Star Borough; local prices are typically higher and may have changed differently.')
  })

  test('chart: monthly rows, Jan 2025 view starts at the Jan 2025 month (= card baseline)', () => {
    const s = snap()
    s.gas.data = blsGasData('S49F')
    const input = getChartInput('gas', s)
    expect(input.weeklyGasBaseline).toBe(false)
    expect(input.provenance.source).toBe('BLS CPI average price, regular gasoline')
    expect(input.provenance.asOf).toBe('Aug 2026')
    expect(input.nationalLabel).toBe('U.S. city avg, BLS monthly')
    expect(input.configOverrides?.description).toContain('Used for metros where EIA publishes no weekly city series, and for Hawaii/Alaska')
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
    ['96720', 'S49F'],
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

describe('snapshot: BLS outage falls back to the zip\'s EIA weekly tier as a whole', () => {
  beforeEach(() => {
    clearMemCache()
    // BLS answers, but with no data for any APU…74714 series (CPI still served)
    server.use(
      http.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', async ({ request }) => {
        const body = (await request.json()) as { seriesid?: string[] }
        const ids = body?.seriesid ?? []
        return HttpResponse.json({
          status: 'REQUEST_SUCCEEDED', responseTime: 1, message: [],
          Results: { series: ids.map((id) => ({ seriesID: id, data: id.startsWith('APU') ? [] : blsFixtureFor(id) })) },
        })
      })
    )
  })

  test('19103 (Philadelphia): EIA PADD 1B local + EIA NUS national, labeled; never BLS mixed with EIA', async () => {
    const s = await fetchSnapshot('19103')
    const g = s!.gas.data!
    expect(g).toMatchObject({ source: 'eia', frequency: 'weekly', duoarea: 'R1Y', fallback: 'eia' })
    expect(g.nationalSeries?.length).toBeGreaterThan(0)
    expect(g.nationalSeries!.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date))).toBe(true) // weekly EIA dates
    expect(s!.gas.sourceId).toBe('eia-gas')
    const c = buildGasCard(s!)
    expect(c.status).toBe('ok')
    expect(c.caveat).toMatch(/BLS monthly gas price unavailable/)
    expect(c.nationalValue).toMatch(/U\.S\. avg, EIA/)
    expect(c.sourceLine).toMatch(/^Central Atlantic avg \(metro n\/a\) · EIA · [A-Z][a-z]{2} \d{1,2}, \d{4}$/)
    expect(c.info).toContain(c.caveat)
  })

  test('96720 (Hilo): EIA has no HI series → labeled U.S. average, not the West Coast PADD', async () => {
    const s = await fetchSnapshot('96720')
    const g = s!.gas.data!
    expect(g).toMatchObject({ source: 'eia', duoarea: 'NUS', fallback: 'national' })
    expect(gasShortGeo(g, 'HI')).toBe('U.S. avg; local n/a')
    expect(buildGasCard(s!).sourceLine).toMatch(/^U\.S\. avg \(local n\/a\) · EIA · /)
  })
})
