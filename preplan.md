# Project Brief: Local Economic Snapshot — "What Changed In Your Town?"

## Overview

A fast, beautiful, shareable web app where anyone enters their zip code and instantly sees
a rich visual snapshot of how local economic conditions have changed since January 20, 2025.
Designed to go viral on Facebook via auto-generated shareable image cards.

**Tagline:** *Enter your zip code. See what changed.*

---

## Goals

- Zip code entry → instant local economic snapshot
- Bold, punchy visual design — dark background, large animated numbers
- Loads in under 2 seconds on mobile (Facebook link previews penalize slow sites)
- Auto-generates a shareable image card (like Spotify Wrapped) users post directly to Facebook
- Nonpartisan framing — data only, sourced and dated, reader draws their own conclusions
- Runs for essentially $0–$20/month at moderate traffic

---

## Tech Stack

### Frontend
- **Next.js** (React framework) — static generation + API routes in one
- **Tailwind CSS** — utility styling, fast to build, great mobile defaults
- **Framer Motion** — animated number counters, staggered card reveals, page transitions
- **Recharts** — simple, clean chart library (area charts, line charts)
- **Leaflet.js + OpenStreetMap** — interactive zip code map, no cost at any scale

### Backend / Data Layer
- **Vercel** — free hosting, serverless API routes, edge caching
- **Vercel KV** — Redis-compatible cache, free tier, store daily BLS/EIA fetches
- **Next.js API routes** — thin proxy layer between client and public APIs

