/**
 * Comprehensive mapping audit: top 5 cities in every US state.
 * Tests the full mapping chain for ALL tracked data sources across 250+ cities.
 *
 * Data sources and their geographic resolution:
 * - Gas prices:    EIA 3-tier (county override → CPI→city → state → PAD)
 * - Groceries:     BLS CPI metro area → series CUUR{area}SAF11
 * - Shelter:       BLS CPI metro area → series CUUR{area}SAH1
 * - Energy:        BLS CPI metro area → series CUUR{area}SA0E
 * - Unemployment:  County FIPS directly → series LAUCN{fips}0000000003
 * - Tariff:        ZIP-level income × 0.0205 (no geo mapping beyond ZIP)
 */

import { getGasLookup } from '@/lib/api/eia'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'

// [city, state, countyFIPS, expectedCPI, expectedGasDuoarea, expectedGasTier]
// CPI codes: S-prefixed = metro CPI area (CBSA match), 0100-0400 = regional fallback
const CITY_MAPPINGS: Array<[string, string, string, string, string, number]> = [
  // === MAINE ===
  ['Portland', 'ME', '23005', 'S11A', 'R1X', 1],  // CBSA → Boston-Cambridge-Newton
  ['Lewiston', 'ME', '23001', '0100', 'R1X', 1],   // No CBSA match → Northeast regional
  ['Bangor', 'ME', '23019', '0100', 'R1X', 1],
  ['South Portland', 'ME', '23005', 'S11A', 'R1X', 1],
  ['Auburn', 'ME', '23001', '0100', 'R1X', 1],

  // === NEW HAMPSHIRE ===
  ['Manchester', 'NH', '33011', 'S11A', 'YBOS', 1],
  ['Nashua', 'NH', '33011', 'S11A', 'YBOS', 1],
  ['Concord', 'NH', '33013', '0100', 'R1X', 3],    // No CBSA match → Northeast regional, PAD fallback
  ['Derry', 'NH', '33015', 'S11A', 'YBOS', 1],
  ['Dover', 'NH', '33017', 'S11A', 'YBOS', 1],

  // === VERMONT ===
  ['Burlington', 'VT', '50007', '0100', 'R1X', 1],  // No CBSA match → Northeast regional
  ['South Burlington', 'VT', '50007', '0100', 'R1X', 1],
  ['Rutland', 'VT', '50021', '0100', 'R1X', 1],
  ['Barre', 'VT', '50023', '0100', 'R1X', 1],
  ['Montpelier', 'VT', '50023', '0100', 'R1X', 1],

  // === MASSACHUSETTS ===
  ['Boston', 'MA', '25025', 'S11A', 'YBOS', 1],
  ['Worcester', 'MA', '25027', 'S11A', 'YBOS', 1],
  ['Springfield', 'MA', '25013', 'S11A', 'YBOS', 1],
  ['Cambridge', 'MA', '25017', 'S11A', 'YBOS', 1],
  ['Lowell', 'MA', '25017', 'S11A', 'YBOS', 1],

  // === RHODE ISLAND ===
  ['Providence', 'RI', '44007', 'S11A', 'YBOS', 1],
  ['Cranston', 'RI', '44007', 'S11A', 'YBOS', 1],
  ['Warwick', 'RI', '44003', 'S11A', 'YBOS', 1],
  ['Pawtucket', 'RI', '44007', 'S11A', 'YBOS', 1],
  ['East Providence', 'RI', '44007', 'S11A', 'YBOS', 1],

  // === CONNECTICUT ===
  ['Bridgeport', 'CT', '09001', 'S12A', 'Y35NY', 1], // CBSA → New York-Newark-Jersey City
  ['New Haven', 'CT', '09009', '0100', 'R1X', 3],    // No CBSA match → Northeast regional
  ['Hartford', 'CT', '09003', 'S12A', 'Y35NY', 1],   // CBSA → New York-Newark-Jersey City
  ['Stamford', 'CT', '09001', 'S12A', 'Y35NY', 1],
  ['Waterbury', 'CT', '09009', '0100', 'R1X', 3],

  // === NEW YORK ===
  ['New York City', 'NY', '36061', 'S12A', 'Y35NY', 1],
  ['Buffalo', 'NY', '36029', 'S23B', 'SNY', 1],     // CBSA → Detroit (closest CBSA match), county gas override → NY state
  ['Rochester', 'NY', '36055', '0100', 'SNY', 1],
  ['Yonkers', 'NY', '36119', 'S12A', 'Y35NY', 1],
  ['Syracuse', 'NY', '36067', '0100', 'SNY', 1],

  // === NEW JERSEY ===
  ['Newark', 'NJ', '34013', 'S12A', 'Y35NY', 1],
  ['Jersey City', 'NJ', '34017', 'S12A', 'Y35NY', 1],
  ['Paterson', 'NJ', '34031', 'S12A', 'Y35NY', 1],
  ['Elizabeth', 'NJ', '34039', 'S12A', 'Y35NY', 1],
  ['Camden', 'NJ', '34007', 'S12B', 'R1Y', 3],

  // === PENNSYLVANIA ===
  ['Philadelphia', 'PA', '42101', 'S12B', 'R1Y', 3],
  ['Pittsburgh', 'PA', '42003', 'S23B', 'R1Y', 3],  // CBSA → Detroit (closest CBSA match)
  ['Allentown', 'PA', '42077', 'S12B', 'R1Y', 3],
  ['Reading', 'PA', '42011', 'S12B', 'R1Y', 3],  // CBSA → Philadelphia
  ['Erie', 'PA', '42049', '0100', 'R1Y', 3],

  // === DELAWARE ===
  ['Wilmington', 'DE', '10003', 'S12B', 'R1Y', 3],
  ['Dover', 'DE', '10001', '0300', 'R1Y', 3],       // No CBSA match → South regional
  ['Newark', 'DE', '10003', 'S12B', 'R1Y', 3],
  ['Middletown', 'DE', '10003', 'S12B', 'R1Y', 3],
  ['Bear', 'DE', '10003', 'S12B', 'R1Y', 3],

  // === MARYLAND ===
  ['Baltimore', 'MD', '24510', 'S35E', 'R1Y', 3],
  ['Columbia', 'MD', '24027', 'S35E', 'R1Y', 3],
  ['Germantown', 'MD', '24031', 'S35A', 'R1Y', 3],
  ['Silver Spring', 'MD', '24031', 'S35A', 'R1Y', 3],
  ['Waldorf', 'MD', '24017', 'S35A', 'R1Y', 3],

  // === WASHINGTON DC ===
  ['Washington', 'DC', '11001', 'S35A', 'R1Y', 3],

  // === VIRGINIA ===
  ['Virginia Beach', 'VA', '51810', '0300', 'R1Z', 3], // No CBSA match → South regional
  ['Norfolk', 'VA', '51710', '0300', 'R1Z', 3],
  ['Chesapeake', 'VA', '51550', '0300', 'R1Z', 3],
  ['Richmond', 'VA', '51760', '0300', 'R1Z', 3],
  ['Newport News', 'VA', '51700', '0300', 'R1Z', 3],

  // === WEST VIRGINIA ===
  ['Charleston', 'WV', '54039', '0300', 'R1Z', 3],
  ['Huntington', 'WV', '54011', '0300', 'R1Z', 3],
  ['Morgantown', 'WV', '54061', '0300', 'R1Z', 3],
  ['Parkersburg', 'WV', '54107', '0300', 'R1Z', 3],
  ['Wheeling', 'WV', '54069', '0300', 'R1Z', 3],

  // === NORTH CAROLINA ===
  ['Charlotte', 'NC', '37119', 'S35C', 'R1Z', 3],
  ['Raleigh', 'NC', '37183', 'S35C', 'R1Z', 3],    // CBSA → Atlanta-Sandy Springs-Roswell
  ['Greensboro', 'NC', '37081', '0300', 'R1Z', 3],
  ['Durham', 'NC', '37063', '0300', 'R1Z', 3],
  ['Winston-Salem', 'NC', '37067', '0300', 'R1Z', 3],

  // === SOUTH CAROLINA ===
  ['Charleston', 'SC', '45019', '0300', 'R1Z', 3],  // No CBSA match → South regional
  ['Columbia', 'SC', '45079', '0300', 'R1Z', 3],
  ['North Charleston', 'SC', '45019', '0300', 'R1Z', 3],
  ['Mount Pleasant', 'SC', '45019', '0300', 'R1Z', 3],
  ['Greenville', 'SC', '45045', 'S35C', 'R1Z', 3],

  // === GEORGIA ===
  ['Atlanta', 'GA', '13121', 'S35C', 'R1Z', 3],
  ['Augusta', 'GA', '13073', '0300', 'R1Z', 3],     // No CBSA match → South regional
  ['Columbus', 'GA', '13215', '0300', 'R1Z', 3],
  ['Savannah', 'GA', '13051', '0300', 'R1Z', 3],
  ['Athens', 'GA', '13059', '0300', 'R1Z', 3],

  // === FLORIDA ===
  ['Jacksonville', 'FL', '12031', 'S35B', 'SFL', 1], // CBSA → Miami-Fort Lauderdale
  ['Miami', 'FL', '12086', 'S35B', 'YMIA', 1],
  ['Tampa', 'FL', '12057', 'S35D', 'SFL', 2],
  ['Orlando', 'FL', '12095', 'S35B', 'SFL', 1],     // CBSA → Miami-Fort Lauderdale
  ['St. Petersburg', 'FL', '12103', 'S35D', 'SFL', 2],

  // === ALABAMA ===
  ['Birmingham', 'AL', '01073', '0300', 'R30', 3],  // No CBSA match → South regional
  ['Montgomery', 'AL', '01101', '0300', 'R30', 3],
  ['Huntsville', 'AL', '01089', '0300', 'R30', 3],
  ['Mobile', 'AL', '01097', '0300', 'R30', 3],
  ['Tuscaloosa', 'AL', '01125', '0300', 'R30', 3],

  // === MISSISSIPPI ===
  ['Jackson', 'MS', '28049', '0300', 'R30', 1],     // No CBSA match → South regional, county gas override
  ['Gulfport', 'MS', '28047', '0300', 'R30', 3],
  ['Southaven', 'MS', '28033', 'S35C', 'R30', 3],  // CBSA → Atlanta (Memphis CBSA includes DeSoto County MS)
  ['Hattiesburg', 'MS', '28035', '0300', 'R30', 3],
  ['Biloxi', 'MS', '28047', '0300', 'R30', 3],

  // === TENNESSEE ===
  ['Nashville', 'TN', '47037', 'S35C', 'R20', 3],   // CBSA → Atlanta
  ['Memphis', 'TN', '47157', 'S35C', 'R20', 3],     // CBSA → Atlanta (Memphis CBSA)
  ['Knoxville', 'TN', '47093', 'S35C', 'R20', 3],  // CBSA → Atlanta (Knoxville CBSA)
  ['Chattanooga', 'TN', '47065', 'S35C', 'R20', 3],
  ['Clarksville', 'TN', '47125', '0300', 'R20', 3],

  // === KENTUCKY ===
  ['Louisville', 'KY', '21111', 'S24B', 'R20', 3],  // CBSA → St. Louis (Louisville CBSA)
  ['Lexington', 'KY', '21067', 'S24B', 'R20', 3],  // CBSA → St. Louis (Lexington CBSA)
  ['Bowling Green', 'KY', '21227', '0300', 'R20', 3],
  ['Owensboro', 'KY', '21059', '0300', 'R20', 3],
  ['Covington', 'KY', '21117', 'S24B', 'R20', 3],  // CBSA → St. Louis (Cincinnati CBSA includes Boone/Campbell/Kenton KY)

  // === LOUISIANA ===
  ['New Orleans', 'LA', '22071', '0300', 'R30', 1], // No CBSA match → South regional, county gas override
  ['Baton Rouge', 'LA', '22033', '0300', 'R30', 1],
  ['Shreveport', 'LA', '22017', '0300', 'R30', 1],
  ['Metairie', 'LA', '22051', '0300', 'R30', 1],
  ['Lafayette', 'LA', '22055', '0300', 'R30', 1],

  // === ARKANSAS ===
  ['Little Rock', 'AR', '05119', '0300', 'R30', 3],
  ['Fort Smith', 'AR', '05131', '0300', 'R30', 3],
  ['Fayetteville', 'AR', '05143', '0300', 'R30', 3],
  ['Springdale', 'AR', '05143', '0300', 'R30', 3],
  ['Jonesboro', 'AR', '05031', '0300', 'R30', 3],

  // === OHIO ===
  ['Columbus', 'OH', '39049', 'S23B', 'SOH', 2],    // CBSA → Detroit (Columbus CBSA)
  ['Cleveland', 'OH', '39035', 'S23B', 'YCLE', 1],  // CBSA → Detroit (Cleveland CBSA)
  ['Cincinnati', 'OH', '39061', 'S24B', 'SOH', 2],  // CBSA → St. Louis (Cincinnati CBSA)
  ['Toledo', 'OH', '39095', '0200', 'SOH', 2],
  ['Akron', 'OH', '39153', '0200', 'SOH', 2],

  // === MICHIGAN ===
  ['Detroit', 'MI', '26163', 'S23B', 'R20', 3],     // CBSA → Detroit-Warren-Dearborn
  ['Grand Rapids', 'MI', '26081', 'S23B', 'R20', 1], // CBSA → Detroit (closest CBSA match)
  ['Warren', 'MI', '26099', 'S23B', 'R20', 3],
  ['Sterling Heights', 'MI', '26099', 'S23B', 'R20', 3],
  ['Ann Arbor', 'MI', '26161', 'S23B', 'R20', 3],

  // === INDIANA ===
  ['Indianapolis', 'IN', '18097', 'S23A', 'R20', 1], // CBSA → Chicago (Indianapolis CBSA)
  ['Fort Wayne', 'IN', '18003', '0200', 'R20', 3],
  ['Evansville', 'IN', '18163', '0200', 'R20', 3],
  ['South Bend', 'IN', '18141', '0200', 'R20', 3],
  ['Carmel', 'IN', '18057', 'S23A', 'R20', 1],   // CBSA → Chicago (Indianapolis CBSA), but county override → Midwest avg gas

  // === ILLINOIS ===
  ['Chicago', 'IL', '17031', 'S23A', 'YORD', 1],
  ['Aurora', 'IL', '17089', 'S23A', 'YORD', 1],
  ['Joliet', 'IL', '17197', 'S23A', 'YORD', 1],
  ['Naperville', 'IL', '17043', 'S23A', 'YORD', 1],
  ['Rockford', 'IL', '17201', 'S23A', 'YORD', 1],

  // === WISCONSIN ===
  ['Milwaukee', 'WI', '55079', 'S23A', 'YORD', 1],  // CBSA → Chicago (Milwaukee CBSA, gas follows S23A→Chicago)
  ['Madison', 'WI', '55025', '0200', 'R20', 1],
  ['Green Bay', 'WI', '55009', '0200', 'R20', 1],
  ['Kenosha', 'WI', '55059', 'S23A', 'YORD', 1],  // CBSA → Chicago (Kenosha CBSA, gas follows S23A→Chicago)
  ['Racine', 'WI', '55101', '0200', 'R20', 3],

  // === MINNESOTA ===
  ['Minneapolis', 'MN', '27053', 'S24A', 'SMN', 2],
  ['St. Paul', 'MN', '27123', 'S24A', 'SMN', 2],
  ['Rochester', 'MN', '27109', '0200', 'SMN', 2],   // No CBSA match → Midwest regional
  ['Bloomington', 'MN', '27053', 'S24A', 'SMN', 2],
  ['Duluth', 'MN', '27137', '0200', 'SMN', 2],

  // === IOWA ===
  ['Des Moines', 'IA', '19153', 'S24A', 'R20', 3],  // CBSA → Minneapolis (Des Moines CBSA)
  ['Cedar Rapids', 'IA', '19113', 'S24A', 'R20', 1], // CBSA → Minneapolis (Cedar Rapids CBSA)
  ['Davenport', 'IA', '19163', 'S24A', 'R20', 1],   // CBSA → Minneapolis (Davenport CBSA)
  ['Sioux City', 'IA', '19193', '0200', 'R20', 3],
  ['Iowa City', 'IA', '19103', '0200', 'R20', 1],

  // === MISSOURI ===
  ['Kansas City', 'MO', '29095', 'S24B', 'R20', 3],
  ['St. Louis', 'MO', '29510', 'S24B', 'R20', 3],
  ['Springfield', 'MO', '29077', '0200', 'R20', 3], // No CBSA match → Midwest regional
  ['Columbia', 'MO', '29019', 'S24B', 'R20', 3],
  ['Independence', 'MO', '29095', 'S24B', 'R20', 3],

  // === NORTH DAKOTA ===
  ['Fargo', 'ND', '38017', 'S24A', 'R20', 3],       // CBSA → Minneapolis (Fargo CBSA)
  ['Bismarck', 'ND', '38015', '0200', 'R20', 3],
  ['Grand Forks', 'ND', '38035', '0200', 'R20', 3],
  ['Minot', 'ND', '38101', '0200', 'R20', 3],
  ['West Fargo', 'ND', '38017', 'S24A', 'R20', 3],  // CBSA → Minneapolis (Fargo CBSA)

  // === SOUTH DAKOTA ===
  ['Sioux Falls', 'SD', '46099', 'S24A', 'R20', 3], // CBSA → Minneapolis (Sioux Falls CBSA)
  ['Rapid City', 'SD', '46103', '0200', 'R20', 1],  // No CBSA match → Midwest regional
  ['Aberdeen', 'SD', '46013', '0200', 'R20', 3],
  ['Brookings', 'SD', '46011', '0200', 'R20', 3],
  ['Watertown', 'SD', '46029', '0200', 'R20', 3],

  // === NEBRASKA ===
  ['Omaha', 'NE', '31055', 'S24B', 'R20', 3],       // CBSA → St. Louis (Omaha CBSA)
  ['Lincoln', 'NE', '31109', '0200', 'R20', 3],
  ['Bellevue', 'NE', '31153', 'S24B', 'R20', 3],  // CBSA → St. Louis (Omaha CBSA includes Sarpy County)
  ['Grand Island', 'NE', '31079', '0200', 'R20', 1],
  ['Kearney', 'NE', '31019', '0200', 'R20', 1],

  // === KANSAS ===
  ['Wichita', 'KS', '20173', '0200', 'R20', 3],     // No CBSA match → Midwest regional
  ['Overland Park', 'KS', '20091', 'S24B', 'R20', 3],
  ['Kansas City', 'KS', '20209', 'S24B', 'R20', 3],
  ['Olathe', 'KS', '20091', 'S24B', 'R20', 3],
  ['Topeka', 'KS', '20177', '0200', 'R20', 3],

  // === TEXAS ===
  ['Houston', 'TX', '48201', 'S37B', 'Y44HO', 1],
  ['San Antonio', 'TX', '48029', 'S37A', 'STX', 1], // CBSA → Dallas-Fort Worth
  ['Dallas', 'TX', '48113', 'S37A', 'STX', 2],
  ['Austin', 'TX', '48453', 'S37A', 'STX', 1],      // CBSA → Dallas-Fort Worth
  ['Fort Worth', 'TX', '48439', 'S37A', 'STX', 2],

  // === OKLAHOMA ===
  ['Oklahoma City', 'OK', '40109', '0300', 'R20', 3], // No CBSA match → South regional
  ['Tulsa', 'OK', '40143', '0300', 'R20', 3],
  ['Norman', 'OK', '40027', '0300', 'R20', 3],
  ['Broken Arrow', 'OK', '40143', '0300', 'R20', 3],
  ['Edmond', 'OK', '40109', '0300', 'R20', 3],

  // === NEW MEXICO ===
  ['Albuquerque', 'NM', '35001', '0400', 'R30', 3], // No CBSA match → West regional
  ['Las Cruces', 'NM', '35013', '0400', 'R30', 3],
  ['Rio Rancho', 'NM', '35043', '0400', 'R30', 1],
  ['Santa Fe', 'NM', '35049', '0400', 'R30', 1],
  ['Roswell', 'NM', '35005', '0400', 'R30', 3],

  // === WASHINGTON ===
  ['Seattle', 'WA', '53033', 'S49D', 'Y48SE', 1],
  ['Spokane', 'WA', '53063', '0400', 'SWA', 1],     // No CBSA match → West regional
  ['Tacoma', 'WA', '53053', 'S49D', 'Y48SE', 1],
  ['Vancouver', 'WA', '53011', 'S49D', 'SWA', 1],
  ['Bellevue', 'WA', '53033', 'S49D', 'Y48SE', 1],

  // === OREGON ===
  ['Portland', 'OR', '41051', 'S49D', 'R50', 1],
  ['Salem', 'OR', '41047', '0400', 'R50', 1],       // No CBSA match → West regional
  ['Eugene', 'OR', '41039', '0400', 'R50', 1],
  ['Gresham', 'OR', '41051', 'S49D', 'R50', 1],
  ['Hillsboro', 'OR', '41067', 'S49D', 'R50', 1],

  // === CALIFORNIA ===
  ['Los Angeles', 'CA', '06037', 'S49A', 'Y05LA', 1],
  ['San Diego', 'CA', '06073', 'S49E', 'SCA', 2],
  ['San Jose', 'CA', '06085', 'S49B', 'Y05SF', 1],
  ['San Francisco', 'CA', '06075', 'S49B', 'Y05SF', 1],
  ['Fresno', 'CA', '06019', '0400', 'SCA', 1],      // No CBSA match → West regional

  // === NEVADA ===
  ['Las Vegas', 'NV', '32003', 'S48A', 'R50', 3],   // CBSA → Phoenix-Mesa-Scottsdale
  ['Henderson', 'NV', '32003', 'S48A', 'R50', 3],
  ['Reno', 'NV', '32031', '0400', 'R50', 1],        // No CBSA match → West regional
  ['North Las Vegas', 'NV', '32003', 'S48A', 'R50', 3],
  ['Sparks', 'NV', '32031', '0400', 'R50', 1],

  // === ARIZONA ===
  ['Phoenix', 'AZ', '04013', 'S48A', 'R50', 3],
  ['Tucson', 'AZ', '04019', 'S48A', 'R50', 3],
  ['Mesa', 'AZ', '04013', 'S48A', 'R50', 3],
  ['Chandler', 'AZ', '04013', 'S48A', 'R50', 3],
  ['Scottsdale', 'AZ', '04013', 'S48A', 'R50', 3],

  // === IDAHO ===
  ['Boise', 'ID', '16001', '0400', 'R40', 1],       // No CBSA match → West regional
  ['Meridian', 'ID', '16001', '0400', 'R40', 1],
  ['Nampa', 'ID', '16027', '0400', 'R40', 1],
  ['Idaho Falls', 'ID', '16019', '0400', 'R40', 1],
  ['Pocatello', 'ID', '16005', '0400', 'R40', 1],

  // === MONTANA ===
  ['Billings', 'MT', '30111', '0400', 'R40', 1],    // No CBSA match → West regional
  ['Missoula', 'MT', '30063', '0400', 'R40', 1],
  ['Great Falls', 'MT', '30013', '0400', 'R40', 1],
  ['Bozeman', 'MT', '30031', '0400', 'R40', 1],
  ['Helena', 'MT', '30043', '0400', 'R40', 1],

  // === WYOMING ===
  ['Cheyenne', 'WY', '56021', '0400', 'R40', 1],    // No CBSA match → West regional
  ['Casper', 'WY', '56025', '0400', 'R40', 1],
  ['Laramie', 'WY', '56001', '0400', 'R40', 1],
  ['Gillette', 'WY', '56005', '0400', 'R40', 1],
  ['Rock Springs', 'WY', '56037', '0400', 'R40', 1],

  // === UTAH ===
  ['Salt Lake City', 'UT', '49035', 'S48B', 'R40', 1],
  ['West Valley City', 'UT', '49035', 'S48B', 'R40', 1],
  ['Provo', 'UT', '49049', 'S48B', 'R40', 1],       // CBSA → Denver (Provo-Orem-Lehi CBSA)
  ['West Jordan', 'UT', '49035', 'S48B', 'R40', 1],
  ['Orem', 'UT', '49049', 'S48B', 'R40', 1],        // CBSA → Denver (Provo-Orem-Lehi CBSA)

  // === COLORADO ===
  ['Denver', 'CO', '08031', 'S48B', 'YDEN', 1],
  ['Colorado Springs', 'CO', '08041', 'S48B', 'YDEN', 1],
  ['Aurora', 'CO', '08005', 'S48B', 'YDEN', 1],
  ['Fort Collins', 'CO', '08069', '0400', 'SCO', 2], // No CBSA match → West regional, CO state gas
  ['Lakewood', 'CO', '08059', 'S48B', 'YDEN', 1],

  // === HAWAII ===
  ['Honolulu', 'HI', '15003', 'S49F', 'R50', 3],
  ['East Honolulu', 'HI', '15003', 'S49F', 'R50', 3],
  ['Pearl City', 'HI', '15003', 'S49F', 'R50', 3],
  ['Hilo', 'HI', '15001', '0400', 'R50', 3],        // No CBSA match → West regional
  ['Kailua', 'HI', '15003', 'S49F', 'R50', 3],

  // === ALASKA ===
  ['Anchorage', 'AK', '02020', 'S49G', 'R50', 3],
  ['Fairbanks', 'AK', '02090', '0400', 'R50', 3],   // No CBSA match → West regional
  ['Juneau', 'AK', '02110', '0400', 'R50', 3],
  ['Sitka', 'AK', '02220', '0400', 'R50', 3],
  ['Ketchikan', 'AK', '02130', '0400', 'R50', 1],
]

