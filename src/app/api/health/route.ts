import { NextResponse } from 'next/server'
import { blsSource, blsCpiSource, eiaSource, usaSpendingSource } from '@/lib/api/source-registry'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { getCached } from '@/lib/cache/kv'

interface SourceStatus {
  name: string
  status: 'ok' | 'degraded' | 'error' | 'unknown'
  error?: string
  docsUrl: string
  cacheHit?: boolean
}

export async function GET() {
  const now = new Date().toISOString()
  const results: Record<string, SourceStatus> = {}

  // 1. Check Redis/cache availability
  let cacheAvailable = false
  try {
    // Attempt a benign cache read to verify connectivity
    await getCached<boolean>('health:ping')
    cacheAvailable = true
  } catch {
    cacheAvailable = false
  }

  // 2. Liveness checks — actually call each source (uses cache if warm)
  const livenessChecks = [
    { source: blsSource, args: ['53011'] as [string] },
    { source: blsCpiSource, args: ['53011', 'WA'] as [string, string] },
    { source: eiaSource, args: ['WA'] as [string] },
    { source: usaSpendingSource, args: ['53011', 'WA'] as [string, string] },
  ]

  await Promise.all(
    livenessChecks.map(async ({ source, args }) => {
      try {
        await (source.fetch as (...a: string[]) => Promise<unknown>)(...args)
        results[source.id] = { name: source.name, status: 'ok', docsUrl: source.docsUrl }
      } catch (err) {
        results[source.id] = {
          name: source.name,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown',
          docsUrl: source.docsUrl,
        }
      }
    })
  )

  // 3. Snapshot check for representative zip — reports cacheHit per source
  //    cacheHit=true means data was served from cache (warm), false means a live fetch occurred
  let snapshotCacheStatus: Record<string, boolean | null> = {}
  try {
    const snapshot = await fetchSnapshot('98683')
    if (snapshot?.cacheStatus) {
      snapshotCacheStatus = {
        unemployment: snapshot.cacheStatus.unemployment === 'hit',
        cpi: snapshot.cacheStatus.cpi === 'hit',
        gas: snapshot.cacheStatus.gas === 'hit',
        federal: snapshot.cacheStatus.federal === 'hit',
      }
      // Annotate liveness results with cacheHit info
      for (const [sourceKey, hit] of Object.entries(snapshotCacheStatus)) {
        const sourceIdMap: Record<string, string> = {
          unemployment: 'bls-laus',
          cpi: 'bls-cpi',
          gas: 'eia-gas',
          federal: 'usaspending',
        }
        const id = sourceIdMap[sourceKey]
        if (id && results[id]) {
          results[id].cacheHit = hit ?? undefined
        }
      }
    }
  } catch {
    // Non-fatal — snapshot check is best-effort
  }

  const allOk = Object.values(results).every((r) => r.status === 'ok')
  const overallStatus = allOk ? 'ok' : 'degraded'

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: now,
      cache: {
        available: cacheAvailable,
        note: cacheAvailable
          ? 'Redis connected'
          : 'Redis unavailable — using in-memory fallback',
      },
      sources: results,
    },
    {
      status: allOk ? 200 : 207,
      headers: { 'Cache-Control': 'no-cache, no-store' },
    }
  )
}
