// Cache adapter: uses Vercel KV in production, in-memory Map in test/dev
// This means tests never need a real Redis connection

let kvClient: typeof import('@vercel/kv').kv | null = null

async function getKv() {
  if (process.env.NODE_ENV === 'test' || !process.env.KV_REST_API_URL) {
    return null  // signals: use in-memory fallback
  }
  if (!kvClient) {
    const { kv } = await import('@vercel/kv')
    kvClient = kv
  }
  return kvClient
}

// In-memory fallback for test/local dev
const memCache = new Map<string, { value: unknown; expiresAt: number }>()

export async function getCached<T>(key: string): Promise<T | null> {
  const kv = await getKv()
  if (kv) {
    return kv.get<T>(key)
  }
  const entry = memCache.get(key)
  if (!entry || Date.now() > entry.expiresAt) return null
  return entry.value as T
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const kv = await getKv()
  if (kv) {
    await kv.set(key, value, { ex: ttlSeconds })
    return
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

export function clearMemCache() {
  memCache.clear()
}

export async function getCachedOrFetch<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
  negativeTtl = 300 // cache failures for 5 min to avoid hammering broken APIs
): Promise<{ data: T; cacheHit: boolean }> {
  try {
    const cached = await getCached<T>(key)
    if (cached !== null) {
      return { data: cached, cacheHit: true }
    }
    // Check negative cache — if this key recently failed, don't retry
    const failed = await getCached<boolean>(`${key}:failed`)
    if (failed) {
      throw new Error(`Negative cache hit for ${key}`)
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Negative cache hit')) throw e
    console.error(`KV read failed for ${key}:`, e)
  }

  try {
    const data = await fetchFn()
    try {
      await setCached(key, data, ttlSeconds)
    } catch (e) {
      console.error(`KV write failed for ${key}:`, e)
    }
    return { data, cacheHit: false }
  } catch (fetchErr) {
    // Cache the failure so we don't retry for negativeTtl seconds
    try {
      await setCached(`${key}:failed`, true, negativeTtl)
    } catch {}
    throw fetchErr
  }
}
