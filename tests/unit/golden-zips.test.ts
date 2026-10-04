/**
 * Golden zips: hand-checked expectations for tricky zips, end to end
 * (zip → county → CPI area → EIA gas series → LAUS area).
 *
 * Expected values come from the authoritative sources, NOT from running the code:
 *  - county: where most of the zip's residents live (USPS/Census)
 *  - CPI: BLS 2018 CPI area design (metro = county in the OMB 2013 CBSA BLS samples,
 *    otherwise the state's Census division; territories → U.S. city average)
 *  - gas (most local first): EIA weekly city series where EIA publishes one for that
 *    metro; else BLS monthly average price (APU{area}74714) for the CPI metro ("BLS:S12B");
 *    (incl. Honolulu S49F, Anchorage S49G); rest of HI/AK → the Honolulu / Anchorage series
 *    as a labeled stand-in; else one of EIA's 9 state series; else the PADD / sub-PADD
 *    (non-CA PADD 5 → R5XCA). No BLS Census-division gas tier (Midwest keeps R20).
 *  - LAUS: county FIPS, except CT → 2022 planning region containing the zip
 */

import { lookupZip } from '@/lib/data/zip-lookup'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import { getGasLookup } from '@/lib/api/eia'
import { getLausAreaFipsForZip } from '@/lib/mappings/laus-area'

const NE = 'New England (PADD 1A) avg'
const ROCKY = 'Rocky Mountain (PADD 4) avg'
const W5XCA = 'West Coast excl. California (PADD 5) avg'
const MW = 'Midwest (PADD 2) avg'
const HNL = 'Honolulu metro avg'
const ANC = 'Anchorage metro avg'
const HNL_AREA = 'Honolulu-area price (BLS)'
const ANC_AREA = 'Anchorage-area price (BLS)'

// [zip, county FIPS, CPI area, CPI tier, gas (EIA duoarea or "BLS:{area}"), gas tier, gas label, LAUS FIPS, note]
type Golden = [string, string, string, number, string, number, string, string, string]

