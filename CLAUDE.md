# CLAUDE.md — whatchangedus.vercel.app

This file is read by Claude Code at the start of every session.
Read it fully before touching any code.

---

## What This Project Is

A fast, beautiful, shareable web app where anyone enters their zip code and sees a
visual snapshot of how local economic conditions have changed since January 20, 2025.
Designed to go viral on Facebook via auto-generated shareable image cards.

**Live site:** https://whatchangedus.vercel.app (this will change to https://www.whatchanged.us)
**GitHub:** https://github.com/cgreenberg/whatchanged
**Tagline:** _Enter your zip code. See what changed since Jan 2025._

---

## Tech Stack

- **Next.js** (React) — framework
- **Tailwind CSS** — styling
- **Framer Motion** — animations, number counters, staggered reveals
- **Recharts** — all charts (area, line)
- **Leaflet.js + OpenStreetMap** — zip code map, lazy loaded
- **Vercel** — hosting, serverless API routes
- **Vercel KV** — Redis caching layer (see caching section)

---

## Data Sources

### Zip → Geography

- HUD USPS Zip-County crosswalk — static JSON bundled in repo
- Maps any zip → county FIPS code — no API call needed
- Most data is county-level or metro-level, NOT zip-level

### API Sources

| Data            | Source      | Series / Endpoint         | Geo Level | Cache TTL       |
| --------------- | ----------- | ------------------------- | --------- | --------------- |
| Unemployment    | BLS LAUS    | LAUCN{FIPS}0000000000003  | County    | 7 days          |
| Grocery CPI     | BLS CPI     | Metro food subcategory    | Metro     | 7 days          |
| Shelter CPI     | BLS CPI     | Metro shelter subcategory | Metro     | 7 days          |
| Gas prices      | EIA Weekly  | Regional retail gas       | Region    | 24 hours        |
| Federal cuts    | USASpending | /api/usaspending          | County    | 24 hours        |
| Income/rent     | Census ACS  | api.census.gov            | ZIP       | Static (annual) |
| Tariff estimate | Derived     | Yale Budget Lab formula   | Derived   | Static          |

### National vs Local Caching — CRITICAL

- National CPI data is SHARED across all zips — one cache key for all of America
- County data is per-FIPS
- Never fetch national data per-zip — this wastes BLS API quota

```
Cache key structure:
  bls-national-cpi          TTL: 7 days  (shared all zips)
  bls-county-{fips}         TTL: 7 days
  eia-gas-{region}          TTL: 24 hours
  usaspending-county-{fips} TTL: 24 hours
```

### BLS API

- Free key registered — stored in Vercel environment variables as BLS_API_KEY
- Rate limit: 500 requests/day with key
- Batch multiple series in one call — never make separate calls per series
- NEVER hardcode the API key in any git-commited file

### Environment Variables

All secrets live in Vercel dashboard, never in code. Reference as:

- `process.env.BLS_API_KEY`
- `process.env.CENSUS_API_KEY`
- `process.env.EIA_API_KEY`
- `process.env.KV_URL`
- `process.env.KV_REST_API_URL`
- `process.env.KV_REST_API_TOKEN`

---

## Hero Stat Cards (Top Row)

Four cards, shown in this order. Each shows a big number + change since Jan 20 2025:

1. **UNEMPLOYMENT RATE** — BLS LAUS, county-level, most specific data on the page
2. **GROCERY PRICES** — BLS CPI food subcategory, metro-level
3. **SHELTER COSTS** — BLS CPI shelter subcategory, metro-level
4. **FEDERAL $ LOST** — USASpending contracts/grants cancelled since Jan 20 2025, county

### Card format

- Big bold number (animated counter on load)
- Dollar translation: convert % changes to estimated annual dollar impact
  - Groceries: median local grocery spend (~$6,000/yr) × % change
  - Shelter: median local rent × % change
- Source + date + geo level shown small at bottom of each card
- NO redundant sublines — if hero number IS the % change, don't repeat it below

---

## Charts Section

### Time Toggles

Every chart has: **Jan 2025 | 3Y | 5Y | 10Y**
Default view: **Jan 2025** (shows from Jan 20 2025 to present)
5Y is the most informative — shows full COVID + Biden + Trump II arc

### Era Shading — CRITICAL DESIGN DECISION

Every chart gets colored background bands:

