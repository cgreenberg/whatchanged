// Flush Connecticut unemployment cache keys from Upstash Redis
// CT old county FIPS codes (09001–09015) that appear in the HUD crosswalk
// Usage: npx tsx scripts/flush-ct-unemployment.ts

import { readFileSync } from 'fs'
import { Redis } from '@upstash/redis'

// Load .env.local manually
const envFile = readFileSync('.env.local', 'utf-8')
for (const line of envFile.split('\n')) {
  const match = line.match(/^(\w+)=(.*)$/)
  if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
}

const CT_COUNTY_FIPS = [
  '09001',
  '09003',
  '09005',
  '09007',
  '09009',
  '09011',
  '09013',
  '09015',
]

async function main() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    console.error('Missing KV_REST_API_URL or KV_REST_API_TOKEN in .env.local')
    process.exit(1)
  }

  const redis = new Redis({ url, token })

  // Build the full list of keys to delete: normal + negative cache
  const keysToDelete: string[] = []
  for (const fips of CT_COUNTY_FIPS) {
    keysToDelete.push(`bls:unemployment:${fips}`)
    keysToDelete.push(`bls:unemployment:${fips}:failed`)
  }

  console.log(`Checking ${keysToDelete.length} keys...`)

  // Check which keys actually exist before deleting
  const existenceChecks = await Promise.all(keysToDelete.map(key => redis.exists(key)))
  const existingKeys = keysToDelete.filter((_, i) => existenceChecks[i] === 1)

  if (existingKeys.length === 0) {
    console.log('No CT unemployment cache keys found in Redis.')
    return
  }

  console.log(`Found ${existingKeys.length} existing keys to delete:`)
  for (const key of existingKeys) {
    console.log(`  ${key}`)
  }

  await Promise.all(existingKeys.map(key => redis.del(key)))
  console.log(`\nDeleted ${existingKeys.length} CT unemployment cache keys.`)

  // Report which keys were absent
  const absentKeys = keysToDelete.filter((_, i) => existenceChecks[i] !== 1)
  if (absentKeys.length > 0) {
    console.log(`\n${absentKeys.length} keys were not present in cache (already absent):`)
    for (const key of absentKeys) {
      console.log(`  ${key}`)
    }
  }
}

main().catch(console.error)