### Shareable Card Generation
- **html2canvas** or **Satori** (Vercel's OG image library) — generate PNG card server-side
- Card auto-populates with zip's top 3 stats + site URL

---

## Data Architecture

### Zip → Geography Mapping
Use **HUD USPS Zip-County Crosswalk** (free static dataset) to map any zip code to its
county FIPS code. All BLS and most Census data is at county level. Download once, bundle
as a static JSON lookup — no API call needed.

### Data Sources & Freshness

| Data | Source | API / URL | Update Freq | Geo Level | Cache Strategy |
|------|---------|-----------|-------------|-----------|----------------|
| Unemployment rate | BLS LAUS | api.bls.gov | Monthly | County ✅ | Daily server cache |
| Jobs by industry | BLS CES | api.bls.gov | Monthly | Metro/MSA | Daily server cache |
| CPI — groceries, shelter, energy | BLS CPI | api.bls.gov | Monthly | Metro area | Daily server cache |
| Gas prices | EIA | api.eia.gov | Weekly | Region | Daily server cache |
| Median income, rent, home value | Census ACS | api.census.gov | Annual | ZIP ✅ | Static (update Dec each year) |
| Federal grants/contracts cut | USASpending | api.usaspending.gov | Near real-time | County ✅ | Daily server cache |
| Business applications | Census BFS | api.census.gov | Weekly | State | Daily server cache |
| Tariff impact estimates | Yale Budget Lab / Tax Foundation | Static citations | Quarterly | National | Hardcoded + sourced |

### BLS API Notes
- Free, no key required for basic access (register for higher rate limits)
- Series IDs needed: LAUCN[FIPS]0000000000003 (county unemployment)
- Can request multiple series in one call — batch all BLS fetches together
- Returns JSON with date-stamped observations — easy to pull Jan 2025 baseline

### Caching Strategy
```
User requests zip 98683
  → Check Vercel KV for cached county data (TTL: 24 hours)
  → Cache miss: fetch BLS + EIA + USASpending in parallel
  → Store result in KV with timestamp
  → Return to client
  → Static Census ACS data served from bundled JSON (instant)
```

---

## UI / UX Design

### Visual Direction
- **Dark background** (#0A0A0A or deep navy)
- **Bold white/cream typography** — display font like Bebas Neue or DM Serif Display
- **Sharp accent color** — electric amber or red for "change" indicators
- **No clutter** — generous whitespace, each stat breathes
- **Mobile-first** — designed for a phone screen, scales up to desktop

### Page Flow

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HERO SECTION
Large headline: "Enter your zip code."
Subhead: "See what changed in your town since January 2025."
[ZIP CODE INPUT — big, centered, thumb-friendly]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
↓ after zip entry (animates in, ~1 second load)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOCATION BANNER
"📍 Vancouver, WA — Clark County"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 1 — HERO STAT CARDS (3 cards, staggered animation)
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ UNEMPLOYMENT │ │  GROCERIES   │ │ FEDERAL $    │
│    5.0%      │ │  +14% since  │ │ LOST LOCALLY │
│  ↑ from 4.1% │ │  Jan 2025    │ │   $4.2M      │
│  Jan 2025    │ │              │ │ since Jan 20 │
└──────────────┘ └──────────────┘ └──────────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 2 — CHARTS (load async, simple & labeled)
[Jobs over time — area chart, Jan 2025 marked]
[Grocery prices — single line, clear upward trend]  
[Wages vs Rent — two lines showing the gap widening]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TARIFF IMPACT ESTIMATE
"Based on your area's median income of $83,821,
tariffs are estimated to cost your household
~$1,700 this year."
Source: Yale Budget Lab / Tax Foundation (linked)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[SHARE YOUR RESULTS] button — prominent
→ Generates PNG card, triggers native share sheet
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 3 — DIG DEEPER (collapsed by default)
SNAP enrollment changes | Business applications |
Import/export volumes | Bankruptcy trends
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXPLORE THE MAP
Leaflet map, click any zip to load that area's data
Lazy-loaded — only renders when user scrolls to it
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Shareable Card Format
Auto-generated PNG, sized for Facebook (1200×630px):
```
┌────────────────────────────────────────┐
│  📍 Vancouver, WA  (98683)             │
│                                        │
│  Unemployment  ↑ 5.0%  (+0.9 pts)      │
│  Groceries     ↑ +14%  since Jan 2025  │
│  Federal $     ↓ $4.2M cut locally     │
│                                        │
│  whatchanged.us — enter your zip       │
└────────────────────────────────────────┘
```

---

## Key Metrics To Surface (Priority Order)

### Tier 1 — Lead Cards (instant, emotional)
1. **Local unemployment rate** vs Jan 2025 baseline — BLS LAUS, county level
2. **Grocery price change** since Jan 2025 — BLS CPI food subcategory, metro level
3. **Federal funding lost in your county** since Jan 20 2025 — USASpending.gov

### Tier 2 — Charts (one scroll down)
4. **Local jobs by sector over time** — BLS CES, with era shading
5. **Grocery/shelter CPI trend** — clean line chart, labeled in plain English
6. **Wages vs rent gap** — two-line chart showing affordability squeeze

### Tier 3 — Personalized estimate
7. **Tariff cost for a household like yours** — formula: median local income ×
   Yale Budget Lab's estimated % cost burden. Cite source prominently.

### Tier 4 — Dig Deeper (collapsed)
8. Gas prices vs Jan 2025 — EIA weekly regional data
9. Federal contracts cancelled in county — USASpending
10. Business applications filed — Census BFS (leading indicator)
11. Median rent trend — Census ACS (annual)

---

## Chart Design — Timeframe & Era Coloring

### Default Timeframe
All charts default to **5-year view (2020–present)**. This captures the full story voters
have lived through: COVID shock, recovery, inflation surge, and the post-Jan-2025 period.

Include a **1Y / 3Y / 5Y / 10Y toggle** on every chart (like a stock chart). Casual
visitors see the 5-year story; curious users can zoom out to the full decade.

### Era Background Shading
Every chart gets two colored background bands to show political context without editorializing.
The data speaks — the shading just labels who was in charge when:

```
Jan 20, 2021                           Jan 20, 2025
       │                                      │
░░░░░░░│██████████████████████████████████████│▓▓▓▓▓▓▓▓▓▓▓
Trump I│       Biden (blue tint)              │Trump II (red tint)
░░░░░░░│██████████████████████████████████████│▓▓▓▓▓▓▓▓▓▓▓
```

**Implementation:**
- Biden era (Jan 20, 2021 → Jan 19, 2025): very subtle blue background tint
  `rgba(59, 130, 246, 0.07)` — barely visible, just enough to register
- Trump II era (Jan 20, 2025 → present): very subtle red background tint
  `rgba(239, 68, 68, 0.07)` — same intensity as blue, not alarming
- A thin vertical line + small label at each transition date
- If chart extends before Jan 2021, that pre-Biden period gets no tint (neutral)

**Important:** Keep the tints extremely subtle. The goal is orientation, not drama.
Heavy coloring looks partisan and will get screenshotted out of context. Light tints
read as informational. Test on dark background — on a dark theme even 7% opacity
registers clearly without feeling aggressive.

### Rationale for Two Lines (Not One)
Marking only Jan 2025 looks like cherry-picking. Marking both inaugurations gives full
nonpartisan context, shows what changed at each transition, and inoculates the site
against accusations of bias. Users can draw their own comparisons.

### Why 5 Years (Not 1)
- **Jobs:** Clark County added 39,000 jobs 2015–2025 then nearly flatlined. The stall
  is invisible without the runway.
- **Rent vs wages:** The scissors gap opened in 2021. One year makes it look like a
  recent blip; five years reveals it as structural.
- **Grocery prices:** Consumers are paying ~30% more than pre-pandemic. Starting from
  2024 makes prices look stable. Starting from 2020 shows the full hit — with tariffs
  now layering on top.

### Data Availability (all confirmed available for 5yr+ history)
| Source | History available |
|--------|------------------|
| BLS unemployment | Back to 1990 |
| BLS CPI | Back to 1947 |
| EIA gas prices | Back to 1990s |
| Census ACS income/rent | Annual back to 2010 |
| USASpending federal $ | Back to 2008 |
| BLS jobs by sector | Back to 1939 |

All are available in the same API calls — just set a wider date range parameter.
No additional cost or complexity.

---

## Data Honesty & Transparency Rules

Every displayed number must show:
- The source (abbreviated, linked)
- The date of the data ("Dec 2025 via BLS")
- The geographic level ("county-level" or "metro area estimate")

Tariff numbers are projections, not measurements. Label them explicitly:
> "Estimated impact based on Yale Budget Lab projections applied to local income data.
> Actual costs may vary."

The Jan 2025 baseline is locked — show before/after that specific date wherever possible.

---

## Performance Requirements

- **Lighthouse score:** 90+ mobile
- **First Contentful Paint:** < 1.5 seconds
- **Time to interactive:** < 2.5 seconds
- **Data load after zip entry:** < 1.5 seconds (parallel fetches + cache)
- **No layout shift** — skeleton loaders for all data cards while fetching
- **Works offline for cached zips** — Vercel KV serves cached responses even if upstream APIs slow

---

## Infrastructure & Cost

| Item | Provider | Cost |
|------|----------|------|
| Hosting + serverless functions | Vercel free tier | $0 |
| KV cache | Vercel KV free tier | $0 |
| Map tiles | OpenStreetMap + Leaflet | $0 |
| All data APIs | BLS, Census, EIA, USASpending | $0 |
| Domain | Namecheap | ~$12/year |
| Monitoring | UptimeRobot free tier | $0 |
| **Total** | | **~$12/year** |

At 500k+ monthly visits, Vercel paid plan ~$20/mo. Still negligible.

---

## MCP Servers for Claude Code

Install these before starting development:

- **Context7** — real-time docs for React, Next.js, Recharts, Leaflet
- **GitHub MCP** — version control without leaving terminal
- **Playwright MCP** — automated visual testing across mobile/desktop

```bash
claude mcp add context7 cmd -- npx -y @upstash/context7-mcp
claude mcp add github npx -- -y @modelcontextprotocol/server-github
claude mcp add playwright npx -- -y @playwright/mcp
```

---

## Suggested Build Order

1. **Static zip lookup** — HUD crosswalk JSON, zip → county FIPS, instant
2. **BLS unemployment fetch** — one county, one API call, display the number
3. **Hero stat cards UI** — dark theme, animated counters, mobile layout
4. **Add BLS CPI + EIA gas** — parallel fetches, Vercel KV caching
5. **Add USASpending federal cuts** — most emotionally powerful data point
6. **Charts section** — Recharts area/line charts with Jan 2025 marker
7. **Tariff estimate widget** — formula applied to local median income
8. **Shareable card generation** — Satori OG image, Facebook share button
9. **Leaflet map** — lazy loaded, click any zip
10. **Performance pass** — Lighthouse audit, image optimization, cache tuning

---

## What NOT To Build (keep it focused)

- No user accounts, no login
- No ads (kills credibility and Facebook reach)
- No comment sections
- No explicit partisan framing — data only, sources cited
- No comparison between zip codes (v2 feature maybe)
- No PDF export (shareable card replaces this)

---

## Reference Examples (study these for design inspiration)

- **The Pudding** (pudding.cool) — data storytelling, visual style
- **NYT The Upshot** — clarity, trust, plain English labels
- **Spotify Wrapped** — the shareable card mechanic to replicate
- **Hamilton Project trade tracker** — the data we're making more accessible

---

*Prepared after research session — March 2026*
*All APIs verified free and publicly accessible as of this date*