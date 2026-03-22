# What Changed

**Enter your zip code. See what changed since January 2025.**

[whatchanged.us](https://www.whatchanged.us)

What Changed is a free, nonpartisan web app that shows how local economic conditions have shifted since January 20, 2025. Enter any US zip code and get a visual snapshot of unemployment, grocery prices, shelter costs, gas prices, federal spending changes, and estimated tariff impact — all sourced from official government data.

The goal is simple: give people the facts about their local economy, clearly cited, with no spin. Every number on the site links back to its source. Projections are labeled as projections. The data speaks for itself.

---

## Data Sources

All data comes from official US government agencies and academic research:

| Metric | Source | Detail |
|---|---|---|
| Unemployment rate | [Bureau of Labor Statistics (BLS)](https://www.bls.gov/) | Local Area Unemployment Statistics (LAUS), county-level |
| Grocery prices | [Bureau of Labor Statistics (BLS)](https://www.bls.gov/) | Consumer Price Index (CPI) food subcategories, metro-level |
| Shelter costs | [Bureau of Labor Statistics (BLS)](https://www.bls.gov/) | CPI shelter subcategories, metro-level |
| Gas prices | [Energy Information Administration (EIA)](https://www.eia.gov/) | Weekly retail gasoline prices, regional |
| Federal spending cuts | [USASpending.gov](https://www.usaspending.gov/) | Contract and grant data, county-level |
| Income & rent | [US Census Bureau](https://www.census.gov/) | American Community Survey (ACS), ZIP-level |
| Tariff cost estimate | [Yale Budget Lab](https://budgetlab.yale.edu/) | Estimated ~2% of household income impact |
| Zip-to-county mapping | [HUD USPS Crosswalk](https://www.huduser.gov/portal/datasets/usps_crosswalk.html) | ZIP → county FIPS code |

All changes are measured from a **January 20, 2025 baseline**.

---

## Features

- **Hero stat cards** — unemployment, grocery prices, shelter costs, and federal spending changes with animated counters and dollar-impact translations
- **Interactive charts** — time series with toggleable ranges (Jan 2025, 3Y, 5Y, 10Y) and presidential era shading for context
- **National comparison** — toggle national averages alongside your local data on every chart
- **Shareable image cards** — auto-generated PNG snapshots optimized for social media sharing
- **Tariff impact estimate** — household cost projection based on local median income
- **Interactive map** — Leaflet/OpenStreetMap view of your zip code area

---

## Tech Stack

- [Next.js](https://nextjs.org/) (React) — framework
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [Recharts](https://recharts.org/) — charts
- [Framer Motion](https://www.framer.com/motion/) — animations
- [Leaflet](https://leafletjs.com/) + OpenStreetMap — maps
- [Upstash Redis](https://upstash.com/) — API response caching
- [Satori](https://github.com/vercel/satori) — server-side image generation
- [Vercel](https://vercel.com/) — hosting and serverless API routes

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/cgreenberg/whatchanged.git
cd whatchanged
npm install
```

Create a `.env.local` file with the required API keys (see `.env.example` for the template):

```
BLS_API_KEY=your_key
EIA_API_KEY=your_key
CENSUS_API_KEY=your_key
KV_REST_API_URL=your_upstash_url
KV_REST_API_TOKEN=your_upstash_token
```

### Run

```bash
npm run dev        # Start dev server at localhost:3000
npm run build      # Production build
npm test           # Run unit/integration tests (Jest)
npm run test:e2e   # Run end-to-end tests (Playwright)
npm run lint       # Lint with ESLint
```

---

## Project Structure

```
src/
  app/              # Next.js pages and API routes
    api/
      data/[zip]/   # Main data endpoint — fetches all metrics for a zip
      og/           # Shareable image generation (Satori)
      warm-cache/   # Cache warming endpoint
  components/       # React components (stat cards, charts, map, share button)
  lib/
    api/            # Data fetching (BLS, EIA, USASpending, Census)
    cache/          # Upstash Redis caching layer
    charts/         # Chart configuration and data transforms
    data/           # Static data (zip-county mappings, Census ACS, CPI area maps)
  types/            # TypeScript type definitions
tests/
  unit/             # Unit tests
  integration/      # API integration tests
  e2e/              # Playwright browser tests
  fixtures/         # Test data fixtures
  mocks/            # MSW API mock handlers
scripts/            # Utility scripts (cache preloading, data auditing)
public/             # Static assets
```

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

---

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 Charles Greenberg
