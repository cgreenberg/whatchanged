// State / territory FIPS codes → name + USPS abbreviation
// Source: US Census Bureau ANSI/FIPS state codes
export const STATE_FIPS_MAP: Record<string, { name: string; abbr: string }> = {
  '01': { name: 'Alabama', abbr: 'AL' },
  '02': { name: 'Alaska', abbr: 'AK' },
  '04': { name: 'Arizona', abbr: 'AZ' },
  '05': { name: 'Arkansas', abbr: 'AR' },
  '06': { name: 'California', abbr: 'CA' },
  '08': { name: 'Colorado', abbr: 'CO' },
  '09': { name: 'Connecticut', abbr: 'CT' },
  '10': { name: 'Delaware', abbr: 'DE' },
  '11': { name: 'District of Columbia', abbr: 'DC' },
  '12': { name: 'Florida', abbr: 'FL' },
  '13': { name: 'Georgia', abbr: 'GA' },
  '15': { name: 'Hawaii', abbr: 'HI' },
  '16': { name: 'Idaho', abbr: 'ID' },
  '17': { name: 'Illinois', abbr: 'IL' },
  '18': { name: 'Indiana', abbr: 'IN' },
  '19': { name: 'Iowa', abbr: 'IA' },
  '20': { name: 'Kansas', abbr: 'KS' },
  '21': { name: 'Kentucky', abbr: 'KY' },
  '22': { name: 'Louisiana', abbr: 'LA' },
  '23': { name: 'Maine', abbr: 'ME' },
  '24': { name: 'Maryland', abbr: 'MD' },
  '25': { name: 'Massachusetts', abbr: 'MA' },
  '26': { name: 'Michigan', abbr: 'MI' },
  '27': { name: 'Minnesota', abbr: 'MN' },
  '28': { name: 'Mississippi', abbr: 'MS' },
  '29': { name: 'Missouri', abbr: 'MO' },
  '30': { name: 'Montana', abbr: 'MT' },
  '31': { name: 'Nebraska', abbr: 'NE' },
  '32': { name: 'Nevada', abbr: 'NV' },
  '33': { name: 'New Hampshire', abbr: 'NH' },
  '34': { name: 'New Jersey', abbr: 'NJ' },
  '35': { name: 'New Mexico', abbr: 'NM' },
  '36': { name: 'New York', abbr: 'NY' },
  '37': { name: 'North Carolina', abbr: 'NC' },
  '38': { name: 'North Dakota', abbr: 'ND' },
  '39': { name: 'Ohio', abbr: 'OH' },
  '40': { name: 'Oklahoma', abbr: 'OK' },
  '41': { name: 'Oregon', abbr: 'OR' },
  '42': { name: 'Pennsylvania', abbr: 'PA' },
  '44': { name: 'Rhode Island', abbr: 'RI' },
  '45': { name: 'South Carolina', abbr: 'SC' },
  '46': { name: 'South Dakota', abbr: 'SD' },
  '47': { name: 'Tennessee', abbr: 'TN' },
  '48': { name: 'Texas', abbr: 'TX' },
  '49': { name: 'Utah', abbr: 'UT' },
  '50': { name: 'Vermont', abbr: 'VT' },
  '51': { name: 'Virginia', abbr: 'VA' },
  '53': { name: 'Washington', abbr: 'WA' },
  '54': { name: 'West Virginia', abbr: 'WV' },
  '55': { name: 'Wisconsin', abbr: 'WI' },
  '56': { name: 'Wyoming', abbr: 'WY' },
  // Territories. Only PR has Census ZCTAs; the others appear in zip data only
  // if a build source lists them.
  '60': { name: 'American Samoa', abbr: 'AS' },
  '66': { name: 'Guam', abbr: 'GU' },
  '69': { name: 'Northern Mariana Islands', abbr: 'MP' },
  '72': { name: 'Puerto Rico', abbr: 'PR' },
  '78': { name: 'U.S. Virgin Islands', abbr: 'VI' },
}

/** 50 states + DC only (FIPS → USPS abbreviation). */
export const STATE_FIPS_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_FIPS_MAP)
    .filter(([fips]) => Number(fips) <= 56)
    .map(([fips, { abbr }]) => [fips, abbr])
)
