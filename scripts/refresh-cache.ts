#!/usr/bin/env npx tsx
/**
 * refresh-cache.ts — preload EVERY upstream series the site can request into
 * Upstash Redis, using the app's own fetch/parse/validate code, cache keys,
 * TTLs and envelope format (src/lib/api/refresh.ts → kv.writeEnvelope).
 *
 * Run by .github/workflows/refresh-cache.yml (weekly + after BLS releases).
 *
 *   npm run cache:refresh                      # full refresh → Upstash (needs KV_* env)
 *   npm run cache:refresh -- --dry-run         # fetch + validate, write to in-memory only
 *   npm run cache:refresh -- --only=gas        # just one source: cpi | gas | electricity | heating
 *   npm run cache:refresh -- --zips=98683,10001  # only the areas behind these zips
 *   npm run cache:refresh -- --force           # run even if a full refresh succeeded < 12h ago
 *
 * A full (non-dry-run, no --only/--zips) run is skipped when Redis key
 * `refresh:last-success` is less than 12h old, so two schedules landing on the
 * same day do not spend the BLS quota twice. A successful full run records it.
 * A full run is also skipped when another full run STARTED < 2h ago
 * (`refresh:last-attempt`), so a failed run plus a coinciding cron cannot
 * spend the quota twice in a row. Areas with no usable upstream data get a
 * `{key}:missing` marker (21d) that stops the runtime re-fetching them.
 *
 * Env: BLS_API_KEY (required: 50 series/request needs a key), EIA_API_KEY,
 *      KV_REST_API_URL (https), KV_REST_API_TOKEN.
 * Never prints secrets. Exit 1 on any fetch or write error or any CPI/gas/electricity gap.
 * (County unemployment/LAUS is not refreshed: the site no longer fetches it.)
 */
import {
  planRefresh,
  planBlsRequests,
  runRefresh,
  summarize,
  parseRefreshArgs,
  planSize,
  shouldSkipRecentRun,
  REFRESH_LAST_SUCCESS_KEY,
  REFRESH_LAST_SUCCESS_TTL,
  REFRESH_LAST_ATTEMPT_KEY,
  REFRESH_LAST_ATTEMPT_TTL,
  REFRESH_ATTEMPT_INTERVAL_MS,
  type RefreshPlan,
} from '../src/lib/api/refresh'
import {
  isRedisConfigured,
  __setKvClientForTests,
  configureRedisTimeouts,
  getCached,
  setCached,
} from '../src/lib/cache/kv'

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}

/** Redis REST endpoint must be https (http allowed only for a local emulator). */
function assertSafeKvUrl(raw: string): void {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    fail('KV_REST_API_URL is not a valid URL')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    fail('KV_REST_API_URL must be https:// (or http://localhost)')
  }
}

async function main() {
  const args = parseRefreshArgs(process.argv.slice(2))
  if ('error' in args) fail(args.error)
  const { dryRun, force, only, zips } = args
  const isFullRun = !only && !zips

  // Gas includes the BLS monthly average-price tiers, so every source needs the BLS key.
  if (!process.env.BLS_API_KEY && only !== 'electricity' && only !== 'heating') fail('BLS_API_KEY is required (batches of 50 series need a registered key)')
  if (!process.env.EIA_API_KEY && only !== 'cpi') fail('EIA_API_KEY is required')

  if (dryRun) {
    __setKvClientForTests(null) // in-memory only: never touch Redis
  } else {
    const url = process.env.KV_REST_API_URL
    if (!url || !process.env.KV_REST_API_TOKEN) fail('KV_REST_API_URL and KV_REST_API_TOKEN are required (or pass --dry-run)')
    assertSafeKvUrl(url)
    if (!isRedisConfigured()) fail('Redis client not configured (NODE_ENV=test?)')
    // Batch job: tolerate slow writes, never skip Redis after one failure.
    configureRedisTimeouts({ callTimeoutMs: 10_000, downCooldownMs: 0 })
    if (isFullRun) {
      const last = await getCached<string>(REFRESH_LAST_SUCCESS_KEY)
      if (shouldSkipRecentRun(last, new Date(), force)) {
        console.log(`refresh-cache: last full refresh succeeded at ${last} (< 12h ago); skipping. Pass --force to run anyway.`)
        return
      }
      const attempt = await getCached<string>(REFRESH_LAST_ATTEMPT_KEY)
      if (shouldSkipRecentRun(attempt, new Date(), force, REFRESH_ATTEMPT_INTERVAL_MS)) {
        console.log(`refresh-cache: a full refresh started at ${attempt} (< 2h ago); skipping. Pass --force to run anyway.`)
        return
      }
      await setCached(REFRESH_LAST_ATTEMPT_KEY, new Date().toISOString(), REFRESH_LAST_ATTEMPT_TTL)
    }
  }

  const full = planRefresh(zips)
  const plan: RefreshPlan = {
    cpiAreas: !only || only === 'cpi' ? full.cpiAreas : [],
    gasLookups: !only || only === 'gas' ? full.gasLookups : [],
    electricityStates: !only || only === 'electricity' ? full.electricityStates : [],
    heating: !only || only === 'heating' ? full.heating : [],
    nyserda: (!only || only === 'heating') && !!full.nyserda,
  }
  if (planSize(plan) === 0) fail('Refresh plan is empty (check --zips / --only)')
  console.log(
    `refresh-cache${dryRun ? ' (dry run, in-memory)' : ''}: ` +
      `${plan.cpiAreas.length} CPI areas, ${plan.gasLookups.filter((l) => l.source !== 'bls').length} EIA gas series, ` +
      `${plan.gasLookups.filter((l) => l.source === 'bls').length} BLS gas series in ${planBlsRequests(plan).length} BLS requests, ` +
      `${plan.electricityStates?.length ?? 0} electricity series (states + US) in one paged EIA query, ` +
      `${plan.heating?.length ?? 0} heating fuel series (oil + propane, states + US) in one paged EIA query` +
      `${plan.nyserda ? ', NYSERDA NY heating oil (1 request)' : ''}`
  )

  const started = Date.now()
  const report = await runRefresh(plan)
  const s = summarize(report)

  for (const r of report.results) {
    if (r.status !== 'written') console.log(`  ${r.status.toUpperCase().padEnd(7)} ${r.key}  ${r.error ?? ''}`)
  }
  console.log(
    `\nSUMMARY written=${s.written} missing=${s.missing} invalid=${s.invalid} errors=${s.errors} ` +
      `blsCalls=${s.blsCalls} eiaCalls=${s.eiaCalls} otherCalls=${s.otherCalls} failedBatches=${s.failedBatches} ` +
      `(${Math.round((Date.now() - started) / 1000)}s)`
  )

  // Any fetch/write error or CPI/gas/electricity gap fails the run.
  if (s.errors || s.missing || s.invalid) process.exit(1)
  if (!dryRun && isFullRun) {
    await setCached(REFRESH_LAST_SUCCESS_KEY, new Date().toISOString(), REFRESH_LAST_SUCCESS_TTL)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
