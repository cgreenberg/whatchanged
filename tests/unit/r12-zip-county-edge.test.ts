/**
 * build-zip-county.ts mail-only city rule (round 12): a mail-only zip is moved to its city's county only when its own
 * evidence doesn't say otherwise — a ZCTA whose USPS record (GeoNames) agrees with its own county stays, and so does
 * a zip whose town genuinely extends into the assigned county (≥ 10% of the town's housing units).
 */
import { lookupZip } from '@/lib/data/zip-lookup'

test.each([
  ['21240', '24003', 'BWI airport ZCTA ("Baltimore" mail) lies in Anne Arundel County, not Baltimore city'],
  ['25888', '54019', 'Mount Hope WV PO boxes: the town is in Fayette County'],
  ['99519', '02020', 'Anchorage mail zip whose ZCTA is Prudhoe Bay oilfield land still goes to Anchorage'],
  ['20500', '11001', 'White House unique zip → DC'],
])('%s → county %s (%s)', (zip, county) => {
  expect(lookupZip(zip)?.countyFips).toBe(county)
})
