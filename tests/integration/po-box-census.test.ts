/**
 * USPS-only zips (PO boxes / unique zips, `zcta: false`) have no ACS ZCTA.
 * They borrow the ACS values of the nearest residential zip, labeled as an estimate.
 */
import { getCensusData } from '@/lib/data/census-acs'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { buildTariffCard, buildShelterCard } from '@/lib/hero-cards'
import { clearMemCache } from '@/lib/cache/kv'
import zipCounty from '@/lib/data/zip-county.json'
import censusAcs from '@/lib/data/census-acs.json'
import poBoxAcs from '@/lib/data/po-box-acs.json'

const ZIPS = zipCounty as Record<string, { countyFips: string; cityName: string; zcta?: false }>
const ACS = censusAcs as Record<string, { medianIncome: number; medianRent: number | null; year: number }>
const DONORS = poBoxAcs.byZip as Record<string, string>

describe('PO-box zip ACS fallback', () => {
  beforeEach(() => clearMemCache())

  test.each([
    ['98687', 'Vancouver WA PO boxes'],
    ['20500', 'White House unique zip'],
  ])('%s (%s) borrows a residential zip in the same county', (zip) => {
    expect(ZIPS[zip].zcta).toBe(false)
    expect(ACS[zip]).toBeUndefined()
    const d = getCensusData(zip)
    expect(d.isFallback).toBe(false)
    expect(d.approxFromZip).toMatch(/^\d{5}$/)
    const donor = d.approxFromZip!
    expect(ZIPS[donor].zcta).toBeUndefined()
    expect(ZIPS[donor].countyFips).toBe(ZIPS[zip].countyFips)
    expect(d.medianIncome).toBe(ACS[donor].medianIncome)
    expect(d.zip).toBe(zip)
  })

  test('98687 donor is a Vancouver zip (same city name)', () => {
    expect(ZIPS[DONORS['98687']].cityName).toBe('Vancouver')
  })

  test('residential zips never get a donor', () => {
    expect(getCensusData('98683').approxFromZip).toBeUndefined()
    expect(DONORS['98683']).toBeUndefined()
  })

  test('every donor is a ZCTA with ACS income in the same county', () => {
    for (const [po, donor] of Object.entries(DONORS)) {
      expect(ZIPS[po].zcta).toBe(false)
      expect(ACS[donor].medianIncome).toBeGreaterThan(0)
      expect(ZIPS[donor].countyFips).toBe(ZIPS[po].countyFips)
    }
  })

  test('tariff + shelter cards label the borrowed zip', async () => {
    const s = await fetchSnapshot('98687')
    expect(s).not.toBeNull()
    const c = s!.census.data! as NonNullable<typeof s>["census"]["data"] & { donorZip?: string }
    const donor = (c.donorZip ?? c!.approxFromZip)!
    const tariff = buildTariffCard(s!)
    expect(tariff.status).toBe('ok')
    // "nearest" was false for many donors; the label says how the donor was chosen
    expect(tariff.provenance.asOf).toMatch(
      new RegExp(`^income: Census ACS \\d{4}, borrowed from zip ${donor} \\(largest residential zip in the (city|county|area)\\)$`))
    expect(tariff.provenance.geography).toContain('estimate')
    const shelter = buildShelterCard(s!)
    if (shelter.status === 'ok' && shelter.detail?.startsWith('Base:')) {
      expect(shelter.detail).toContain(`borrowed from zip ${donor} (largest residential zip in the`)
    }
  })
})