- **Biden era** (Jan 20 2021 → Jan 19 2025): `rgba(59, 130, 246, 0.07)` blue tint
- **Trump II era** (Jan 20 2025 → present): `rgba(239, 68, 68, 0.07)` red tint
- Thin vertical line + small label at each inauguration date

### Implementation

- Use Recharts `<ReferenceArea>` for era shading
- `ReferenceArea` must be placed BEFORE `<Line>` components or it covers the lines
- x1/x2 must match exact data timestamp format — mismatch silently renders nothing
- Use `ifOverflow="visible"` to prevent clipping

### "Show National" Toggle

Every chart has a checkbox to overlay the national average as a dashed line.
This is one of the most useful features — local vs national comparison is compelling.

### Charts to show

1. Gas Prices — EIA, line chart, $/gal
2. Grocery Prices — BLS CPI, line chart, % change
3. Shelter Costs — BLS CPI, line chart, % change
4. Unemployment Rate — BLS LAUS, line chart, %
5. Energy Costs — context-aware (see below)

### Energy Costs — Context-Aware Display

Washington state has cheapest electricity in continental US (hydropower).
Energy is boring there. But it's a major story in TX, CA, New England, Southeast.

**Rule:** If state's average retail electricity price (from EIA) is ABOVE national
average → show Energy as a hero card.
If BELOW national average → show only in charts section, not hero row.

---

## Tariff Impact Estimate

Shown as a callout card below the charts:

> "Based on your area's median income of $83,821, tariffs are estimated to cost
> your household ~$1,702 this year."

