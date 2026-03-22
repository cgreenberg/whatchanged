import type { FederalFundingData } from '@/types'
import { STATE_FIPS_TO_ABBR } from '@/lib/mappings/state-fips'

const USASPENDING_API_BASE = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'

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
      place_of_performance_locations: [{ country: 'USA', state, county: countyCode }],
      award_type_codes: ['A', 'B', 'C', 'D'],
    },
    fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Award Type'],
    page: 1,
    limit: 100,
    sort: 'Award Amount',
    order: 'desc',
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  let json: any
  try {
    const response = await fetch(USASPENDING_API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`USASpending API error: ${response.status} ${response.statusText}`)
    }

    json = await response.json()
  } finally {
    clearTimeout(timeout)
  }

  const results: any[] = json?.results ?? []

  let amountCut = 0

  for (const award of results) {
    const amount = typeof award['Award Amount'] === 'number' ? award['Award Amount'] : 0
    amountCut += amount
  }

  return {
    amountCut,
    contractsCut: results.length,
    grantsCut: 0,
    countyFips,
  }
}