const GOLDEN: Golden[] = [
  ['98683', '53011', '0490', 2, 'SWA', 2, 'Washington state avg', '53011', 'Vancouver WA — Portland is not a CPI metro'],
  ['98671', '53011', '0490', 2, 'SWA', 2, 'Washington state avg', '53011', 'Washougal — Clark, not Skamania (most residents)'],
  ['10001', '36061', 'S12A', 1, 'Y35NY', 1, 'New York City area avg', '36061', 'Manhattan'],
  ['10301', '36085', 'S12A', 1, 'Y35NY', 1, 'New York City area avg', '36085', 'Staten Island = Richmond County'],
  ['11201', '36047', 'S12A', 1, 'Y35NY', 1, 'New York City area avg', '36047', 'Brooklyn = Kings County'],
  ['12550', '36071', 'S12A', 1, 'Y35NY', 1, 'New York City area avg', '36071', 'Newburgh — Orange County is in the 2013 NY CBSA'],
  ['18337', '42103', 'S12A', 1, 'Y35NY', 1, 'New York City area avg', '42103', 'Milford PA — Pike County is in the 2013 NY CBSA'],
  ['60601', '17031', 'S23A', 1, 'YORD', 1, 'Chicago area avg', '17031', 'Chicago Loop'],
  ['53140', '55059', 'S23A', 1, 'YORD', 1, 'Chicago area avg', '55059', 'Kenosha WI — in the 2013 Chicago CBSA'],
  ['44113', '39035', '0230', 2, 'YCLE', 1, 'Cleveland area avg', '39035', 'Cleveland — EIA city series, no CPI metro'],
  ['78701', '48453', '0370', 2, 'STX', 2, 'Texas state avg', '48453', 'Austin — not a CPI metro'],
  ['90210', '06037', 'S49A', 1, 'Y05LA', 1, 'Los Angeles area avg', '06037', 'Beverly Hills'],
  ['94952', '06097', '0490', 2, 'SCA', 2, 'California state avg', '06097', 'Petaluma — Sonoma (Santa Rosa CBSA), not Marin/SF'],
  ['04101', '23005', '0110', 2, 'R1X', 3, NE, '23005', 'Portland ME — not Boston metro'],
  ['02138', '25017', 'S11A', 1, 'YBOS', 1, 'Boston area avg', '25017', 'Cambridge MA — leading-zero zip'],
  ['06902', '09001', '0110', 2, 'R1X', 3, NE, '09190', 'Stamford — Western CT planning region'],
  ['06708', '09009', '0110', 2, 'R1X', 3, NE, '09140', 'Waterbury — Naugatuck Valley planning region'],
  ['06066', '09013', '0110', 2, 'R1X', 3, NE, '09110', 'Vernon (Tolland Co.) — Capitol planning region'],
  ['30097', '13135', 'S35C', 1, 'BLS:S35C', 1, 'Atlanta-Sandy Springs-Roswell metro avg', '13135', 'Duluth GA — Gwinnett, not Fulton; Atlanta has no EIA city series → BLS metro'],
  ['20001', '11001', 'S35A', 1, 'BLS:S35A', 1, 'Washington-Arlington-Alexandria metro avg', '11001', 'Washington DC'],
  ['20500', '11001', 'S35A', 1, 'BLS:S35A', 1, 'Washington-Arlington-Alexandria metro avg', '11001', 'White House — USPS-only zip (no ZCTA)'],
  ['22301', '51510', 'S35A', 1, 'BLS:S35A', 1, 'Washington-Arlington-Alexandria metro avg', '51510', 'Alexandria VA — independent city'],
  ['83702', '16001', '0480', 2, 'R40', 3, ROCKY, '16001', 'Boise — Rocky Mountain PADD, not Seattle'],
  ['85004', '04013', 'S48A', 1, 'BLS:S48A', 1, 'Phoenix-Mesa-Scottsdale metro avg', '04013', 'Phoenix — no EIA city series → BLS metro'],
  ['97201', '41051', '0490', 2, 'R5XCA', 3, W5XCA, '41051', 'Portland OR'],
  ['96813', '15003', 'S49F', 1, 'BLS:S49F', 1, HNL, '15003', 'Honolulu — BLS S49F = Urban Honolulu CBSA (EIA has no HI series)'],
  ['96720', '15001', '0490', 2, 'BLS:S49F', 2, HNL_AREA, '15001', 'Hilo — outside the Honolulu CBSA: labeled stand-in'],
  ['99501', '02020', 'S49G', 1, 'BLS:S49G', 1, ANC, '02020', 'Anchorage — BLS S49G = Anchorage CBSA (EIA has no AK series)'],
  ['99701', '02090', '0490', 2, 'BLS:S49G', 2, ANC_AREA, '02090', 'Fairbanks — outside the Anchorage CBSA: labeled stand-in'],
  ['99686', '02063', '0490', 2, 'BLS:S49G', 2, ANC_AREA, '02063', 'Valdez — Chugach Census Area (2019 split of Valdez-Cordova)'],
  ['19103', '42101', 'S12B', 1, 'BLS:S12B', 1, 'Philadelphia-Camden-Wilmington metro avg', '42101', 'Philadelphia — no EIA city series → BLS metro'],
  ['30303', '13121', 'S35C', 1, 'BLS:S35C', 1, 'Atlanta-Sandy Springs-Roswell metro avg', '13121', 'Atlanta'],
  ['55401', '27053', 'S24A', 1, 'BLS:S24A', 1, 'Minneapolis-St. Paul-Bloomington metro avg', '27053', 'Minneapolis — BLS metro beats EIA Minnesota state'],
  ['53202', '55079', '0230', 2, 'R20', 3, MW, '55079', 'Milwaukee WI — no BLS division gas tier: EIA PADD 2'],
  ['50309', '19153', '0240', 2, 'R20', 3, MW, '19153', 'Des Moines IA — EIA PADD 2'],
  ['46204', '18097', '0230', 2, 'R20', 3, MW, '18097', 'Indianapolis IN — EIA PADD 2'],
  ['37203', '47037', '0360', 2, 'R20', 3, MW, '47037', 'Nashville TN — East South Central is mostly PADD 3 → keeps R20'],
  ['73102', '40109', '0370', 2, 'R20', 3, MW, '40109', 'Oklahoma City — West South Central is mostly PADD 3 → keeps R20'],
  ['00601', '72001', '0000', 4, 'NUS', 3, 'National avg', '72001', 'Adjuntas PR — national fallbacks'],
]

describe('golden zips', () => {
  test.each(GOLDEN)(
    '%s → county %s, CPI %s (t%s), gas %s (t%s)',
    (zip, county, cpiArea, cpiTier, duoarea, gasTier, gasLabel, lausFips) => {
      const info = lookupZip(zip)
      expect(info).not.toBeNull()
      expect(info!.countyFips).toBe(county)

      const cpi = getMetroCpiAreaForCounty(info!.countyFips, info!.stateAbbr)
      expect(cpi.areaCode).toBe(cpiArea)
      expect(cpi.tier).toBe(cpiTier)

      const gas = getGasLookup(info!.stateAbbr, cpi.areaCode, info!.countyFips)
      expect(gas.source === 'bls' ? `BLS:${gas.areaCode}` : gas.duoarea).toBe(duoarea)
      expect(gas.tier).toBe(gasTier)
      expect(gas.geoLevel).toBe(gasLabel)

      expect(getLausAreaFipsForZip(zip)).toBe(lausFips)
    }
  )

  test('more CT zips resolve to the planning region containing them', () => {
    expect(getLausAreaFipsForZip('06830')).toBe('09190') // Greenwich
    expect(getLausAreaFipsForZip('06810')).toBe('09190') // Danbury
    expect(getLausAreaFipsForZip('06770')).toBe('09140') // Naugatuck
    expect(getLausAreaFipsForZip('06268')).toBe('09110') // Storrs (Mansfield, Tolland Co.)
    expect(getLausAreaFipsForZip('06604')).toBe('09120') // Bridgeport
  })

  test('invalid zip resolves to nothing', () => {
    expect(lookupZip('99999')).toBeNull()
    expect(getLausAreaFipsForZip('99999')).toBeNull()
  })
})
