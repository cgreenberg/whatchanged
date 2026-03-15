import { NextRequest, NextResponse } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { getCached, setCached } from '@/lib/cache/kv'
import type { EconomicSnapshot } from '@/types'

const CACHE_TTL = 60 * 60 * 24  // 24 hours

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ zip: string }> }
) {
  const { zip } = await params

  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip code format' }, { status: 400 })
  }

  const cacheKey = `snapshot:${zip}`
  const cached = await getCached<EconomicSnapshot>(cacheKey)
  if (cached) {
    return NextResponse.json(cached)
  }

  const snapshot = await fetchSnapshot(zip)
  if (!snapshot) {
    return NextResponse.json({ error: 'Zip code not found' }, { status: 404 })
  }

  // Cache if at least unemployment succeeded
  if (snapshot.unemployment.data) {
    await setCached(cacheKey, snapshot, CACHE_TTL)
  }

  return NextResponse.json(snapshot)
}
