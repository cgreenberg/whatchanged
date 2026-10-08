# What Changed

**Enter your zip code. See what changed since January 2025.**

[whatchanged.us](https://www.whatchanged.us)

What Changed is a free, nonpartisan web app that shows how local prices have shifted since January 20, 2025. Enter a US zip code or city to see gas prices, rent, home prices, grocery prices and electricity prices, all from official statistics.

Every number shows its source, geography, time window, as-of date and whether it is seasonally adjusted. Estimates are labeled as estimates. The data speaks for itself.

---

## Data Sources

**Live (fetched and cached per request):**

| Metric | Source | Geography |
|---|---|---|
| Gas prices | [EIA](https://www.eia.gov/petroleum/gasdiesel/) weekly retail gasoline; BLS CPI average price (monthly) for CPI metros without an EIA city | EIA city, state, or PADD region; BLS metro |
| Grocery and shelter prices | [BLS CPI](https://www.bls.gov/cpi/) | CPI metro area, Census division, or national |
| Electricity prices | [EIA](https://www.eia.gov/electricity/data/browser/) average residential price (¢/kWh), monthly; card = latest 12-month average price and its % change vs the 12 months ending Jan 2025 | State (statewide average) |

**Bundled (rebuilt by scripts):**

| Metric | Source | Geography |
|---|---|---|
| Rent on new listings | [Zillow ZORI](https://www.zillow.com/research/data/), seasonally adjusted by whatchanged | County |
| Home prices | [Zillow ZHVI](https://www.zillow.com/research/data/) (smoothed, seasonally adjusted by Zillow) | County |
| Median rent (base of the CPI shelter card's dollar figure) | [Census ACS](https://www.census.gov/programs-surveys/acs) 5-year | ZIP (ZCTA) |
| Zip → county | Census 2020 ZCTA/block relationship files (housing-unit weighted) + GeoNames for PO-box zips | ZIP |

Changes are measured from a **January 2025 baseline**: the January 2025 monthly value for monthly data, and the last weekly reading on or before January 20, 2025 for gas.

More detail:
- [docs/MAPPING_STRATEGY.md](docs/MAPPING_STRATEGY.md): how a zip maps to county, CPI area and gas region
- [docs/LOCAL_DATA_SOURCES.md](docs/LOCAL_DATA_SOURCES.md): the monthly local-data pipeline, its sources and methods
- [docs/validation/FINDINGS.md](docs/validation/FINDINGS.md): cross-source validation results and caveats

---

## Features

- **Hero cards:** gas, rent (or CPI shelter where Zillow has no county rent), groceries and electricity, each with a dollar translation, a short source line and full details behind ⓘ
- **Graphs:** gas, groceries, housing and electricity, with Jan 2025 / 3Y / 5Y / 10Y ranges, a national overlay and a neutral Jan 20, 2025 baseline rule, plus a Home heating graph (heating oil / propane) in states where at least 5% of homes use those fuels. The housing graph has three tabs: Rent (Zillow ZORI, the same county series as the Rent card), Home prices (Zillow ZHVI) and Shelter (BLS CPI, all tenants and homeowners). The electricity graph shows the state's published monthly price and the trailing 12-month average behind the card's number and %
- **National county map:** gas, rent, home prices, groceries and electricity for every county. Rent and home prices are county figures with biggest movers and a month-by-month time-lapse; gas, groceries and electricity come from metro, regional or statewide series (read from the cache, never fetched by the map), so neighboring counties share a color. Tap a county to see all five and load it
- **Share images:** auto-generated PNG cards for social media

---

## Tech Stack

Next.js (App Router) + React, TypeScript, Tailwind CSS, Recharts, Framer Motion, d3-geo + TopoJSON (map), `next/og` / Satori (images), Upstash Redis (cache), Vercel (hosting). Tests: Jest + MSW, Playwright.

---

## Development

Requires Node.js 20+ and npm. The local-data pipeline also needs Python 3 with pandas, numpy and openpyxl.

```bash
git clone https://github.com/cgreenberg/whatchanged.git
cd whatchanged
npm install
```

Create `.env.local`:

```
BLS_API_KEY=your_key
EIA_API_KEY=your_key
KV_REST_API_URL=your_upstash_url      # optional: without it an in-memory cache is used
KV_REST_API_TOKEN=your_upstash_token
CRON_SECRET=any_random_string         # enables live upstream checks on /api/health
```

```bash
npm run dev          # dev server at localhost:3000
npm run build        # production build
npm test             # unit + integration tests (Jest)
npm run test:e2e     # end-to-end tests (Playwright, API mocked)
npm run lint         # ESLint
```

See `CLAUDE.md` for the full command list, data-pipeline scripts and cache rules.

---

## Data Verification

Unit tests cover the mapping and math layers, including hand-checked "golden" zips and recorded BLS responses. `npm run verify:live` fetches a fixed set of zips from the deployed API and compares the series, baselines and latest values (gas, CPI and state electricity prices) directly against BLS and EIA (needs `BLS_API_KEY` and `EIA_API_KEY`). It runs weekly via GitHub Actions and opens an issue on failure. The monthly local-data refresh runs its own validator (`scripts/validate-local-data.py`) before it opens a pull request.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

---

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 Charles Greenberg
