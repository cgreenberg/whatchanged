/**
 * flush-keys.ts — list (and optionally delete) Upstash Redis keys matching a glob.
 *
 * Usage:
 *   npx tsx scripts/flush-keys.ts 'bls:cpi:*'            # dry run: lists matches
 *   npx tsx scripts/flush-keys.ts 'bls:cpi:*' --yes   # deletes them
 *   ... --include-lastgood                                # also delete `:lastgood` copies
 *
 * Prefer re-running `npm run cache:refresh` (overwrites keys in place) to flushing.
 * A flushed key is re-fetched on the next request, charged to the runtime daily
 * upstream budget (kv.ts); over budget it serves the `:lastgood` copy. That copy
 * is therefore EXCLUDED from deletion unless --include-lastgood is passed —
 * deleting it removes the fallback that keeps cards populated during an outage.
 * Matching `:failed` negative-cache entries are deleted too (glob ending in `*`).
 * Patterns are logical keys; the `wc3:` namespace prefix (KEY_PREFIX in kv.ts) is added
 * automatically, so only namespaced keys can ever match.
 * Needs KV_REST_API_URL and KV_REST_API_TOKEN (env or .env.local).
 */
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { Redis } from '@upstash/redis'
import { KEY_PREFIX, nsKey } from '../src/lib/cache/kv'

const envPath = resolve(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const yes = args.includes('--yes')
  const includeLastGood = args.includes('--include-lastgood')
  const logicalPattern = args.find((a) => !a.startsWith('--'))
  // Every key the app writes lives under KEY_PREFIX (kv.ts); patterns are given as logical keys.
  const pattern = logicalPattern && nsKey(logicalPattern)
  if (!logicalPattern || !pattern) {
    console.error("Usage: npx tsx scripts/flush-keys.ts '<glob-pattern>' [--yes] [--include-lastgood]")
    process.exit(1)
  }
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    console.error('Missing KV_REST_API_URL or KV_REST_API_TOKEN')
    process.exit(1)
  }
  const redis = new Redis({ url, token })

  const matched: string[] = []
  let cursor: string | number = 0
  do {
    const [next, batch]: [string | number, string[]] = await redis.scan(cursor, { match: pattern, count: 200 })
    matched.push(...batch)
    cursor = typeof next === 'string' ? parseInt(next, 10) : next
  } while (cursor !== 0)

  const keys = includeLastGood ? matched : matched.filter((k) => !k.endsWith(':lastgood'))
  const skipped = matched.length - keys.length
  console.log(`${keys.length} key(s) match "${pattern}"`)
  if (skipped) console.log(`(${skipped} :lastgood copies kept — pass --include-lastgood to delete them too)`)
  for (const k of keys.sort()) console.log(`  ${k}`)
  if (!keys.length) return
  if (!yes) {
    console.log('\nDry run. Re-run with --yes to delete.')
    return
  }
  for (let i = 0; i < keys.length; i += 100) await redis.del(...keys.slice(i, i + 100))
  console.log(`\nDeleted ${keys.length} key(s).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
