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
**Geo level:** PAD District / sub-district / state / city (not county)
**Base URL:** `https://api.eia.gov/v2/petroleum/pri/gnd/data/`

EIA publishes exactly **29 duoarea codes** for product EPM0 (retail gasoline):
- **10 city codes:** YBOS, Y35NY, YMIA, YORD, YCLE, Y44HO, YDEN, Y05LA, Y05SF, Y48SE
- **9 state codes:** SCA, SCO, SFL, SMA, SMN, SNY, SOH, STX, SWA (no other states available)
- **7 PAD codes:** R1X (1A New England), R1Y (1B Central Atlantic), R1Z (1C Lower Atlantic), R20, R30, R40, R50
- **2 special:** NUS (national), R5XCA (PAD 5 except CA)
- **1 aggregate:** R10 (all of PAD 1 — don't use, prefer sub-districts)

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

The mapping chain `zip → county FIPS → CPI metro area → EIA gas region` is where most bugs come from. **Each data source resolves geography differently:**

| Data Source     | Geo Resolution                                          | Mapping Chain                                                    |
| --------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| Gas prices      | EIA 3-tier (county → CPI→city → state → PAD)            | `getGasLookup(state, cpiArea, countyFips)` in `eia.ts`          |
| Groceries       | BLS CPI metro area                                      | `getMetroCpiAreaForCounty()` → `CUUR{area}SAF11`                |
| Shelter         | Same CPI metro area                                     | `getMetroCpiAreaForCounty()` → `CUUR{area}SAH1`                 |
| Energy          | Same CPI metro area                                     | `getMetroCpiAreaForCounty()` → `CUUR{area}SA0E`                 |
| Unemployment    | County FIPS directly                                    | `LAUCN{fips}0000000003` — no metro/state mapping                |
| Tariff estimate | ZIP-level Census income × 0.0205                        | No geo mapping beyond ZIP                                        |

### EIA Gas 3-Tier Lookup (`getGasLookup`)

1. **Tier 1a:** `COUNTY_EIA_CITY_OVERRIDES[countyFips]` — direct county → city/region
2. **Tier 1b:** `CPI_TO_EIA_CITY[cpiAreaCode]` — CPI metro → EIA city
3. **Tier 2:** `STATE_LEVEL_CODES[state]` — state-level average (9 states only)
4. **Tier 3:** `STATE_TO_PAD[state]` → PAD district/sub-district fallback

**PAD 1 Sub-Districts:** PAD 1 (East Coast) is split into 3 sub-districts with different duoarea codes:
- **1A New England** (CT, ME, MA, NH, RI, VT) → `R1X`
- **1B Central Atlantic** (DE, DC, MD, NJ, NY, PA) → `R1Y`
- **1C Lower Atlantic** (FL, GA, NC, SC, VA, WV) → `R1Z`

PADs 2–5 have no sub-districts.

### Common Mapping Pitfalls

- **CPI→gas chain leaking across PAD districts:** If state A borrows a CPI metro from state B (e.g., Idaho using Seattle CPI), and that CPI metro has an EIA city mapping, state A gets state B's city gas prices — potentially from a completely different PAD district. Fix: add county-level gas overrides (Tier 1a) to intercept before the CPI→city lookup.
- **Cross-state CPI→city drag:** Louisiana uses Houston CPI (reasonable), but this chains to Houston city gas (wrong — LA should get Gulf Coast PAD 3). Fix: add parish-level gas overrides.
- **Upstate cities getting metro-city gas:** All NY counties inherit CPI area S12A → Y35NY (NYC gas). Buffalo/Rochester/Syracuse need county overrides → SNY (NY state avg).
- **PAD district assignments:** Always verify against the official EIA PADD page at `eia.gov/petroleum/weekly/includes/padds.php`. Oklahoma is PAD 2 (Midwest), not PAD 3.

### Key Mapping Files

1. **`src/lib/mappings/county-metro-cpi.ts`** — `STATE_TO_CPI_AREA`, `COUNTY_CPI_OVERRIDES`, `BLS_CPI_AREAS`
2. **`src/lib/mappings/eia-gas.ts`** — `CPI_TO_EIA_CITY`, `COUNTY_EIA_CITY_OVERRIDES`, `STATE_LEVEL_CODES`, `STATE_TO_PAD`, `PAD_DUOAREA`
3. **`src/lib/mappings/state-fips.ts`** — state FIPS codes

### Diagnosing Mapping Bugs

```bash
npx tsx scripts/audit-zip-mappings.ts        # offline audit of all 33,780 zips
npx tsx scripts/verify-mappings-live.ts      # live API verification of all codes
```

**Offline audit:** Flags missing CPI overrides, gas tier downgrades, unmapped counties. Makes no API calls.
**Live verification:** Hits EIA + BLS APIs to confirm every duoarea code, CPI series, and LAUS series actually returns data. Exits non-zero on any failure. Requires `EIA_API_KEY` and optionally `BLS_API_KEY`.
**250-city test:** `tests/unit/city-mapping-audit.test.ts` — tests top 5 cities per state across CPI, gas, BLS series IDs, and LAUS series. Run with `npm test`.

**Fix:** Add county FIPS to `COUNTY_CPI_OVERRIDES` or `COUNTY_EIA_CITY_OVERRIDES`, re-run audit + tests.

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
npm test             # run tests (includes 250-city mapping audit)
npm run lint         # lint
npx playwright test  # e2e tests
npx tsx scripts/audit-zip-mappings.ts    # offline audit of all 33,780 zip mappings
npx tsx scripts/verify-mappings-live.ts  # live API verification of all mapping codes
npx tsx scripts/preload-cache.ts         # warm Redis cache
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
  audit-zip-mappings.ts       # Offline audit of all 33,780 zips for mapping gaps
  verify-mappings-live.ts     # Live API verification of all EIA/BLS mapping codes
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
- **Connecticut FIPS broken for unemployment:** CT abolished counties in 2022, replaced with Planning Council Regions (FIPS 09110–09190). The HUD crosswalk still uses old county FIPS (09001–09015), so all CT LAUS unemployment series return "series does not exist" from BLS. Needs a crosswalk from old → new FIPS in the zip lookup or BLS fetch layer.
- Hawaii and Alaska get PAD 5 "West Coast avg" for gas — EIA has no state-level codes for HI/AK, and prices differ significantly ($1+/gal) from mainland West Coast. No fix available without EIA publishing those series.

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
