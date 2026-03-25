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

- **Next.js 16** (`next@16.1.7`, App Router) — framework, server components, API routes
- **React 19** (`react@19.2.3`) — UI
- **Tailwind CSS** — utility-first styling
- **Framer Motion** — animated number counters, staggered card reveals, transitions
- **Recharts** — all time-series charts (Area, Line, ReferenceArea for era shading)
- **Leaflet.js + OpenStreetMap** — interactive zip code map, lazy loaded on scroll
- **Satori** — server-side PNG generation for share cards
- **Vercel** — hosting, serverless API routes, preview deploys on every PR
- **Upstash Redis** — REST-based cache (`@upstash/redis` client)
- **TypeScript** — all new code
- **Prettier + ESLint** — formatting and linting
- **Playwright** — end-to-end testing

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

## Data Pipeline

```
User enters zip code
  ↓
Client calls /api/data/{zip}
  ↓
Server-side:
  1. zip → county FIPS (bundled HUD USPS crosswalk JSON, instant)
  2. county FIPS → CPI metro area (county-metro-cpi.ts mappings)
  3. county FIPS → EIA gas region (eia-gas.ts mappings)
  4. Check Upstash Redis for each data source (per-source cache keys)
  5. Cache miss → fetch BLS + EIA + USASpending IN PARALLEL (Promise.all)
  6. Cache hit on national data (shared keys, rarely misses)
  7. Store results in Redis with per-source TTLs
  8. Census ACS data served from bundled static JSON (no API call)
  9. Tariff estimate = median_local_income × 0.0205 (computed, not fetched)
  ↓
Return JSON to client → render cards + charts
```

## API Source Details

### BLS (Bureau of Labor Statistics)

**API Key:** `process.env.BLS_API_KEY` | **Rate limit:** 500 req/day with key
**Base URL:** `https://api.bls.gov/publicAPI/v2/timeseries/data/`

- **LAUS (unemployment):** Series `LAUCN{FIPS}0000000000003` — county-level
- **CPI (groceries):** Metro-level food subcategory series
- **CPI (shelter):** Metro-level shelter subcategory series
- **CPI (energy):** Metro-level energy subcategory series

**Critical:** Batch multiple series in one POST call. Never make separate calls per series.

### EIA (Energy Information Administration)

**API Key:** `process.env.EIA_API_KEY` | Weekly retail gasoline prices
**Geo level:** PAD District / state / city (not county)

### USASpending

**Endpoint:** `/api/usaspending` wraps `api.usaspending.gov` | County-level federal cuts since Jan 20, 2025

### Census ACS

**API Key:** `process.env.CENSUS_API_KEY` (build script only — `scripts/build-census-acs.ts`, not runtime)
**Data:** Median household income, median rent — ZIP level, bundled as static JSON

### Tariff Estimate

**Formula:** `median_local_income × 0.0205` | Source: Yale Budget Lab | Always labeled as estimate

## Critical Rules

- **NEVER hardcode API keys** — all secrets in Vercel env vars only
- **National CPI = shared cache key** — never fetch national data per-zip
- **BLS rate limit: 500/day** — batch series in one call
- **Jan 20 2025 baseline** — not Jan 1, not today
- **Sanity check all numbers** — unemployment 0–25%, CPI -20% to +50%, gas $1–$10
- **Never show blank cards** — always: real data, skeleton, or "Data unavailable"
- **No partisan framing** — data + sources only, let numbers speak

## Cache Architecture

**Client:** `src/lib/cache/kv.ts` | **Env vars:** `KV_REST_API_URL`, `KV_REST_API_TOKEN`
**Fallback:** In-memory Map for local dev / tests without Redis

### Cache Key Patterns

| Key Pattern                     | TTL      | Scope                               |
| ------------------------------- | -------- | ----------------------------------- |
| `bls:unemployment:{countyFips}` | 7 days   | Per county                          |
| `bls:cpi:{cpiAreaCode}:all`     | 7 days   | Per metro (covers national + metro) |
| `eia:gas:city:{duoarea}`        | 24 hours | Per EIA city                        |
| `eia:gas:state:{state}`         | 24 hours | Per state                           |
| `eia:gas:pad:{pad}`             | 24 hours | Per PAD district                    |
| `eia:gas:national`              | 24 hours | Shared                              |
| `usaspending:cuts:{countyFips}` | 24 hours | Per county                          |

**CRITICAL:** National CPI data is shared across ALL zips. Never fetch national data per-zip.

### Cache Warming