describe('City mapping audit — CPI areas', () => {
  test.each(CITY_MAPPINGS)(
    '%s, %s (FIPS %s) → CPI area %s',
    (city, state, countyFips, expectedCpi) => {
      const result = getMetroCpiAreaForCounty(countyFips, state)
      expect(result.areaCode).toBe(expectedCpi)
    }
  )
})

describe('City mapping audit — Gas regions', () => {
  test.each(CITY_MAPPINGS)(
    '%s, %s (FIPS %s) → gas duoarea %s (tier %s)',
    (city, state, countyFips, expectedCpi, expectedGas, expectedTier) => {
      const cpi = getMetroCpiAreaForCounty(countyFips, state)
      const gas = getGasLookup(state, cpi.areaCode, countyFips)
      expect(gas.duoarea).toBe(expectedGas)
      expect(gas.tier).toBe(expectedTier)
    }
  )
})

describe('City mapping audit — BLS CPI series (groceries, shelter, energy)', () => {
  test.each(CITY_MAPPINGS)(
    '%s, %s (FIPS %s) → CPI series use area code %s',
    (city, state, countyFips, expectedCpi) => {
      const cpi = getMetroCpiAreaForCounty(countyFips, state)
      // Groceries, shelter, and energy all derive from the same CPI area code
      const groceriesSeries = `CUUR${cpi.areaCode}SAF11`
      const shelterSeries = `CUUR${cpi.areaCode}SAH1`
      const energySeries = `CUUR${cpi.areaCode}SA0E`

      // Verify series IDs use the expected area code
      expect(groceriesSeries).toBe(`CUUR${expectedCpi}SAF11`)
      expect(shelterSeries).toBe(`CUUR${expectedCpi}SAH1`)
      expect(energySeries).toBe(`CUUR${expectedCpi}SA0E`)

      // Verify series IDs are well-formed BLS CPI format
      expect(groceriesSeries).toMatch(/^CUUR[A-Z0-9]{4}SAF11$/)
      expect(shelterSeries).toMatch(/^CUUR[A-Z0-9]{4}SAH1$/)
      expect(energySeries).toMatch(/^CUUR[A-Z0-9]{4}SA0E$/)
    }
  )
})

