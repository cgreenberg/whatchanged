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

  // Cache only if at least 3 of 4 external sources succeeded
  const successCount = [snapshot.unemployment, snapshot.cpi, snapshot.gas, snapshot.federal]
    .filter(s => s.data !== null).length

  if (successCount >= 3) {
    await setCached(cacheKey, snapshot, CACHE_TTL)
  }

  return NextResponse.json(snapshot)
}
