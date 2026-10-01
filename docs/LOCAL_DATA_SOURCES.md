# Local data sources (zip / county), free + keyless

Researched and verified 2026-10-01. Built by `scripts/fetch-local-data.sh` + `scripts/build-local-data.py`
into static JSON under `public/data/` (no runtime API calls, no keys, no Redis).

## In use (feature/local-pulse)

| Metric | Source | Geo | Cadence | Bulk URL | Terms |
|---|---|---|---|---|---|
| Home values | Zillow ZHVI (SA) | 26.7k zips, 3.1k counties | Monthly (~mid-month) | `files.zillowstatic.com/research/public_csvs/zhvi/…` | Free; attribution to Zillow required |
| Rent | Zillow ZORI (we seasonally adjust) | 8.5k zips, ~1k counties | Monthly | `…/public_csvs/zori/…` | Same |
| Listings (price, inventory, DOM, price cuts) | Realtor.com Economic Research | ~29k zips | Monthly | `econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv` | Attribute "Realtor.com® Economic Research" |
| Paychecks | BLS QCEW avg weekly wage, trailing 4 quarters vs prior 4 | County | Quarterly, ~5-mo lag | `data.bls.gov/cew/data/files/{yr}/csv/{yr}_qtrly_singlefile.zip` (3 yrs) | Public domain |
| Prices for paycheck comparison | BLS CPI-U all items, same 12 months | Metro / division | Monthly | `download.bls.gov/pub/time.series/cu/cu.data.0.Current` | Public domain (send a UA with contact) |
| Unemployment (map) | BLS LAUS county (we seasonally adjust; 3-mo averages) | County | Monthly | `download.bls.gov/pub/time.series/la/la.data.64.County` | Public domain |
| Electricity | EIA residential price (we seasonally adjust) | State | Monthly, ~2-mo lag | `api.eia.gov/v2/electricity/retail-sales/data` (free key; DEMO_KEY works for 2 calls) | Public domain |
| Job postings | Indeed Hiring Lab index (SA) | 593 metros → 1,438 counties via OMB 2023 CBSA list | Weekly | GitHub `hiring-lab/job_postings_tracker` | CC BY 4.0 |
| Health insurance | CMS Marketplace OEP county PUF: avg premium before/after subsidy, enrollment | County (HealthCare.gov states, ~30) | Annual | `cms.gov/files/zip/{yr}-oep-county-level-public-use-file.zip` | Public domain |
| City-level home values / rent | Zillow ZHVI / ZORI city files | 21k places (2.6k with rent) | Monthly | `…/public_csvs/{zhvi,zori}/City_…` | Zillow attribution |
| New construction | Census Building Permits Survey, YTD | County | Monthly | `www2.census.gov/econ/bps/County/co{YYMM}y.txt` | Public domain |
| Map geometry | us-atlas counties-albers-10m | County | Static | jsdelivr `us-atlas@3` | ISC |

## Methodology notes

- Baseline = Jan 2025 monthly value, consistent with the rest of the site.
- ZORI and LAUS county series are not seasonally adjusted. The build applies a classical decomposition
  (2×12 centered MA, per-calendar-month median factors fit on 2016–2024). Validated on state LAUS:
  mean abs error vs BLS's official SA change since Jan 2025 is 0.22 pts (vs 0.36 pts using raw NSA).
  **Implication for the live unemployment card:** it compares raw NSA Jan 2025 to the latest month,
  which carries seasonal bias (January is seasonally high), so it tends to understate increases.
- Paychecks vs prices compares the trailing 4-quarter QCEW average weekly wage (all ownerships, all
  industries) with the prior 4 quarters, against local CPI over the same 12 months. Single quarters are
  dominated by bonus timing (r≈0.03 quarter-to-quarter for large counties). Averages also move with job mix.
- Map "biggest movers" are limited to counties with 75k+ jobs to avoid tiny-county noise.
- Connecticut: BLS/Census/Indeed publish by planning region (091xx); Zillow and the site use legacy
  counties. Legacy counties take their dominant planning region's values (same mapping as bls.ts), flagged `approx`.
- HUD SAFMR is not usable as a rent-change measure (formula-based, ~2-yr lag, r=0.23 vs Zillow).

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
