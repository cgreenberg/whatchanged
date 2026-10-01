# Local data sources (zip / county), free + keyless

Researched and verified 2026-10-01. Built by `scripts/fetch-local-data.sh` + `scripts/build-local-data.py`
into static JSON under `public/data/` (no runtime API calls, no keys, no Redis).

## In use (feature/local-pulse)

| Metric | Source | Geo | Cadence | Bulk URL | Terms |
|---|---|---|---|---|---|
| Home values | Zillow ZHVI (SA) | 26.7k zips, 3.1k counties | Monthly (~mid-month) | `files.zillowstatic.com/research/public_csvs/zhvi/…` | Free; attribution to Zillow required |
| Rent | Zillow ZORI (we seasonally adjust) | 8.5k zips, ~1k counties | Monthly | `…/public_csvs/zori/…` | Same |
| Listings (price, inventory, DOM, price cuts) | Realtor.com Economic Research | ~29k zips | Monthly | `econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv` | Attribute "Realtor.com® Economic Research" |
| Paychecks | BLS QCEW avg weekly wage, YoY | County | Quarterly, ~5-mo lag | `data.bls.gov/cew/data/files/{yr}/csv/{yr}_qtrly_singlefile.zip` | Public domain |
| Prices for paycheck comparison | BLS CPI-U all items, same quarter | Metro / division | Monthly | `download.bls.gov/pub/time.series/cu/cu.data.0.Current` | Public domain (send a UA with contact) |
| Unemployment (map) | BLS LAUS county (we seasonally adjust) | County | Monthly | `download.bls.gov/pub/time.series/la/la.data.64.County` | Public domain |
| New construction | Census Building Permits Survey, YTD | County | Monthly | `www2.census.gov/econ/bps/County/co{YYMM}y.txt` | Public domain |
| Map geometry | us-atlas counties-albers-10m | County | Static | jsdelivr `us-atlas@3` | ISC |

## Methodology notes

- Baseline = Jan 2025 monthly value, consistent with the rest of the site.
- ZORI and LAUS county series are not seasonally adjusted. The build applies a classical decomposition
  (2×12 centered MA, per-calendar-month median factors fit on 2016–2024). Validated on state LAUS:
  mean abs error vs BLS's official SA change since Jan 2025 is 0.22 pts (vs 0.36 pts using raw NSA).
  **Implication for the live unemployment card:** it compares raw NSA Jan 2025 to the latest month,
  which carries seasonal bias (January is seasonally high), so it tends to understate increases.
- Paychecks vs prices compares QCEW average weekly wage (all ownerships, all industries) to the local
  CPI over the same quarter a year apart. Averages move with job mix (e.g. losing low-wage jobs raises
  the average), and Q1 includes bonus season, so small counties can show outliers (e.g. +20%).
- Map "biggest movers" are limited to counties with 75k+ jobs to avoid tiny-county noise.
- Connecticut: LAUS uses planning regions (091xx) while the map geometry uses legacy counties, so CT
  shows no unemployment on the map.

## Verified but not yet used (next candidates)

| Source | Geo | Notes |
|---|---|---|
| HUD Small Area FMR FY25 → FY27 | Zip (metro zips) | Annual, public domain. HUD site needs browser UA + Accept header. Good "official rent" cross-check |
| CMS ACA OEP county PUF (2025 vs 2026 avg premium after APTC) | County / zip | HealthCare.gov states only; big 2026 story, frame strictly as data |
| EIA electricity retail price | State, monthly | Free key. Pairs with gas for an "energy bills" card |
| Indeed Hiring Lab job postings | 594 metros, weekly | CC BY 4.0, GitHub CSV. "Job postings since Jan 2025" |
| Apartment List rent estimates | 606 cities, 370 counties | Monthly; CSV URL changes monthly (scrape the page) |
| FHFA HPI | Zip5 / county, annual | Public domain, slow cadence |
| BEA county personal income | County, annual (2024 latest) | Public domain |
| WARN layoff notices | Employer → city/county | Run Big Local News `warn-scraper` ourselves; community feed is stale |

## Rejected

- AAA gas prices — ToS forbids scraping; no open source finer than EIA's 29 areas (except NY state).
- FRED Equifax county credit series — reproduction prohibited without Equifax permission.
- DOL childcare prices — latest year 2022.
- Redfin — moved to multi-GB CSVs without FIPS, unclear license; Zillow + Realtor.com cover it.