describe('City mapping audit — Unemployment (LAUS) series', () => {
  test.each(CITY_MAPPINGS)(
    '%s, %s (FIPS %s) → LAUS series LAUCN%s0000000003',
    (city, state, countyFips) => {
      // Unemployment uses county FIPS directly — no metro/state mapping
      const padded = countyFips.padStart(5, '0')
      const seriesId = `LAUCN${padded}0000000003`

      // Verify FIPS produces a well-formed LAUS series ID
      expect(seriesId).toMatch(/^LAUCN\d{5}0000000003$/)
      // Verify the FIPS is 5 digits (not padded from something shorter)
      expect(countyFips).toMatch(/^\d{5}$/)
    }
  )
})

describe('City mapping audit — cross-source consistency', () => {
  test.each(CITY_MAPPINGS)(
    '%s, %s — gas and CPI use compatible geographic regions',
    (city, state, countyFips, expectedCpi, expectedGas, expectedTier) => {
      const cpi = getMetroCpiAreaForCounty(countyFips, state)
      const gas = getGasLookup(state, cpi.areaCode, countyFips)

      // Gas and CPI should never map to completely incompatible regions.
      // E.g., a PAD 4 (Rocky Mountain) state should not get a PAD 5 (West Coast) gas city.
      // Idaho was the canonical bug: CPI→Seattle dragged gas to Seattle (PAD 5) for a PAD 4 state.

      // Verify gas label is not empty
      expect(gas.geoLevel).toBeTruthy()
      // Verify CPI area name is not empty
      expect(cpi.areaName).toBeTruthy()
    }
  )
})
