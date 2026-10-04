# What Changed

**Enter your zip code. See what changed since January 2025.**

[whatchanged.us](https://www.whatchanged.us)

What Changed is a free, nonpartisan web app that shows how local economic conditions have shifted since January 20, 2025. Enter a US zip code or city to see gas prices, rent, grocery prices, an estimated tariff cost, unemployment and other local indicators, all from official statistics and published research.

Every number shows its source, geography, time window, as-of date and whether it is seasonally adjusted. Estimates are labeled as estimates. The data speaks for itself.

---

## Data Sources

**Live (fetched and cached per request):**

| Metric | Source | Geography |
|---|---|---|
| Gas prices | [EIA](https://www.eia.gov/petroleum/gasdiesel/) weekly retail gasoline | EIA city, state, or PADD region |
| Grocery, shelter, energy prices | [BLS CPI](https://www.bls.gov/cpi/) | CPI metro area, Census division, or national |
| Unemployment rate (chart) | [BLS LAUS](https://www.bls.gov/lau/) | County (Connecticut: planning region) |

**Bundled (rebuilt by scripts):**

| Metric | Source | Geography |
|---|---|---|
| Rent on new leases | [Zillow ZORI](https://www.zillow.com/research/data/), seasonally adjusted by whatchanged | County |
| Income and rent levels | [Census ACS](https://www.census.gov/programs-surveys/acs) 5-year | ZIP (ZCTA), city |
| Tariff cost estimate | [Yale Budget Lab](https://budgetlab.yale.edu/) (2.05% of local median household income) | ZIP |
| Zip → county | Census 2020 ZCTA/block relationship files (housing-unit weighted) + GeoNames for PO-box zips | ZIP |
| Local Pulse: home values, listings, paychecks, unemployment, permits, job postings, health premiums | Zillow, Realtor.com, BLS QCEW/LAUS/CPI, Census, Indeed Hiring Lab, CMS | County, city, ZIP |

Changes are measured from a **January 2025 baseline**: the January 2025 monthly value for monthly data, and the last weekly reading on or before January 20, 2025 for gas.

More detail:
- [docs/MAPPING_STRATEGY.md](docs/MAPPING_STRATEGY.md): how a zip maps to county, CPI area, gas region and LAUS area
- [docs/LOCAL_DATA_SOURCES.md](docs/LOCAL_DATA_SOURCES.md): the monthly local-data pipeline, its sources and methods
- [docs/validation/FINDINGS.md](docs/validation/FINDINGS.md): cross-source validation results and caveats

---

## Features

- **Hero cards:** gas, rent (or CPI shelter where Zillow has no county rent), groceries and tariff estimate, each with a dollar translation and a provenance line
- **Charts:** gas, groceries, shelter, energy and unemployment, with Jan 2025 / 3Y / 5Y / 10Y ranges, a national overlay and era shading
- **Local Pulse:** county-level home values, rent, listings, paychecks vs prices and more
- **National county map:** how every county changed, per metric
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

Unit tests cover the mapping and math layers, including hand-checked "golden" zips and recorded BLS responses. `npm run verify:live` fetches a fixed set of zips from the deployed API and compares the series, baselines and latest values directly against BLS and EIA (needs `BLS_API_KEY` and `EIA_API_KEY`). It runs weekly via GitHub Actions and opens an issue on failure. The monthly local-data refresh runs its own validator (`scripts/validate-local-data.py`) before it opens a pull request.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

---

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 Charles Greenberg