Formula: `median_local_income × 0.0205` (Yale Budget Lab's ~2% of income estimate)
Always show the source citation with link to Yale Budget Lab.
Always label as "rough estimate" — this is a projection, not measured data.

---

## Shareable Card

Auto-generated PNG (1200×630px, Facebook optimal size):

```
📍 Vancouver, WA  (98683)

Unemployment  ↑ 5.0%  (+1.4 pts since Jan 2025)
Groceries     ↑ +X%   since Jan 2025
Shelter       ↑ +3.5% since Jan 2025
Federal $     ↓ $4.2M cut since Jan 20, 2025

whatchangedus.vercel.app — enter your zip [this will change to whatchanged.us]
```

Use Satori (Vercel's OG image library) to generate server-side.
"Share Your Results" button triggers native share sheet on mobile,
clipboard copy on desktop.

---

## Performance Requirements

- Lighthouse mobile score: 90+
- First Contentful Paint: <1.5s
- Data load after zip entry: <1.5s (parallel fetches + KV cache)
- Skeleton loaders on all cards while data fetches
- Leaflet map is LAZY LOADED — only renders when user scrolls to it
- Never block initial render waiting for API data

---

## Known Issues / Active Bugs

- "Clark County, WA — Clark County" location banner is redundant
  → should be "Vancouver, WA — Clark County" using city name from zip lookup
- Grocery hero card showing negative % may be latest monthly delta, not
  cumulative since Jan 2025 — verify BLS series calculation
- Gas price ($4.88/gal) seems high for WA state — verify EIA regional series ID

---

## What NOT To Build

- No user accounts or login
- No ads (kills credibility and Facebook reach)
- No comment sections
- No explicit partisan framing — data only, all sources cited
- No zip code comparison feature (possible v2)
- No PDF export

---

## Tone & Framing

The site is nonpartisan. It shows economic data with sources.
It does NOT tell users what to think or who to blame.
Every number shows: source name, date, geographic level.
Projections (tariff estimates) are always labeled as projections.
The blue/red era shading is informational context, not editorializing.

---

## Caching Architecture

```
User requests zip 98683
  → zip-to-FIPS lookup (instant, static JSON)
  → Check Vercel KV for cached county data (TTL: 7 days)
  → Cache miss: fetch BLS + EIA + USASpending IN PARALLEL (Promise.all)
  → Cache hit on national CPI (shared, rarely misses after first request)
  → Store results in KV
  → Return to client
  → Census ACS data served from bundled static JSON (instant, no API call)
```

Pre-warming: /api/warm-cache endpoint pre-fetches top 200 zips by population.
Triggered daily by cron-job.org (external free cron) pointing at that endpoint.

---

## Testing & Validation

### Before Every Deploy — Run These Zip Codes

Always test this specific set before pushing. They cover the main edge cases:

| Zip     | Why                                                                           |
| ------- | ----------------------------------------------------------------------------- |
| `98683` | Vancouver WA — primary dev test case, all data should populate                |
| `10001` | Manhattan NYC — large metro, high rent, good CPI coverage                     |
| `60601` | Chicago IL — large metro, manufacturing jobs exposure                         |
| `73301` | Austin TX — fast-growing, above-average electricity = energy card should show |
| `90210` | Beverly Hills CA — high income, tests tariff estimate scaling                 |
| `04101` | Portland ME — small metro, tests sparse/missing data handling                 |
| `00601` | Aguadilla PR — Puerto Rico, no BLS county data, must fail gracefully          |
| `99999` | Invalid zip — must show a clean error, never crash or show empty cards        |

### Data Validation Rules

Every API response must be validated before display:

- **Sanity check all numbers** — unemployment rate must be between 0–25%,
  CPI changes must be between -20% and +50%, gas price between $1–$10/gal.
  If outside these ranges, show "Data unavailable" rather than a nonsense number.
- **Never show stale data without labeling it** — if cached data is >30 days old,
  show a warning badge on the affected card
- **Never show a blank card** — always show either real data, a skeleton loader,
  or an explicit "Data not available for this area" message
- **Verify Jan 2025 baseline exists** — if BLS data doesn't go back to Jan 2025
  for a given series, don't show a change figure, show "Baseline unavailable"

### Hero Card Number Checks

Before displaying any hero card number, verify:

- The % change is calculated from Jan 2025 baseline, NOT latest monthly delta
- Dollar translation uses local median income/spend, NOT national averages
- Source date shown is the date of the actual data, NOT today's date
- Geographic level label is accurate (county vs metro vs state vs national)

### Chart Validation

- Era shading ReferenceArea x1/x2 timestamps must match data format exactly
- Jan 2025 marker line must appear on ALL timeframe views, not just Jan 2025 view
- "Show national" toggle must work on all charts, not just some
- 10Y toggle should gracefully handle series that don't go back 10 years

### API Failure Handling

Every API call must have explicit error handling:

- BLS rate limit hit (429) → serve cached data if available, show warning badge
- API timeout (>5s) → show skeleton with "Taking longer than usual..." message
- Malformed response → log error, show "Data unavailable" card, never crash
- Missing county FIPS mapping → show state-level fallback where possible,
  otherwise show "Detailed local data not available for this zip"

### Mobile Testing

Always check these on mobile viewport (375px width) before deploying:

- Hero cards stack vertically and are readable
- Chart time toggles are tap-friendly (min 44px touch targets)
- Share button is prominent and works on iOS and Android
- Zip code input triggers numeric keyboard on mobile (use `inputMode="numeric"`)

### Performance Checks

Run after any significant change:

```bash
npx lighthouse https://whatchangedus.vercel.app --only-categories=performance
```

Target: 90+ mobile score. If below 90, fix before deploying.

### Playwright Tests

Run the test suite before any deploy:

```bash
npx playwright test
```

Tests cover: zip entry flow, card rendering, chart toggling,
share button, invalid zip handling, mobile viewport.

---

## Deployment

- Push to `main` branch → Vercel auto-deploys in ~30 seconds
- Every PR/branch gets a preview URL automatically
- Environment variables set in Vercel dashboard (never in code or git)
- Domain: whatchanged.us (when purchased) → pointed at Vercel via DNS

---

## Repository Structure Notes

- `.claude/` — commit this, contains project rules
- `.agents/` — commit this, contains agent configs
- `.vscode/settings.json` — commit this
- `.playwright-mcp/` — DO NOT commit, in .gitignore
- `.env` / `.env.local` — DO NOT commit, NEVER, in .gitignore
- `node_modules/` — DO NOT commit, in .gitignore

---

## MCP Servers Available

- **Context7** — real-time docs for Next.js, Recharts, Leaflet, Tailwind
- **GitHub MCP** — repo management
- **Playwright MCP** — visual testing across mobile/desktop

## Rules Files

Read these files at session start before doing any work:

- `.claude/rules/orchestration.md` — how to orchestrate tasks,
  use sub-agents, manage context, select models

## Build & Dev

- Dev: `npm run dev`
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`

## Code Standards

- TypeScript for all new code
- Functional React components with hooks
- 2-space indentation
- Format with Prettier, lint with ESLint
