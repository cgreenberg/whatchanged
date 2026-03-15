import type { FederalFundingData } from '@/types'

const USASPENDING_API_BASE = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'

// Map 2-digit state FIPS to state abbreviation
const STATE_FIPS_TO_ABBR: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
}

export async function fetchFederalFunding(
  countyFips: string,
  stateAbbr: string
): Promise<FederalFundingData> {
  // countyFips is 5 digits: first 2 = state FIPS, last 3 = county FIPS
  const padded = countyFips.padStart(5, '0')
  const stateFips = padded.slice(0, 2)
  const countyCode = padded.slice(2)

  // Use provided stateAbbr, fall back to FIPS lookup
  const state = stateAbbr || STATE_FIPS_TO_ABBR[stateFips] || 'WA'

  const body = {
    filters: {
      time_period: [{ start_date: '2025-01-20', end_date: '2025-12-31' }],
      place_of_performance_locations: [{ county: countyCode, state }],
      award_type_codes: ['A', 'B', 'C', 'D'],
    },
    fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Award Type'],
    page: 1,
    limit: 100,
    sort: 'Award Amount',
    order: 'desc',
  }

  const response = await fetch(USASPENDING_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`USASpending API error: ${response.status} ${response.statusText}`)
  }

  const json = await response.json()

  const results: any[] = json?.results ?? []

  let amountCut = 0
  let contractsCut = 0
  let grantsCut = 0

  for (const award of results) {
    const amount = typeof award['Award Amount'] === 'number' ? award['Award Amount'] : 0
    amountCut += amount

    const type = award['Award Type'] ?? ''
    if (type === 'Contract') {
      contractsCut++
    } else if (type === 'Grant') {
      grantsCut++
    }
  }

  return {
    amountCut,
    contractsCut,
    grantsCut,
    countyFips,
  }
}
