import { NextRequest, NextResponse } from 'next/server'
import { fetchSnapshot } from '@/lib/api/snapshot'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ zip: string }> }
) {
  const { zip } = await params

  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip code format' }, { status: 400 })
  }

  const snapshot = await fetchSnapshot(zip)
  if (!snapshot) {
    return NextResponse.json({ error: 'Zip code not found' }, { status: 404 })
  }

  const response = NextResponse.json(snapshot)
  response.headers.set('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
  return response
}
