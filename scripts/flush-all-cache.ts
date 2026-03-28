// Flush all data cache keys from Upstash Redis
// Usage: npx tsx scripts/flush-all-cache.ts

import { readFileSync } from 'fs'
import { Redis } from '@upstash/redis'

// Load .env.local manually
const envFile = readFileSync('.env.local', 'utf-8')
for (const line of envFile.split('\n')) {
  const match = line.match(/^(\w+)=(.*)$/)
  if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
}

async function scanPattern(redis: Redis, pattern: string): Promise<string[]> {
  let cursor = 0
  const keys: string[] = []
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: pattern, count: 100 })
    cursor = typeof nextCursor === 'string' ? parseInt(nextCursor) : nextCursor
    keys.push(...batch)
  } while (cursor !== 0)
  return keys
}

async function main() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    console.error('Missing KV_REST_API_URL or KV_REST_API_TOKEN in .env.local')
    process.exit(1)
  }

  const redis = new Redis({ url, token })

  const patterns = [
    'bls:cpi:*',
    'bls:unemployment:*',
    'bls:national:*',
    'eia:gas:*',
    'national:*',
  ]

  console.log('Scanning for cache keys...')

  const allKeys: string[] = []
  for (const pattern of patterns) {
    const keys = await scanPattern(redis, pattern)
    console.log(`  ${pattern}: ${keys.length} keys`)
    allKeys.push(...keys)
  }

  if (allKeys.length === 0) {
    console.log('No cache keys found.')
    return
  }

  console.log(`\nFound ${allKeys.length} total keys to delete:`)
  for (const key of allKeys) {
    console.log(`  ${key}`)
  }

  await Promise.all(allKeys.map(key => redis.del(key)))
  console.log(`\nDeleted ${allKeys.length} cache keys.`)
}

main().catch(console.error)
