/**
 * build-zip-county.ts mail-only city rule (round 12): a mail-only zip is moved to its city's county only when its own
 * evidence doesn't say otherwise — a ZCTA whose USPS record (GeoNames) agrees with its own county stays, and so does
 * a zip whose town genuinely extends into the assigned county (≥ 10% of the town's housing units).
 * Round 13: a USPS-only zip takes the county holding the majority of its named Census place's population.
 * Round 14: only for places under 50,000 people; a big city's stations keep GeoNames' (USPS) county.
 */
import { lookupZip } from '@/lib/data/zip-lookup'

test.each([
  ['21240', '24003', 'BWI airport ZCTA ("Baltimore" mail) lies in Anne Arundel County, not Baltimore city'],
  ['25888', '54019', 'Mount Hope WV PO boxes: the town is in Fayette County'],
  ['99519', '02020', 'Anchorage mail zip whose ZCTA is Prudhoe Bay oilfield land still goes to Anchorage'],
  ['20500', '11001', 'White House unique zip → DC'],
  // Round 13: USPS-only zips take the county holding the majority of their named place's population
  ['86339', '04025', 'Sedona AZ PO boxes: Sedona city is 74% Yavapai (GeoNames files them under Coconino)'],
  ['76098', '48439', 'Azle TX PO boxes: Azle city is mostly in Tarrant County'],
  // Round 14: big places (>= 50,000 people) keep GeoNames' county — it comes from the USPS record
  ['30333', '13089', 'CDC ("Atlanta" mail) is in DeKalb County, not Fulton'],
  ['39901', '13089', 'IRS Chamblee ("Atlanta" mail) is in DeKalb County'],
  ['64195', '29165', 'Kansas City International airport zip is in Platte County, not Jackson'],
  ['64144', '29047', 'Kansas City Northland station zip stays in Clay County'],
  ['97291', '41067', 'Portland station zip filed under Washington County stays there, not Multnomah'],
  ['97268', '41005', 'Portland station zip filed under Clackamas County stays there'],
  ['80163', '08035', 'Littleton CO station zip filed under Douglas County stays there, not Arapahoe'],
  ['80162', '08059', 'Littleton CO station zip filed under Jefferson County stays there'],
  ['10008', '36061', 'New York PO boxes stay in New York County: no county holds a majority of NYC'],
])('%s → county %s (%s)', (zip, county) => {
  expect(lookupZip(zip)?.countyFips).toBe(county)
})