**Preload script:** `scripts/preload-cache.ts` — bulk-loads gas (24 series), national CPI, top 50 counties
**Warm-cache cron:** `/api/warm-cache` endpoint — 19 representative zips (all PAD districts + major CPI metros)
**Schedule (cron-job.org):** Monday 7am ET (gas update) + 15th of month (BLS update)

## Geo Mapping

The mapping chain `zip → county FIPS → CPI metro area → EIA gas region` is where most bugs come from.

### Key Mapping Files

1. **`src/lib/mappings/county-metro-cpi.ts`** — `STATE_TO_CPI_AREA`, `COUNTY_CPI_OVERRIDES`
2. **`src/lib/mappings/eia-gas.ts`** — `CPI_TO_EIA_CITY`, `COUNTY_EIA_CITY_OVERRIDES`, `STATE_LEVEL_CODES`
3. **`src/lib/mappings/state-fips.ts`** — state FIPS codes

### Diagnosing Mapping Bugs

```bash
npx tsx scripts/audit-zip-mappings.ts
```

Audits all 33,780 zips — flags missing CPI overrides, gas tier downgrades, unmapped counties.
**Fix:** Add county FIPS to `COUNTY_CPI_OVERRIDES` or `COUNTY_EIA_CITY_OVERRIDES`, re-run audit.

## Hero Cards (4, in order)

1. Gas Prices — EIA, $/gal, dollar change since Jan 2025
2. Housing Costs — BLS CPI shelter, % change + dollar translation (median rent × change)
3. Grocery Prices — BLS CPI food, % change + dollar translation (~$6k/yr × change)
4. Tariff Impact — Yale Budget Lab estimate (median_income × 0.0205), labeled as estimate

## Charts (5)

Gas Prices, Grocery Prices, Housing Costs, Energy Costs, Unemployment Rate
Each has: time toggles (Jan 2025 | 3Y | 5Y | 10Y), "Show national" checkbox, era shading (Biden blue / Trump II red via Recharts ReferenceArea)

### Era Shading (ReferenceArea)

- Biden (Jan 20 2021 → Jan 19 2025): `rgba(59, 130, 246, 0.07)` blue
- Trump II (Jan 20 2025 → present): `rgba(239, 68, 68, 0.07)` red

**Gotchas:** `<ReferenceArea>` MUST be placed BEFORE `<Line>` components (z-index). x1/x2 must match exact data timestamp format. Use `ifOverflow="visible"`.

## Share Image

1200×630px PNG via Satori. Four quadrants: gas (sparkline), groceries (sparkline), shelter (sparkline), tariffs (big number + monthly breakdown, no chart).

## Data Validation

### Sanity Ranges

- Unemployment: 0–25% | CPI changes: -20% to +50% | Gas: $1–$10/gal
- Outside ranges → "Data unavailable" (never show nonsense numbers)

### Freshness & Baseline

- Cached data >30 days old → warning badge
- Never blank cards → real data, skeleton, or "Data not available for this area"
- % change from **Jan 20, 2025** baseline, NOT latest monthly delta
- Dollar translation uses **local** median income/spend, NOT national
- Source date = date of actual data, NOT today's date
- Geo level label must be accurate (county vs metro vs state vs national)

## API Error Handling

- BLS 429 (rate limit) → serve cached data + warning badge
- Timeout (>5s) → skeleton + "Taking longer than usual..."
- Malformed response → log error, "Data unavailable" card, never crash
- Missing FIPS mapping → state-level fallback, or "Detailed local data not available"

## Test Zips

| Zip   | Tests                                                 |
| ----- | ----------------------------------------------------- |
| 98683 | Vancouver WA — primary test, all data populates       |
| 10001 | NYC — large metro, high rent, good CPI coverage       |
| 60601 | Chicago — manufacturing exposure                      |
| 73301 | Austin TX — above-avg electricity → energy card shows |
| 90210 | Beverly Hills — high income, tariff scaling           |
| 04101 | Portland ME — small metro, sparse data                |
| 00601 | PR — no BLS county data, graceful failure             |
| 99999 | Invalid — clean error, no crash                       |

## Commands

```
npm run dev          # local dev
npm run build        # production build
npm test             # run tests
npm run lint         # lint
npx playwright test  # e2e tests
npx tsx scripts/audit-zip-mappings.ts  # audit all zip mappings
npx tsx scripts/preload-cache.ts       # warm Redis cache
npx lighthouse https://www.whatchanged.us --only-categories=performance
```

## Performance Targets

