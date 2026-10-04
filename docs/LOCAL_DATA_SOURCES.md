# Local price data (county / metro / community), free + keyless

Built by `scripts/fetch-local-data.sh` + `scripts/build-local-data.py` into static JSON under `public/data/`
(no runtime API calls, no keys, no Redis), plus server-importable files under `src/lib/data/`: `county-rent.json`
and `metro-rent.json` (Rent card, share card, OG image), `ak-gas.json` (Alaska DCRA community gas survey) and
`pr-gas.json` (Puerto Rico DACO gas). The page shows prices only (home values and rent); everything else
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
changes. Python deps (hash-pinned in the workflow): pandas 2.2.3, numpy 2.1.3, openpyxl 3.1.5 (FHFA and DACO
workbooks), xlrd 2.0.2 (the OMB 2020 delineation `.xls`).

## What the app reads

| File | Used by |
|---|---|
| `public/data/county/{stateFips}.json` | Housing graph tabs: monthly ZHVI (`hvS`) and seasonally adjusted ZORI (`rentS`) per county, plus `hvCur`/`rentCur`, `flags`, `note` |
| `public/data/us-housing.json` | Housing graph "Show national" |
| `public/data/counties.json`, `counties-timeline.json`, `counties-albers-10m.json` | National map (`hv`, `rent`, `hvCur`, `rentCur`, `n`, `z`, `emp`, `approx`, `flags`), time-lapse, geometry (static) |
| `public/data/meta.json` | Provenance footers (as-of month, source label, adjustment) for Zillow ZHVI / ZORI |
| `src/lib/data/county-rent.json` | Rent card, share card, OG image (county rung) |
| `src/lib/data/metro-rent.json` | Rent card for counties with no county series (metro rung); shards carry `rentM`/`rentMS` for the Rent tab |
| `src/lib/data/ak-gas.json` | Gas card + graph for Alaska zips outside the Anchorage CBSA (DCRA community survey rung) |
| `src/lib/data/pr-gas.json` | Gas card + graph for Puerto Rico (DACO rung) |

## In use

| Metric | Source | Geo | Cadence | Bulk URL | Terms |
|---|---|---|---|---|---|
| Home values | Zillow ZHVI (SA by Zillow) | 3.1k counties, U.S. | Monthly (~mid-month) | `files.zillowstatic.com/research/public_csvs/zhvi/…` | Free; attribution to Zillow required |
| Rent (asking rents on new leases) | Zillow ZORI (we seasonally adjust) | ~900 counties, U.S. | Monthly | `…/public_csvs/zori/County_…` | Same |
| Metro rent (counties without a county series) | Zillow ZORI metro (we seasonally adjust) | ~200 metros used | Monthly | `…/public_csvs/zori/Metro_…` | Same |
| County → metro | OMB CBSA delineation, March 2020 (list 1) — the vintage Zillow's metros use | County | Static | `www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2020/delineation-files/list1_2020.xls` | Public domain |
| Zillow metro ID → CBSA code | Zillow `CountyCrossWalk_Zillow.csv` (IDs only) | Metro | Static | `files.zillowstatic.com/research/public/CountyCrossWalk_Zillow.csv` | Zillow |
| Alaska gasoline (outside Anchorage) | Alaska DCRA Community Fuel Price Survey (DCCED), via DCRA's ArcGIS service; community → borough/region from DCRA's community database; zip points from the Census 2023 ZCTA gazetteer | ~100 communities, 7 regions | Twice yearly (Jan, Jul) | `maps.commerce.alaska.gov/server/rest/services/…` (mirror of `gis.data.alaska.gov/maps/DCCED::gas-prices-all-years`) | **CC BY 4.0** — credit "Alaska DCCED, Division of Community and Regional Affairs" (shown on the card and in the ladder docs) |
| Puerto Rico gasoline | DACO monthly island-wide average retail price, regular (col C, ¢/gal) | Island | Monthly | `docs.pr.gov/files/DACO/Gasolina/…/Precios-Promedios-de-Gasolina-y-Diesel%20(1).xlsx` (linked from `daco.pr.gov/recursos`) | Public data of the Government of Puerto Rico; cited |
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
| County rent | Own seasonal factors for series with ≥36 in-sample months; series with ≥12 months before Jan 2025 but too short for their own factors use their state's pooled pattern (median factors of that state's self-adjusted counties, ≥5; else the U.S. pool), labeled `saPool` on the card/graph. Newer series are dropped (never shown raw as "adjusted"). Levels shown are observed (unadjusted). | 877 counties (288 pooled) |
| Metro rent | Same SA method (pooled pattern by the principal city's state), sanity range (−30%..+60%), Jan 2025 + latest month, outlier flag vs the county distribution; only for counties with no county row | 205 metros, 461 counties |
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
  `curRent - curRent / (1 + pct/100)`; `curRent - baseRent` includes seasonality. Covers 877 counties / 56.8% of zip-county.json zips (2026-10 build; 589 / 47.8% before pooled seasonal patterns). zip-county.json is a housing-unit-weighted Census 2020 build (`scripts/build-zip-county.ts`), not the HUD crosswalk.
- Pooled seasonal pattern (why it is honest): ZORI's Jan → Aug swing is mostly the shared spring/summer leasing
  season, so a series too new to fit its own factors (e.g. Androscoggin ME, Zillow coverage since Nov 2022: only 20
  in-sample ratios) is adjusted with its state's typical factors rather than dropped or shown raw. Baseline and current
  still come from the county's own series; the card and graph say which pattern was used.
- `metro-rent.json` (rent ladder's metro rung): county FIPS → CBSA by the **OMB March 2020** delineation — verified
  as Zillow's vintage (all 1,831 Zillow county→metro labels agree with it; the 2023 delineation disagrees for 95
  metros) — and CBSA → Zillow metro by Zillow's own RegionID crosswalk (735 of 749 ZORI metros link; the 14 newer
  ones, e.g. Lebanon NH-VT, Dayton OH, have no ID link and are not used). No name matching. Adds 3,481 zips
  (VA 333, MO 179, IL 178, WV 168, …); pooled SA adds 3,729 county zips (WI 239, PA 192, NC 149, NH 132, …).
- `ak-gas.json`: per surveyed community (borough FIPS, DCRA region, semiannual series since 2016) + DCRA region
  averages; each Alaska zip outside the Anchorage CBSA maps to its own community (`c`, same name + same borough), else
  the nearest surveyed community in the same borough within 100 km of its ZCTA point (`n`), else the DCRA region average
  (`r`). 2026-10 build: 101 / 91 / 40 of 232 zips. Baseline = Winter (January) 2025 survey; current = latest survey.
- `pr-gas.json`: DACO regular gasoline, ¢/gal → $/gal, monthly since 2016 (null for months DACO did not survey:
  Sep–Oct 2017 hurricanes, Apr–May 2020 COVID-19). Static (not the refresh-cache job): the workbook URL carries a
  re-upload suffix "(1)" and needs an xlsx parser, while the monthly local-data job already runs after DACO's update.
  A failed download keeps the committed file (best effort, like the Alaska survey).

## Validation-only sources

FHFA HPI (county) and Apartment List (county rent) are used only to cross-check. See `docs/validation/FINDINGS.md`.

## Rejected

- Redfin: moved to multi-GB CSVs without FIPS, unclear license; Zillow covers it.
- HUD SAFMR: formula-based, ~2-yr lag, r=0.23 vs Zillow; not usable as a rent-change measure.
