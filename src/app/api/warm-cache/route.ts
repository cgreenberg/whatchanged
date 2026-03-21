import { NextResponse } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'

// Representative zips covering all 5 PAD districts and major CPI metros
// Each zip warms: its PAD district gas cache, county unemployment, and CPI metro
const WARM_ZIPS = [
  // PAD 1 — East Coast
  '10001',  // Manhattan, NY (CPI: New York metro)
  '33101',  // Miami, FL (CPI: Miami metro)
  '19103',  // Philadelphia, PA (CPI: Philadelphia metro)
  '02108',  // Boston, MA (CPI: Boston metro)
  // PAD 2 — Midwest
  '60601',  // Chicago, IL (CPI: Chicago metro)
  '48201',  // Detroit, MI (CPI: Detroit metro)
  '55401',  // Minneapolis, MN (CPI: Minneapolis metro)
  // PAD 3 — Gulf Coast
  '77001',  // Houston, TX (CPI: Houston metro)
  '75201',  // Dallas, TX (CPI: Dallas metro)
  // PAD 4 — Rocky Mountain
  '80202',  // Denver, CO (CPI: Denver metro)
  // PAD 5 — West Coast
  '90001',  // Los Angeles, CA (CPI: LA metro)
  '98101',  // Seattle, WA (CPI: Seattle metro)
  '94102',  // San Francisco, CA (CPI: SF metro)
  '85001',  // Phoenix, AZ (CPI: Phoenix metro)
  // Additional high-traffic
  '30301',  // Atlanta, GA (CPI: Atlanta metro)
  '63101',  // St. Louis, MO (CPI: St. Louis metro)
  '15120',  // Pittsburgh, PA
  '98683',  // Vancouver, WA (Portland CPI metro)
]

export async function GET() {
  const results: Array<{ zip: string; status: string; ms: number }> = []

  // Warm sequentially to avoid hammering APIs
  // (cached sources will be instant, only cold misses hit APIs)
  for (const zip of WARM_ZIPS) {
    const start = Date.now()
    try {
      const snapshot = await fetchSnapshot(zip)
      const cacheStatus = snapshot?.cacheStatus
      const misses = cacheStatus
        ? Object.entries(cacheStatus).filter(([, v]) => v === 'miss').map(([k]) => k)
        : ['unknown']
      results.push({
        zip,
        status: misses.length ? `warmed: ${misses.join(', ')}` : 'all cached',
        ms: Date.now() - start,
      })
    } catch (e) {
      results.push({
        zip,
        status: `error: ${e instanceof Error ? e.message : 'unknown'}`,
        ms: Date.now() - start,
      })
    }
  }

  return NextResponse.json({
    warmed: results.length,
    results,
    timestamp: new Date().toISOString(),
  })
}
