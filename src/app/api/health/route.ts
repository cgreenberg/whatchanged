// Health check.
// Public requests are CACHE-ONLY: they report which representative cache keys
// are present and how old their data is. No upstream (BLS/EIA) calls are made,
// so this endpoint cannot burn API quota.
// Live upstream checks run only with `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { blsCpiSource, eiaSource, eiaElectricitySource } from '@/lib/api/source-registry'
import { getCached, getCachedEnvelope, lastGoodKey, failedKey } from '@/lib/cache/kv'
import { isCronAuthorized } from '@/lib/api/cron-auth'
import { cpiCacheKey, fetchCpiArea, NATIONAL_CPI_AREA } from '@/lib/api/bls-cpi'
import { getGasLookup, NATIONAL_GAS_CACHE_KEY, fetchGasSeries } from '@/lib/api/eia'
import { getMetroCpiAreaForCounty } from '@/lib/mappings/county-metro-cpi'
import { electricityCacheKey, fetchElectricitySeries, NATIONAL_ELECTRICITY } from '@/lib/api/eia-electricity'

export const dynamic = 'force-dynamic'

// Representative location: Clark County, WA (zip 98683)
const SAMPLE_COUNTY = '53011'
const SAMPLE_STATE = 'WA'

interface KeyStatus {
  key: string
  present: boolean
  fetchedAt: string | null
  ageSeconds: number | null
  lastGoodPresent: boolean
  recentlyFailed: boolean
}

async function keyStatus(key: string): Promise<KeyStatus> {
  const [env, lastGood, failed] = await Promise.all([
    getCachedEnvelope<unknown>(key),
    getCachedEnvelope<unknown>(lastGoodKey(key)),
    getCached<boolean>(failedKey(key)),
  ])
  const fetchedAt = env?.fetchedAt ?? null
  const t = fetchedAt ? new Date(fetchedAt).getTime() : NaN
  return {
    key,
    present: !!env,
    fetchedAt,
    ageSeconds: Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : null,
    lastGoodPresent: !!lastGood,
    recentlyFailed: !!failed,
  }
}

function redact(message: string): string {
  let safe = message
  for (const secret of [process.env.BLS_API_KEY, process.env.EIA_API_KEY]) {
    if (secret) safe = safe.replaceAll(secret, '[REDACTED]')
  }
  return safe
}

export async function GET(req: Request) {
  const now = new Date().toISOString()

  let cacheAvailable = false
  try {
    await getCached<boolean>('health:ping')
    cacheAvailable = true
  } catch {
    cacheAvailable = false
  }

  const cpiArea = getMetroCpiAreaForCounty(SAMPLE_COUNTY, SAMPLE_STATE)
  const gasLookup = getGasLookup(SAMPLE_STATE, cpiArea.areaCode, SAMPLE_COUNTY)
  const keys = [
    cpiCacheKey(cpiArea.areaCode),
    cpiCacheKey(NATIONAL_CPI_AREA),
    gasLookup.cacheKey,
    NATIONAL_GAS_CACHE_KEY,
    electricityCacheKey(SAMPLE_STATE),
    electricityCacheKey(NATIONAL_ELECTRICITY),
  ]

  let cacheKeys: KeyStatus[] = []
  if (cacheAvailable) {
    try {
      cacheKeys = await Promise.all(keys.map(keyStatus))
    } catch {
      cacheAvailable = false
    }
  }

  let live: Record<string, { name: string; status: 'ok' | 'error'; error?: string; docsUrl: string }> | null = null
  if (isCronAuthorized(req)) {
    live = {}
    const checks = [
      { source: blsCpiSource, run: () => fetchCpiArea({ areaCode: NATIONAL_CPI_AREA, areaName: 'National', tier: 4 }) },
      { source: eiaSource, run: () => fetchGasSeries('NUS') },
      { source: eiaElectricitySource, run: () => fetchElectricitySeries(NATIONAL_ELECTRICITY) },
    ]
    await Promise.all(
      checks.map(async ({ source, run }) => {
        try {
          await run()
          live![source.id] = { name: source.name, status: 'ok', docsUrl: source.docsUrl }
        } catch (err) {
          live![source.id] = {
            name: source.name,
            status: 'error',
            error: redact(err instanceof Error ? err.message : 'Unknown'),
            docsUrl: source.docsUrl,
          }
        }
      })
    )
  }

  const cacheOk = cacheAvailable && cacheKeys.every((k) => k.present || k.lastGoodPresent)
  const liveOk = !live || Object.values(live).every((r) => r.status === 'ok')
  const ok = cacheOk && liveOk

  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      timestamp: now,
      cache: {
        available: cacheAvailable,
        note: cacheAvailable ? 'Cache reachable' : 'Cache unavailable',
        keys: cacheKeys,
      },
      ...(live ? { live } : { liveChecks: 'skipped (requires CRON_SECRET)' }),
    },
    {
      status: ok ? 200 : 207,
      // Public (unauthenticated) checks do ~19 Redis reads: let the CDN absorb
      // repeated hits for a minute. Authenticated live checks are never cached.
      headers: live
        ? { 'Cache-Control': 'no-cache, no-store' }
        : { 'Cache-Control': 'public, s-maxage=60', Vary: 'Authorization' },
    }
  )
}
