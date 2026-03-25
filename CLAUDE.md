# CLAUDE.md — whatchanged.us

Read fully before touching any code.

## What This Is

A shareable web app: enter your zip code, see how local economic conditions changed since January 20, 2025. Designed to go viral on Facebook/Instagram via auto-generated share cards.

**Live:** https://www.whatchanged.us
**GitHub:** https://github.com/cgreenberg/whatchanged
**Tagline:** _Enter your zip code. See what changed since Jan 2025._

## Rules Files

Read at session start:

- `.claude/rules/orchestration.md` — task delegation, sub-agents, model selection
- `.claude/rules/code-review.md` — review agents (logic, security, data accuracy)

## Tech Stack

Next.js, Tailwind CSS, Framer Motion, Recharts, Leaflet.js, Vercel, Upstash Redis

## Data Sources

| Data         | Source          | Geo Level | Cache TTL |
| ------------ | --------------- | --------- | --------- |
| Unemployment | BLS LAUS        | County    | 7 days    |
| Grocery CPI  | BLS CPI         | Metro     | 7 days    |
| Shelter CPI  | BLS CPI         | Metro     | 7 days    |
| Gas prices   | EIA Weekly      | Region    | 24 hours  |
| Federal cuts | USASpending     | County    | 24 hours  |
| Income/rent  | Census ACS      | ZIP       | Static    |
| Tariff est.  | Yale Budget Lab | Derived   | Static    |

Zip → county FIPS via bundled HUD crosswalk (no API call).

## Critical Rules

- **NEVER hardcode API keys** — all secrets in Vercel env vars only
- **National CPI = shared cache key** — never fetch national data per-zip
- **BLS rate limit: 500/day** — batch series in one call
- **Jan 20 2025 baseline** — not Jan 1, not today
- **Sanity check all numbers** — unemployment 0–25%, CPI -20% to +50%, gas $1–$10
- **Never show blank cards** — always: real data, skeleton, or "Data unavailable"
- **No partisan framing** — data + sources only, let numbers speak

## Hero Cards (4, in order)

1. Gas Prices — EIA, $/gal, dollar change since Jan 2025
2. Housing Costs — BLS CPI shelter, % change + dollar translation (median rent × change)
3. Grocery Prices — BLS CPI food, % change + dollar translation (~$6k/yr × change)
4. Tariff Impact — Yale Budget Lab estimate (median_income × 0.0205), labeled as estimate

## Charts (5)

Gas Prices, Grocery Prices, Housing Costs, Energy Costs, Unemployment Rate
Each has: time toggles (Jan 2025 | 3Y | 5Y | 10Y), "Show national" checkbox, era shading (Biden blue / Trump II red via Recharts ReferenceArea)

## Share Image

1200×630px PNG via Satori. Four quadrants: gas (sparkline), groceries (sparkline), shelter (sparkline), tariffs (big number + monthly breakdown, no chart).

## Test Zips

98683 (Vancouver WA), 10001 (NYC), 60601 (Chicago), 73301 (Austin), 90210 (Beverly Hills), 04101 (Portland ME), 00601 (PR — graceful fail), 99999 (invalid — clean error)

## Commands

```
npm run dev          # local dev
npm run build        # production build
npm test             # run tests
npm run lint         # lint
npx playwright test  # e2e tests
npx tsx scripts/audit-zip-mappings.ts  # audit all zip mappings
npx tsx scripts/preload-cache.ts       # warm Redis cache
```

## Deploy

Push to `main` → Vercel auto-deploys. PRs get preview URLs. Target Lighthouse 90+ mobile.

## Code Standards

TypeScript, functional React + hooks, 2-space indent, Prettier + ESLint.

## Code Review

Run 3 review agents in parallel before committing (logic, security, data accuracy). All must PASS. See `.claude/rules/code-review.md`.

## Audit System

`audit/` directory — independent Python verification. MUST NOT import main codebase code. Read `audit/AUDIT_RULES.md` before touching.
