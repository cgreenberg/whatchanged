import { NextResponse, type NextRequest } from 'next/server'
import { buildMapMetricsMemo } from '@/lib/api/map-metrics'

// County map Gas / Groceries / Electricity values. Reads the cache only (never BLS/EIA, never the
// runtime upstream budget), memoized in-process for 60 s. The CDN keeps it for an hour, or 5 minutes when
// any area is missing or served from its last-good copy. A query string never reaches the build: it is
// redirected to the canonical path, so ?x=random cannot bypass the CDN and burn Redis reads.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (req.nextUrl.search) {
    const url = req.nextUrl.clone()
    url.search = ''
    return NextResponse.redirect(url, { status: 308, headers: { 'Cache-Control': 'public, s-maxage=86400' } })
  }
  try {
    const body = await buildMapMetricsMemo()
    const res = NextResponse.json(body)
    res.headers.set(
      'Cache-Control',
      body.missing > 0 || body.stale > 0
        ? 'public, s-maxage=300, stale-while-revalidate=300'
        : 'public, s-maxage=3600, stale-while-revalidate=86400'
    )
    return res
  } catch (e) {
    console.error('[map-metrics] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Map data unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
