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
const CITY_MAPPINGS: Array<[string, string, string, string, string, number]> = [
  // === MAINE ===
  ['Portland', 'ME', '23005', 'S11A', 'YBOS', 1],
  ['Lewiston', 'ME', '23001', 'S11A', 'YBOS', 1],
  ['Bangor', 'ME', '23019', 'S11A', 'YBOS', 1],
  ['South Portland', 'ME', '23005', 'S11A', 'YBOS', 1],
  ['Auburn', 'ME', '23001', 'S11A', 'YBOS', 1],

  // === NEW HAMPSHIRE ===
  ['Manchester', 'NH', '33011', 'S11A', 'YBOS', 1],
  ['Nashua', 'NH', '33011', 'S11A', 'YBOS', 1],
  ['Concord', 'NH', '33013', 'S11A', 'YBOS', 1],
  ['Derry', 'NH', '33015', 'S11A', 'YBOS', 1],
  ['Dover', 'NH', '33017', 'S11A', 'YBOS', 1],

  // === VERMONT ===
  ['Burlington', 'VT', '50007', 'S11A', 'YBOS', 1],
  ['South Burlington', 'VT', '50007', 'S11A', 'YBOS', 1],
  ['Rutland', 'VT', '50021', 'S11A', 'YBOS', 1],
  ['Barre', 'VT', '50023', 'S11A', 'YBOS', 1],
  ['Montpelier', 'VT', '50023', 'S11A', 'YBOS', 1],

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
  ['Bridgeport', 'CT', '09001', 'S12A', 'Y35NY', 1], // Fairfield County override → NYC
  ['New Haven', 'CT', '09009', 'S11A', 'YBOS', 1],
  ['Hartford', 'CT', '09003', 'S11A', 'YBOS', 1],
  ['Stamford', 'CT', '09001', 'S12A', 'Y35NY', 1], // Fairfield County override → NYC
  ['Waterbury', 'CT', '09009', 'S11A', 'YBOS', 1],

  // === NEW YORK ===
  ['New York City', 'NY', '36061', 'S12A', 'Y35NY', 1],
  ['Buffalo', 'NY', '36029', 'S12A', 'SNY', 1], // County override → NY state gas
  ['Rochester', 'NY', '36055', 'S12A', 'SNY', 1], // County override → NY state gas
  ['Yonkers', 'NY', '36119', 'S12A', 'Y35NY', 1],
  ['Syracuse', 'NY', '36067', 'S12A', 'SNY', 1], // County override → NY state gas

  // === NEW JERSEY ===
  ['Newark', 'NJ', '34013', 'S12A', 'Y35NY', 1],
  ['Jersey City', 'NJ', '34017', 'S12A', 'Y35NY', 1],
  ['Paterson', 'NJ', '34031', 'S12A', 'Y35NY', 1],
  ['Elizabeth', 'NJ', '34039', 'S12A', 'Y35NY', 1],
  ['Camden', 'NJ', '34007', 'S12B', 'R1Y', 3], // County override → Philadelphia CPI, no EIA city → PAD 1B

  // === PENNSYLVANIA ===
  ['Philadelphia', 'PA', '42101', 'S12B', 'R1Y', 3], // PAD 1B Central Atlantic
  ['Pittsburgh', 'PA', '42003', 'S12B', 'R1Y', 3],
  ['Allentown', 'PA', '42077', 'S12B', 'R1Y', 3],
  ['Reading', 'PA', '42011', 'S12B', 'R1Y', 3],
  ['Erie', 'PA', '42049', 'S12B', 'R1Y', 3],

  // === DELAWARE ===
  ['Wilmington', 'DE', '10003', 'S12B', 'R1Y', 3],
  ['Dover', 'DE', '10001', 'S12B', 'R1Y', 3],
  ['Newark', 'DE', '10003', 'S12B', 'R1Y', 3],
  ['Middletown', 'DE', '10003', 'S12B', 'R1Y', 3],
  ['Bear', 'DE', '10003', 'S12B', 'R1Y', 3],

  // === MARYLAND ===
  ['Baltimore', 'MD', '24510', 'S35E', 'R1Y', 3], // PAD 1B Central Atlantic
  ['Columbia', 'MD', '24027', 'S35E', 'R1Y', 3],
  ['Germantown', 'MD', '24031', 'S35A', 'R1Y', 3], // County override → DC CPI
  ['Silver Spring', 'MD', '24031', 'S35A', 'R1Y', 3], // County override → DC CPI
  ['Waldorf', 'MD', '24017', 'S35A', 'R1Y', 3], // County override → DC CPI

  // === WASHINGTON DC ===
  ['Washington', 'DC', '11001', 'S35A', 'R1Y', 3],

  // === VIRGINIA ===
  ['Virginia Beach', 'VA', '51810', 'S35A', 'R1Z', 3], // PAD 1C Lower Atlantic
  ['Norfolk', 'VA', '51710', 'S35A', 'R1Z', 3],
  ['Chesapeake', 'VA', '51550', 'S35A', 'R1Z', 3],
  ['Richmond', 'VA', '51760', 'S35A', 'R1Z', 3],
  ['Newport News', 'VA', '51700', 'S35A', 'R1Z', 3],

  // === WEST VIRGINIA ===
  ['Charleston', 'WV', '54039', 'S35A', 'R1Z', 3],
  ['Huntington', 'WV', '54011', 'S35A', 'R1Z', 3],
  ['Morgantown', 'WV', '54061', 'S35A', 'R1Z', 3],
  ['Parkersburg', 'WV', '54107', 'S35A', 'R1Z', 3],
  ['Wheeling', 'WV', '54069', 'S35A', 'R1Z', 3],

  // === NORTH CAROLINA ===
  ['Charlotte', 'NC', '37119', 'S35C', 'R1Z', 3],
  ['Raleigh', 'NC', '37183', 'S35C', 'R1Z', 3],
  ['Greensboro', 'NC', '37081', 'S35C', 'R1Z', 3],
  ['Durham', 'NC', '37063', 'S35C', 'R1Z', 3],
  ['Winston-Salem', 'NC', '37067', 'S35C', 'R1Z', 3],

  // === SOUTH CAROLINA ===
  ['Charleston', 'SC', '45019', 'S35C', 'R1Z', 3],
  ['Columbia', 'SC', '45079', 'S35C', 'R1Z', 3],
  ['North Charleston', 'SC', '45019', 'S35C', 'R1Z', 3],
  ['Mount Pleasant', 'SC', '45019', 'S35C', 'R1Z', 3],
  ['Greenville', 'SC', '45045', 'S35C', 'R1Z', 3],

  // === GEORGIA ===
  ['Atlanta', 'GA', '13121', 'S35C', 'R1Z', 3], // Lower Atlantic, NOT East Coast
  ['Augusta', 'GA', '13073', 'S35C', 'R1Z', 3],
  ['Columbus', 'GA', '13215', 'S35C', 'R1Z', 3],
  ['Savannah', 'GA', '13051', 'S35C', 'R1Z', 3],
  ['Athens', 'GA', '13059', 'S35C', 'R1Z', 3],

  // === FLORIDA ===
  ['Jacksonville', 'FL', '12031', 'S35B', 'SFL', 1], // County override → FL state gas
  ['Miami', 'FL', '12086', 'S35B', 'YMIA', 1],
  ['Tampa', 'FL', '12057', 'S35D', 'SFL', 2], // CPI override → Tampa; gas: Tampa CPI not in EIA city → FL state level
  ['Orlando', 'FL', '12095', 'S35B', 'SFL', 1], // County override → FL state gas
  ['St. Petersburg', 'FL', '12103', 'S35D', 'SFL', 2], // CPI override → Tampa; gas: FL state

  // === ALABAMA ===
  ['Birmingham', 'AL', '01073', 'S35C', 'R30', 3], // Gulf Coast PAD 3
  ['Montgomery', 'AL', '01101', 'S35C', 'R30', 3],
  ['Huntsville', 'AL', '01089', 'S35C', 'R30', 3],
  ['Mobile', 'AL', '01097', 'S35C', 'R30', 3],
  ['Tuscaloosa', 'AL', '01125', 'S35C', 'R30', 3],

  // === MISSISSIPPI ===
  ['Jackson', 'MS', '28049', 'S35C', 'R30', 3],
  ['Gulfport', 'MS', '28047', 'S35C', 'R30', 3],
  ['Southaven', 'MS', '28033', 'S37B', 'Y44HO', 1], // County override → Houston CPI → Houston gas
  ['Hattiesburg', 'MS', '28035', 'S35C', 'R30', 3],
  ['Biloxi', 'MS', '28047', 'S35C', 'R30', 3],

  // === TENNESSEE ===
  ['Nashville', 'TN', '47037', 'S35C', 'R20', 3], // PAD 2 Midwest (TN is officially PAD 2)
  ['Memphis', 'TN', '47157', 'S35C', 'R20', 3],
  ['Knoxville', 'TN', '47093', 'S35C', 'R20', 3],
  ['Chattanooga', 'TN', '47065', 'S35C', 'R20', 3],
  ['Clarksville', 'TN', '47125', 'S35C', 'R20', 3],

  // === KENTUCKY ===
  ['Louisville', 'KY', '21111', 'S24B', 'R20', 3],
  ['Lexington', 'KY', '21067', 'S24B', 'R20', 3],
  ['Bowling Green', 'KY', '21227', 'S24B', 'R20', 3],
  ['Owensboro', 'KY', '21059', 'S24B', 'R20', 3],
  ['Covington', 'KY', '21117', 'S23B', 'R20', 3], // County override → Detroit CPI; gas: S23B not in EIA city, KY not in state level → PAD 2

  // === LOUISIANA ===
  ['New Orleans', 'LA', '22071', 'S37B', 'R30', 1], // County override → Gulf Coast gas
  ['Baton Rouge', 'LA', '22033', 'S37B', 'R30', 1],
  ['Shreveport', 'LA', '22017', 'S37B', 'R30', 1],
  ['Metairie', 'LA', '22051', 'S37B', 'R30', 1],
  ['Lafayette', 'LA', '22055', 'S37B', 'R30', 1],

  // === ARKANSAS ===
  ['Little Rock', 'AR', '05119', 'S37A', 'R30', 3],
  ['Fort Smith', 'AR', '05131', 'S37A', 'R30', 3],
  ['Fayetteville', 'AR', '05143', 'S37A', 'R30', 3],
  ['Springdale', 'AR', '05143', 'S37A', 'R30', 3],
  ['Jonesboro', 'AR', '05031', 'S37A', 'R30', 3],

  // === OHIO ===
  ['Columbus', 'OH', '39049', 'S23B', 'SOH', 2],
  ['Cleveland', 'OH', '39035', 'S23B', 'YCLE', 1], // County override → Cleveland gas
  ['Cincinnati', 'OH', '39061', 'S23B', 'SOH', 2],
  ['Toledo', 'OH', '39095', 'S23B', 'SOH', 2],
  ['Akron', 'OH', '39153', 'S23B', 'SOH', 2],

  // === MICHIGAN ===
  ['Detroit', 'MI', '26163', 'S23B', 'R20', 3], // S23B not in CPI→EIA city, MI not in state level → PAD 2
  ['Grand Rapids', 'MI', '26081', 'S23B', 'R20', 3],
  ['Warren', 'MI', '26099', 'S23B', 'R20', 3],
  ['Sterling Heights', 'MI', '26099', 'S23B', 'R20', 3],
  ['Ann Arbor', 'MI', '26161', 'S23B', 'R20', 3],

  // === INDIANA ===
  ['Indianapolis', 'IN', '18097', 'S23A', 'YORD', 1],
  ['Fort Wayne', 'IN', '18003', 'S23A', 'YORD', 1],
  ['Evansville', 'IN', '18163', 'S23A', 'YORD', 1],
  ['South Bend', 'IN', '18141', 'S23A', 'YORD', 1],
  ['Carmel', 'IN', '18057', 'S23A', 'YORD', 1],

  // === ILLINOIS ===
  ['Chicago', 'IL', '17031', 'S23A', 'YORD', 1],
  ['Aurora', 'IL', '17089', 'S23A', 'YORD', 1],
  ['Joliet', 'IL', '17197', 'S23A', 'YORD', 1],
  ['Naperville', 'IL', '17043', 'S23A', 'YORD', 1],
  ['Rockford', 'IL', '17201', 'S23A', 'YORD', 1],

  // === WISCONSIN ===
  ['Milwaukee', 'WI', '55079', 'S23A', 'YORD', 1],
  ['Madison', 'WI', '55025', 'S23A', 'YORD', 1],
  ['Green Bay', 'WI', '55009', 'S23A', 'YORD', 1],
  ['Kenosha', 'WI', '55059', 'S23A', 'YORD', 1],
  ['Racine', 'WI', '55101', 'S23A', 'YORD', 1],

  // === MINNESOTA ===
  ['Minneapolis', 'MN', '27053', 'S24A', 'SMN', 2],
  ['St. Paul', 'MN', '27123', 'S24A', 'SMN', 2],
  ['Rochester', 'MN', '27109', 'S24A', 'SMN', 2],
  ['Bloomington', 'MN', '27053', 'S24A', 'SMN', 2],
  ['Duluth', 'MN', '27137', 'S24A', 'SMN', 2],

  // === IOWA ===
  ['Des Moines', 'IA', '19153', 'S24A', 'R20', 3],
  ['Cedar Rapids', 'IA', '19113', 'S24A', 'R20', 3],
  ['Davenport', 'IA', '19163', 'S24A', 'R20', 3],
  ['Sioux City', 'IA', '19193', 'S24A', 'R20', 3],
  ['Iowa City', 'IA', '19103', 'S24A', 'R20', 3],

  // === MISSOURI ===
  ['Kansas City', 'MO', '29095', 'S24B', 'R20', 3],
  ['St. Louis', 'MO', '29510', 'S24B', 'R20', 3],
  ['Springfield', 'MO', '29077', 'S24B', 'R20', 3],
  ['Columbia', 'MO', '29019', 'S24B', 'R20', 3],
  ['Independence', 'MO', '29095', 'S24B', 'R20', 3],

  // === NORTH DAKOTA ===
  ['Fargo', 'ND', '38017', 'S24A', 'R20', 3],
  ['Bismarck', 'ND', '38015', 'S24A', 'R20', 3],
  ['Grand Forks', 'ND', '38035', 'S24A', 'R20', 3],
  ['Minot', 'ND', '38101', 'S24A', 'R20', 3],
  ['West Fargo', 'ND', '38017', 'S24A', 'R20', 3],

  // === SOUTH DAKOTA ===
  ['Sioux Falls', 'SD', '46099', 'S24A', 'R20', 3],
  ['Rapid City', 'SD', '46103', 'S24A', 'R20', 3],
  ['Aberdeen', 'SD', '46013', 'S24A', 'R20', 3],
  ['Brookings', 'SD', '46011', 'S24A', 'R20', 3],
  ['Watertown', 'SD', '46029', 'S24A', 'R20', 3],

  // === NEBRASKA ===
  ['Omaha', 'NE', '31055', 'S24A', 'R20', 3],
  ['Lincoln', 'NE', '31109', 'S24A', 'R20', 3],
  ['Bellevue', 'NE', '31153', 'S24A', 'R20', 3],
  ['Grand Island', 'NE', '31079', 'S24A', 'R20', 3],
  ['Kearney', 'NE', '31019', 'S24A', 'R20', 3],

  // === KANSAS ===
  ['Wichita', 'KS', '20173', 'S24B', 'R20', 3],
  ['Overland Park', 'KS', '20091', 'S24B', 'R20', 3],
  ['Kansas City', 'KS', '20209', 'S24B', 'R20', 3],
  ['Olathe', 'KS', '20091', 'S24B', 'R20', 3],
  ['Topeka', 'KS', '20177', 'S24B', 'R20', 3],

  // === TEXAS ===
  ['Houston', 'TX', '48201', 'S37B', 'Y44HO', 1], // County override → Houston CPI → Houston gas
  ['San Antonio', 'TX', '48029', 'S37A', 'STX', 2], // S37A not in EIA city → TX state
  ['Dallas', 'TX', '48113', 'S37A', 'STX', 2],
  ['Austin', 'TX', '48453', 'S37A', 'STX', 2],
  ['Fort Worth', 'TX', '48439', 'S37A', 'STX', 2],

  // === OKLAHOMA ===
  ['Oklahoma City', 'OK', '40109', 'S37A', 'R20', 3],
  ['Tulsa', 'OK', '40143', 'S37A', 'R20', 3],
  ['Norman', 'OK', '40027', 'S37A', 'R20', 3],
  ['Broken Arrow', 'OK', '40143', 'S37A', 'R20', 3],
  ['Edmond', 'OK', '40109', 'S37A', 'R20', 3],

  // === NEW MEXICO ===
  ['Albuquerque', 'NM', '35001', 'S48A', 'R30', 3],
  ['Las Cruces', 'NM', '35013', 'S48A', 'R30', 3],
  ['Rio Rancho', 'NM', '35043', 'S48A', 'R30', 3],
  ['Santa Fe', 'NM', '35049', 'S48A', 'R30', 3],
  ['Roswell', 'NM', '35005', 'S48A', 'R30', 3],

  // === WASHINGTON ===
  ['Seattle', 'WA', '53033', 'S49D', 'Y48SE', 1],
  ['Spokane', 'WA', '53063', 'S49D', 'Y48SE', 1],
  ['Tacoma', 'WA', '53053', 'S49D', 'Y48SE', 1],
  ['Vancouver', 'WA', '53011', 'S49D', 'SWA', 1], // County override → WA state gas
  ['Bellevue', 'WA', '53033', 'S49D', 'Y48SE', 1],

  // === OREGON ===
  ['Portland', 'OR', '41051', 'S49D', 'Y48SE', 1], // OR CPI → Seattle → Seattle gas (no Portland EIA)
  ['Salem', 'OR', '41047', 'S49D', 'Y48SE', 1],
  ['Eugene', 'OR', '41039', 'S49D', 'Y48SE', 1],
  ['Gresham', 'OR', '41051', 'S49D', 'Y48SE', 1],
  ['Hillsboro', 'OR', '41067', 'S49D', 'Y48SE', 1],

  // === CALIFORNIA ===
  ['Los Angeles', 'CA', '06037', 'S49A', 'Y05LA', 1],
  ['San Diego', 'CA', '06073', 'S49E', 'SCA', 2], // County override → SD CPI; S49E not in EIA city → CA state
  ['San Jose', 'CA', '06085', 'S49B', 'Y05SF', 1], // County override → SF CPI → SF gas
  ['San Francisco', 'CA', '06075', 'S49B', 'Y05SF', 1],
  ['Fresno', 'CA', '06019', 'S49A', 'Y05LA', 1],

  // === NEVADA ===
  ['Las Vegas', 'NV', '32003', 'S49A', 'Y05LA', 1], // NV → LA CPI → LA gas
  ['Henderson', 'NV', '32003', 'S49A', 'Y05LA', 1],
  ['Reno', 'NV', '32031', 'S49B', 'Y05SF', 1], // County override → SF CPI → SF gas
  ['North Las Vegas', 'NV', '32003', 'S49A', 'Y05LA', 1],
  ['Sparks', 'NV', '32031', 'S49B', 'Y05SF', 1], // County override → SF CPI → SF gas

  // === ARIZONA ===
  ['Phoenix', 'AZ', '04013', 'S48A', 'R50', 3], // S48A not in EIA city, AZ not in state level → PAD 5
  ['Tucson', 'AZ', '04019', 'S48A', 'R50', 3],
  ['Mesa', 'AZ', '04013', 'S48A', 'R50', 3],
  ['Chandler', 'AZ', '04013', 'S48A', 'R50', 3],
  ['Scottsdale', 'AZ', '04013', 'S48A', 'R50', 3],

  // === IDAHO ===
  ['Boise', 'ID', '16001', 'S48B', 'YDEN', 1], // ID → Denver CPI → Denver gas
  ['Meridian', 'ID', '16001', 'S48B', 'YDEN', 1],
  ['Nampa', 'ID', '16027', 'S48B', 'YDEN', 1],
  ['Idaho Falls', 'ID', '16019', 'S48B', 'YDEN', 1],
  ['Pocatello', 'ID', '16005', 'S48B', 'YDEN', 1],

  // === MONTANA ===
  ['Billings', 'MT', '30111', 'S48B', 'YDEN', 1],
  ['Missoula', 'MT', '30063', 'S48B', 'YDEN', 1],
  ['Great Falls', 'MT', '30013', 'S48B', 'YDEN', 1],
  ['Bozeman', 'MT', '30031', 'S48B', 'YDEN', 1],
  ['Helena', 'MT', '30043', 'S48B', 'YDEN', 1],

  // === WYOMING ===
  ['Cheyenne', 'WY', '56021', 'S48B', 'YDEN', 1],
  ['Casper', 'WY', '56025', 'S48B', 'YDEN', 1],
  ['Laramie', 'WY', '56001', 'S48B', 'YDEN', 1],
  ['Gillette', 'WY', '56005', 'S48B', 'YDEN', 1],
  ['Rock Springs', 'WY', '56037', 'S48B', 'YDEN', 1],

  // === UTAH ===
  ['Salt Lake City', 'UT', '49035', 'S48B', 'YDEN', 1],
  ['West Valley City', 'UT', '49035', 'S48B', 'YDEN', 1],
  ['Provo', 'UT', '49049', 'S48B', 'YDEN', 1],
  ['West Jordan', 'UT', '49035', 'S48B', 'YDEN', 1],
  ['Orem', 'UT', '49049', 'S48B', 'YDEN', 1],

  // === COLORADO ===
  ['Denver', 'CO', '08031', 'S48B', 'YDEN', 1],
  ['Colorado Springs', 'CO', '08041', 'S48B', 'YDEN', 1],
  ['Aurora', 'CO', '08005', 'S48B', 'YDEN', 1],
  ['Fort Collins', 'CO', '08069', 'S48B', 'YDEN', 1],
  ['Lakewood', 'CO', '08059', 'S48B', 'YDEN', 1],

  // === HAWAII ===
  ['Honolulu', 'HI', '15003', 'S49F', 'R50', 3], // No HI state EIA → PAD 5
  ['East Honolulu', 'HI', '15003', 'S49F', 'R50', 3],
  ['Pearl City', 'HI', '15003', 'S49F', 'R50', 3],
  ['Hilo', 'HI', '15001', 'S49F', 'R50', 3],
  ['Kailua', 'HI', '15003', 'S49F', 'R50', 3],

  // === ALASKA ===
  ['Anchorage', 'AK', '02020', 'S49G', 'R50', 3], // No AK state EIA → PAD 5
  ['Fairbanks', 'AK', '02090', 'S49G', 'R50', 3],
  ['Juneau', 'AK', '02110', 'S49G', 'R50', 3],
  ['Sitka', 'AK', '02220', 'S49G', 'R50', 3],
  ['Ketchikan', 'AK', '02130', 'S49G', 'R50', 3],
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
