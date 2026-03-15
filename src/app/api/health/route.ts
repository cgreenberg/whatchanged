import { NextResponse } from 'next/server'
import { blsSource, blsCpiSource, eiaSource, usaSpendingSource } from '@/lib/api/source-registry'

interface SourceStatus {
  name: string
  status: 'ok' | 'error'
  error?: string
  docsUrl: string
}

export async function GET() {
  const results: Record<string, SourceStatus> = {}

  const checks = [
    {
      source: blsSource,
      args: ['53011'],
    },
    {
      source: blsCpiSource,
      args: [],
    },
    {
      source: eiaSource,
      args: ['WA'],
    },
    {
      source: usaSpendingSource,
      args: ['53011', 'WA'],
    },
  ]

  await Promise.all(
    checks.map(async ({ source, args }) => {
      try {
        await source.fetch(...args)
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

  const allOk = Object.values(results).every((r) => r.status === 'ok')
  return NextResponse.json(
    { status: allOk ? 'ok' : 'degraded', sources: results },
    { status: allOk ? 200 : 207 }
  )
}
