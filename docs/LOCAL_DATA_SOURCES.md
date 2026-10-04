# Local data sources (zip / county), free + keyless

Researched and verified 2026-10-01. Built by `scripts/fetch-local-data.sh` + `scripts/build-local-data.py`
into static JSON under `public/data/` (no runtime API calls, no keys, no Redis), plus
`src/lib/data/county-rent.json` (server-importable county rent for the housing hero card).

```bash
RAW=/path/to/raw   # scratch dir, never committed
BLS_CONTACT_EMAIL=you@example.com EIA_API_KEY=... scripts/fetch-local-data.sh "$RAW"   # BLS 403s without a contact email in the UA
python3 scripts/build-local-data.py --raw "$RAW" --out public/data      # re-runnable without re-downloading
python3 scripts/validate-local-data.py --raw "$RAW" --data public/data --out docs/validation
```

The build reads `src/lib/data/zip-county.json` and `src/lib/data/county-geo.json` (required; the build fails if missing or < 3,100 counties), plus `src/lib/data/ct-planning-regions.json`, at build time,
so rebuilding picks up mapping changes. Python deps (pinned in the workflow): pandas 2.2.3, numpy 2.1.3, openpyxl 3.1.5.

## In use

| Metric | Source | Geo | Cadence | Bulk URL | Terms |
|---|---|---|---|---|---|
| Home values | Zillow ZHVI (SA) | 26.7k zips, 3.1k counties | Monthly (~mid-month) | `files.zillowstatic.com/research/public_csvs/zhvi/…` | Free; attribution to Zillow required |
| Rent (asking rents on new leases) | Zillow ZORI (we seasonally adjust) | 8.5k zips, ~1k counties | Monthly | `…/public_csvs/zori/…` | Same |
| Listings (price, inventory, DOM, price cuts) | Realtor.com Economic Research | ~29k zips | Monthly | `econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv` | Attribute "Realtor.com® Economic Research" |
| Paychecks | BLS QCEW avg weekly wage, trailing 4 quarters vs prior 4 | County | Quarterly, ~5-mo lag | `data.bls.gov/cew/data/files/{yr}/csv/{yr}_qtrly_singlefile.zip` (3 yrs) | Public domain |
| Prices for paycheck comparison | BLS CPI-U all items, same 12 months | Metro / division | Monthly | `download.bls.gov/pub/time.series/cu/cu.data.0.Current` | Public domain (send a UA with contact) |
| Unemployment (map) | BLS LAUS county (we seasonally adjust; 3-month averages, latest preliminary month excluded) | County | Monthly | `download.bls.gov/pub/time.series/la/la.data.64.County` | Public domain |
| Electricity | EIA residential price (we seasonally adjust) | State | Monthly, ~2-mo lag | `api.eia.gov/v2/electricity/retail-sales/data` (free key; DEMO_KEY works for 2 calls) | Public domain |
| Job postings | Indeed Hiring Lab index (SA) | 593 metros → 1,438 counties via OMB 2023 CBSA list | Weekly | GitHub `hiring-lab/job_postings_tracker` | CC BY 4.0 |
| Health insurance | CMS Marketplace OEP county PUF: avg premium before/after subsidy, enrollment | County (HealthCare.gov states, ~30) | Annual | `cms.gov/files/zip/{yr}-oep-county-level-public-use-file.zip` | Public domain |
| City-level home values / rent | Zillow ZHVI / ZORI city files | 21k places (2.6k with rent) | Monthly | `…/public_csvs/{zhvi,zori}/City_…` | Zillow attribution |
| New construction | Census Building Permits Survey, YTD | County | Monthly | `www2.census.gov/econ/bps/County/co{YYMM}y.txt` | Public domain |
| County names | Census 2020 county reference file `national_county2020.txt` | County | Static | `www2.census.gov/geo/docs/reference/codes2020/` | Public domain |
| Map geometry | us-atlas counties-albers-10m | County | Static | jsdelivr `us-atlas@3` | ISC |

## Methodology notes

### How the UI uses these numbers (after the 2026-10 review)

- **County first, zip as estimate.** Validation shows zip-vs-zip differences inside a county are not corroborated
  (FINDINGS.md), so the Local Pulse cards lead with the county figure (fallback: Zillow city in the *same county*,
  matched by name + county + state and keyed by Zillow RegionID; then the zip). The zip figure is a secondary
  "Estimate for zip X" line. No zip or county percentile ranks are shipped.
- **Every figure carries its own window and provenance** (`Source · geography · window · as-of · adjustment`),
  generated from `meta.json`. No dates are hard-coded in the TypeScript (a unit test enforces this, except the
  site baseline constant).
- **Rent vs CPI shelter.** The rent card explains that Zillow tracks asking rents on new leases while BLS CPI
  shelter covers all renters and owners and trails market rents by about a year.

### Sanity filters in the build