- **Lighthouse mobile: 90+** (check after significant changes)
- First Contentful Paint: <1.5s
- Data load after zip entry: <1.5s (parallel fetches + cache)
- Skeleton loaders on all cards during fetch
- Leaflet map: lazy loaded on scroll
- Never block initial render for API data

## Deploy

Push to `main` → Vercel auto-deploys. PRs get preview URLs.

## Environment Variables

All in Vercel dashboard, never in code:

- `BLS_API_KEY`
- `EIA_API_KEY`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `CENSUS_API_KEY` (build script only — `scripts/build-census-acs.ts`)

## Repository Structure

```
src/
  app/                        # Next.js App Router pages + API routes
    api/
      card-image/             # Satori share image generation
      city-search/            # City name autocomplete
      data/                   # Main data endpoint (/api/data/{zip})
      geocode/                # Lat/lng → zip reverse geocoding
      health/                 # Health check
      og/                     # Open Graph image
      share/                  # Share URL generation
      warm-cache/             # Cache warming cron endpoint
  components/
    CityGrid.tsx              # City grid display
    DigDeeper.tsx              # Dig deeper section
    ErrorBoundary.tsx          # Error boundary
    HomeContent.tsx            # Main home content
    LocationBanner.tsx         # Location display banner
    ShareButton.tsx            # Share button
    ShareModal.tsx             # Share modal dialog
    StatCard.tsx               # Stat card component
    StatCardSkeleton.tsx       # Loading skeleton
    TariffWidget.tsx           # Tariff estimate widget
    ZipInput.tsx               # Zip code input
    charts/                   # Chart components
    map/                      # Leaflet map components
  lib/
    api/                      # API client modules
      bls.ts                  # BLS LAUS (unemployment)
      bls-cpi.ts              # BLS CPI (groceries, shelter, energy)
      eia.ts                  # EIA gas prices
      usaspending.ts          # USASpending federal cuts
      snapshot.ts             # Snapshot generation
      source-registry.ts     # Source metadata registry
      sources.ts              # Source URL/name helpers
    cache/
      kv.ts                   # Upstash Redis client (+ in-memory fallback)
    charts/
      chart-config.ts         # Chart configuration
      trendline.ts            # Trendline calculations
    mappings/
      county-metro-cpi.ts     # County → CPI metro area mappings
      eia-gas.ts              # County → EIA gas region mappings
      state-fips.ts           # State FIPS codes
    share-card/
      fonts.ts                # Share card fonts
      generate.tsx            # Share card generation
      sparklines.tsx          # Sparkline rendering
    city-search.ts            # City search logic
    geocode.ts                # Geocoding utilities
    tariff.ts                 # Tariff calculation
    data/
      (bundled JSON)          # HUD crosswalk, Census ACS data
scripts/
  add-city-names.ts           # Add city names to data
  audit-zip-mappings.ts       # Audit all 33,780 zips for mapping gaps
  build-census-acs.ts         # Build Census ACS static data
  flush-cpi-cache.ts          # Flush CPI cache entries
  preload-cache.ts            # Warm Redis with gas + BLS + unemployment
  process-crosswalk.ts        # Process HUD crosswalk data
  publish-audit.sh            # Publish audit results
audit/
  src/main.py                 # Independent data verification (Python)
  AUDIT_RULES.md              # Audit isolation rules
.claude/
  rules/
    orchestration.md          # Agent orchestration rules
    code-review.md            # Review agent prompts
```

## Code Standards

TypeScript, functional React + hooks, 2-space indent, Prettier + ESLint.

## Code Review

Run 3 review agents in parallel before committing (logic, security, data accuracy). All must PASS. See `.claude/rules/code-review.md`.

## Audit System

`audit/` directory — independent Python verification. MUST NOT import main codebase code. Read `audit/AUDIT_RULES.md` before touching.

## Known Issues

- Location banner sometimes redundant ("Clark County, WA — Clark County") → should use city name from zip lookup
- Zip/city mapping gaps are the #1 recurring bug source → run `npx tsx scripts/audit-zip-mappings.ts`

## What NOT To Build

- No user accounts / login
- No ads
- No comment sections
- No explicit partisan framing

## MCP Servers (Claude Code)

- **Context7** — real-time docs for Next.js, Recharts, Leaflet, Tailwind
- **GitHub MCP** — repo management
- **Playwright MCP** — visual testing

## Shell Command Notes

- Never use `node -e` with inline multiline strings (causes permission prompt issues)
- Write utility scripts to `/scripts/` and run as files instead
