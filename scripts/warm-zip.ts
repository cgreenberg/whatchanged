/**
 * warm-zip.ts — warm the cache by calling the deployed /api/data/{zip} for each zip.
 *
 * Usage:
 *   npx tsx scripts/warm-zip.ts 98683 10001 ...
 *   BASE_URL=http://localhost:3000 npx tsx scripts/warm-zip.ts 06103
 *
 * Runs sequentially (one BLS batch per request) and reports which data sources
 * came back null. Exits non-zero if any request fails or returns a null source.
 */
export {} // module scope: keeps `main` from colliding with other scripts under tsc

const BASE_URL = (process.env.BASE_URL ?? 'https://www.whatchanged.us').replace(/\/$/, '')

/** Only https, or plain http to localhost (dev server). */
function assertSafeBaseUrl(raw: string): void {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    console.error(`BASE_URL is not a valid URL: ${raw}`)
    process.exit(1)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    console.error(`BASE_URL must be https:// (or http://localhost): ${raw}`)
    process.exit(1)
  }
}

async function main() {
  assertSafeBaseUrl(BASE_URL)
  const zips = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a))
  if (!zips.length) {
    console.error('Usage: npx tsx scripts/warm-zip.ts <zip> [zip ...]')
    process.exit(1)
  }
  let bad = 0
  for (const zip of zips) {
    try {
      const res = await fetch(`${BASE_URL}/api/data/${zip}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const missing = ['cpi', 'gas'].filter((k) => !json?.[k]?.data)
      if (missing.length) bad++
      console.log(`${zip}  ${missing.length ? `MISSING ${missing.join(', ')}` : 'ok'}`)
    } catch (e) {
      bad++
      console.log(`${zip}  FAIL ${(e as Error).message}`)
    }
  }
  if (bad) process.exit(1)
}

main()
