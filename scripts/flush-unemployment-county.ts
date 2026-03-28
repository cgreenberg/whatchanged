// Flush unemployment cache for a specific county FIPS from Upstash Redis
// Usage: npx tsx scripts/flush-unemployment-county.ts [fips]
// Default FIPS: 06053 (Monterey County, CA)

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Redis } from '@upstash/redis'

// Load .env.local — check current dir first, then parent (for worktree support)
function loadEnv() {
  const candidates = [
    join(process.cwd(), '.env.local'),
    join(process.cwd(), '..', '..', '..', '.env.local'), // worktree → main repo
    join(__dirname, '..', '.env.local'),
    join(__dirname, '..', '..', '.env.local'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      console.log(`Loading env from: ${candidate}`)
      const envFile = readFileSync(candidate, 'utf-8')
      for (const line of envFile.split('\n')) {
        const match = line.match(/^(\w+)=(.*)$/)
        if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
      }
      return
    }
  }
  console.warn('No .env.local found — relying on existing process.env')
}

loadEnv()

async function main() {
  const fips = process.argv[2] ?? '06053'
  console.log(`Target county FIPS: ${fips}`)

  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    console.error('Missing KV_REST_API_URL or KV_REST_API_TOKEN in environment')
    process.exit(1)
  }

  const redis = new Redis({ url, token })

  const keysToDelete = [
    `bls:unemployment:${fips}`,
    `bls:unemployment:${fips}:failed`,
  ]

  for (const key of keysToDelete) {
    console.log(`Deleting key: ${key}`)
    const result = await redis.del(key)
    console.log(`  → ${result === 1 ? 'deleted (existed)' : 'not found (already absent)'}`)
  }

  console.log('Done. Unemployment cache flushed for FIPS', fips)
}

main().catch(console.error)
