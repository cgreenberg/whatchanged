import type { DataResult } from '@/types'

export interface DataSource<T> {
  id: string
  name: string
  docsUrl: string
  fetch: (...args: any[]) => Promise<T>
}

// Wraps any async fetch in error handling, returning DataResult<T>
export async function safelyFetch<T>(
  source: DataSource<T>,
  fetchArgs: Parameters<DataSource<T>['fetch']>
): Promise<DataResult<T>> {
  const fetchedAt = new Date().toISOString()
  try {
    const data = await source.fetch(...fetchArgs)
    return { data, error: null, fetchedAt, sourceId: source.id }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[${source.id}] fetch failed:`, error)
    return { data: null, error, fetchedAt, sourceId: source.id }
  }
}
