# Local price data (county), free + keyless

Built by `scripts/fetch-local-data.sh` + `scripts/build-local-data.py` into static JSON under `public/data/`
(no runtime API calls, no keys, no Redis), plus `src/lib/data/county-rent.json` (server-importable county rent
for the Rent card, share card and OG image). The page shows prices only (home values and rent); everything else
that earlier versions of the pipeline fetched (zip shards, city files, unemployment, wages, permits, job postings,
ACA premiums, electricity, Realtor.com listings) has been removed.

```bash
RAW=/path/to/raw   # scratch dir, never committed
scripts/fetch-local-data.sh "$RAW"                                       # keyless; no contact email or API key needed
python3 scripts/build-local-data.py --raw "$RAW" --out public/data      # re-runnable without re-downloading
python3 scripts/validate-local-data.py --raw "$RAW" --data public/data --out docs/validation
```

The build reads `src/lib/data/zip-county.json`, `src/lib/data/county-geo.json` (required; the build fails if missing
or < 3,100 counties) and `src/lib/data/ct-planning-regions.json` at build time, so rebuilding picks up mapping
changes. Python deps (hash-pinned in the workflow): pandas 2.2.3, numpy 2.1.3, openpyxl 3.1.5 (openpyxl is read by
the validator for the FHFA workbook).

## What the app reads

| File | Used by |
|---|---|
| `public/data/county/{stateFips}.json` | Housing graph tabs: monthly ZHVI (`hvS`) and seasonally adjusted ZORI (`rentS`) per county, plus `hvCur`/`rentCur`, `flags`, `note` |
| `public/data/us-housing.json` | Housing graph "Show national" |
| `public/data/counties.json`, `counties-timeline.json`, `counties-albers-10m.json` | National map (`hv`, `rent`, `hvCur`, `rentCur`, `n`, `z`, `emp`, `approx`, `flags`), time-lapse, geometry (static) |
| `public/data/meta.json` | Provenance footers (as-of month, source label, adjustment) for Zillow ZHVI / ZORI |
| `src/lib/data/county-rent.json` | Rent card, share card, OG image |

## In use

| Metric | Source | Geo | Cadence | Bulk URL | Terms |
|---|---|---|---|---|---|
| Home values | Zillow ZHVI (SA by Zillow) | 3.1k counties, U.S. | Monthly (~mid-month) | `files.zillowstatic.com/research/public_csvs/zhvi/…` | Free; attribution to Zillow required |
| Rent (asking rents on new leases) | Zillow ZORI (we seasonally adjust) | ~1k counties, U.S. | Monthly | `…/public_csvs/zori/…` | Same |
| Zip order | Zillow ZHVI zip file (SizeRank order only, no values) | Zip | Monthly | `…/public_csvs/zhvi/Zip_…` | Same |
| County jobs (movers-list eligibility only, not displayed) | BLS QCEW latest quarter | County | Quarterly | `data.bls.gov/cew/data/files/{yr}/csv/{yr}_qtrly_singlefile.zip` (1 file) | Public domain |
| County names | Census 2020 `national_county2020.txt` | County | Static | `www2.census.gov/geo/docs/reference/codes2020/` | Public domain |
| Map geometry | us-atlas counties-albers-10m | County | Static | jsdelivr `us-atlas@3` | ISC |

No BLS bulk file on `download.bls.gov` is downloaded any more, so `BLS_CONTACT_EMAIL` and `EIA_API_KEY` are not
needed by the pipeline (the QCEW file on `data.bls.gov` downloads without a contact User-Agent).

## Methodology notes

### Sanity filters in the build

| Metric | Rule | Effect (2026-10 build) |
|---|---|---|
| County rent | Seasonally adjust only series with ≥36 in-sample months; shorter series are dropped (never shown raw as "adjusted"). Levels shown are observed (unadjusted). | 589 counties |
| All Zillow series | Must reach the file's latest month (no stale values mixed in) | — |
| Movers lists | ≥ 75k jobs, not `approx`, not flagged as a robust outlier (abs(z) > 5 vs counties with ≥20k jobs) for that metric; top/bottom never overlap | — |

### County geography fixes

- Names come from the Census 2020 county file (VA independent cities, AK census areas) with the zip crosswalk as fallback.
- CT planning regions (09110–09190) are dropped after their jobs counts are copied to legacy counties; legacy
  counties carry `approx` so they are excluded from movers lists.
- Chugach (02063) and Copper River (02066) are kept because the zip crosswalk points at them; the
  Valdez-Cordova map shape (02261) takes Chugach's jobs count (approx).
- Every crosswalk county resolves to a record except Kalawao HI (15005) and the island territories (AS, GU, MP, VI), which no source covers.
- Client lookups use per-state shards `public/data/county/{stateFips}.json`; the map loads the full `counties.json`.

### Statistical method

- Baseline = Jan 2025 monthly value, consistent with the rest of the site.
- ZORI is not seasonally adjusted. The build applies a classical decomposition (2×12 centered MA,
  per-calendar-month median factors fit on 2016–2024). Rent is only published for series with enough history to fit.
- Map "biggest movers" are limited to counties with 75k+ jobs to avoid tiny-county noise.
- `county-rent.json`: `pct` is the SA change since Jan 2025 (counties passing the SA rule, −30%..+60%);
  `baseRent`/`curRent` are observed (unadjusted) asking rents. A monthly dollar change consistent with `pct` is
  `curRent - curRent / (1 + pct/100)`; `curRent - baseRent` includes seasonality. Covers 589 counties / 47.8% of zip-county.json zips (41.2% excluding PO-box zips flagged `zcta: false`). zip-county.json is a housing-unit-weighted Census 2020 build (`scripts/build-zip-county.ts`), not the HUD crosswalk.

## Validation-only sources

FHFA HPI (county) and Apartment List (county rent) are used only to cross-check. See `docs/validation/FINDINGS.md`.

## Rejected

- Redfin: moved to multi-GB CSVs without FIPS, unclear license; Zillow covers it.
- HUD SAFMR: formula-based, ~2-yr lag, r=0.23 vs Zillow; not usable as a rent-change measure.
