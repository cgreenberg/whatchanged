import { NextResponse } from 'next/server'
import { buildMapMetrics } from '@/lib/api/map-metrics'

// County map Gas / Groceries / Electricity values. Reads the cache only (never BLS/EIA, never the
// runtime upstream budget); the CDN keeps it for an hour, or 5 minutes when any area is missing.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const body = await buildMapMetrics()
    const res = NextResponse.json(body)
    res.headers.set(
      'Cache-Control',
      body.missing > 0 ? 'public, s-maxage=300, stale-while-revalidate=300' : 'public, s-maxage=3600, stale-while-revalidate=86400'
    )
    return res
  } catch (e) {
    console.error('[map-metrics] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Map data unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