| Metric | Rule | Effect (2026-10 build) |
|---|---|---|
| Zip/county/city rent | Seasonally adjust only series with ≥36 in-sample months; otherwise publish a same-month YoY change labeled as such (`basis: "yoy"`, cards only, never on the map). Levels shown are observed (unadjusted). | Zips: 2,839 SA + 3,349 YoY; counties: 589 SA + 441 YoY |
| All Zillow series | Must reach the file's latest month (no stale values mixed in) | — |
| Paychecks / real wages | County 4-quarter avg jobs ≥ 5,000 and abs(change) ≤ 25% | 2,032 published, 1,192 dropped |
| Listings (Realtor.com) | ≥ 20 active listings; every YoY within ±100%; price-cut share in [0, 1] (row dropped otherwise) | 11,864 kept, 474 dropped |
| Unemployment | 3-month SA averages; current window excludes the latest (preliminary) month; base and current in 0–25% | 3,220 counties |
| Movers lists | ≥ 75k jobs, not `approx`, not flagged as a robust outlier (abs(z) > 5 vs counties with ≥20k jobs) for that metric; top/bottom never overlap | e.g. Buncombe NC (Helene baseline) and +150–290% permit swings excluded |
| Notes | Known artifacts get a `note` shown in the county panel (Buncombe NC unemployment) | — |

### County geography fixes

- Names come from the Census 2020 county file (VA independent cities, AK census areas) with the zip crosswalk as fallback.
- CT planning regions (09110–09190) are dropped after their values are copied to legacy counties
  (Tolland → Capitol region). Legacy counties carry `approx` + `approxFrom`, and the UI shows an approximation note.
- Chugach (02063) and Copper River (02066) are kept because the zip crosswalk points at them; the
  Valdez-Cordova map shape (02261) takes Chugach's values (approx).
- Every crosswalk county resolves to a record except Kalawao HI (15005) and the island territories (AS, GU, MP, VI), which no source covers.
- Client lookups use per-state shards `public/data/county/{stateFips}.json`; the map loads the full `counties.json`.

### Statistical method

- Baseline = Jan 2025 monthly value, consistent with the rest of the site.
- ZORI and LAUS county series are not seasonally adjusted. The build applies a classical decomposition
  (2×12 centered MA, per-calendar-month median factors fit on 2016–2024). Validated on state LAUS:
  mean abs error vs BLS's official SA change since Jan 2025 is 0.22 pts (vs 0.36 pts using raw NSA).
  This is why the site's unemployment headline uses these SA 3-month averages: a raw NSA Jan 2025 → latest
  comparison carries seasonal bias (January is seasonally high). The live chart still shows monthly NSA data,
  labeled as such.
- Paychecks vs prices compares the trailing 4-quarter QCEW average weekly wage (all ownerships, all
  industries) with the prior 4 quarters, against local CPI over the same 12 months. Single quarters are
  dominated by bonus timing (r≈0.03 quarter-to-quarter for large counties). Averages also move with job mix.
- Map "biggest movers" are limited to counties with 75k+ jobs to avoid tiny-county noise.
- Connecticut: BLS/Census/Indeed publish by planning region (091xx); Zillow and the site use legacy
  counties. Legacy counties take their dominant planning region's values (same mapping as bls.ts), flagged `approx`.
- HUD SAFMR is not usable as a rent-change measure (formula-based, ~2-yr lag, r=0.23 vs Zillow), so there is no HUD rent fallback.
- `county-rent.json`: `pct` is the SA change since Jan 2025 (counties passing the SA rule, −30%..+60%);
  `baseRent`/`curRent` are observed (unadjusted) asking rents. A monthly dollar change consistent with `pct` is
  `curRent - curRent / (1 + pct/100)`; `curRent - baseRent` includes seasonality. Covers 589 counties / 47.8% of zip-county.json zips (41.2% excluding PO-box zips flagged `zcta: false`). zip-county.json is a housing-unit-weighted Census 2020 build (`scripts/build-zip-county.ts`), not the HUD crosswalk.

## Validation-only sources

FHFA HPI (county, zip5), Realtor.com, Apartment List, HUD SAFMR, BLS state LAUS (SA and NSA), and the EIA table 5.6.A are used only to cross-check. See `docs/validation/FINDINGS.md`.

## Verified but not yet used (next candidates)

| Source | Geo | Notes |
|---|---|---|
| Apartment List rent estimates | 606 cities, 370 counties | Monthly; CSV URL changes monthly (scrape the page) |
| FHFA HPI | Zip5 / county, annual | Public domain, slow cadence |
| BEA county personal income | County, annual (2024 latest) | Public domain |
| WARN layoff notices | Employer → city/county | Run Big Local News `warn-scraper` ourselves; community feed is stale |

## Rejected

- AAA gas prices — ToS forbids scraping; no open source finer than EIA's 29 areas (except NY state).
- FRED Equifax county credit series — reproduction prohibited without Equifax permission.
- DOL childcare prices — latest year 2022.
- Redfin — moved to multi-GB CSVs without FIPS, unclear license; Zillow + Realtor.com cover it.
