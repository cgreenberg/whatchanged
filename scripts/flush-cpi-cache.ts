// Flush all CPI cache keys from Upstash Redis
// Usage: npx tsx scripts/flush-cpi-cache.ts

import { readFileSync } from 'fs'
import { Redis } from '@upstash/redis'

// Load .env.local manually
const envFile = readFileSync('.env.local', 'utf-8')
for (const line of envFile.split('\n')) {
  const match = line.match(/^(\w+)=(.*)$/)
  if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
}

async function main() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    console.error('Missing KV_REST_API_URL or KV_REST_API_TOKEN in .env.local')
    process.exit(1)
  }

  const redis = new Redis({ url, token })

  // Scan for all bls:cpi:* keys
  let cursor = 0
  const keysToDelete: string[] = []
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: 'bls:cpi:*', count: 100 })
    cursor = typeof nextCursor === 'string' ? parseInt(nextCursor) : nextCursor
    keysToDelete.push(...keys)
  } while (cursor !== 0)

  // Also flush national CPI keys
  const [, natKeys] = await redis.scan(0, { match: 'bls:national:*', count: 100 })
  keysToDelete.push(...natKeys)

  if (keysToDelete.length === 0) {
    console.log('No CPI cache keys found.')
    return
  }

  console.log(`Found ${keysToDelete.length} keys to delete:`)
  for (const key of keysToDelete) {
    console.log(`  ${key}`)
  }

  // Delete all keys
  await Promise.all(keysToDelete.map(key => redis.del(key)))
  console.log(`Deleted ${keysToDelete.length} CPI cache keys.`)
}

main().catch(console.error)
