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
| `src/lib/data/city-rent.json` | Rent card for counties with no usable county or metro series (city rung); shards carry `rentC`/`rentCS` for the Rent tab; map dots |
| `public/data/counties.json` `rentH` | Map only: HUD 2-bedroom Fair Market Rent change FY2025→latest FY for counties with no usable Zillow rent (tooltip / panel only, labeled an estimate, not actual rents; the county is drawn in the no-data gray; never on the Rent card) |
| `src/lib/data/ak-gas.json` | Gas card + graph for Alaska zips outside the Anchorage CBSA (DCRA community survey rung) |
| `src/lib/data/pr-gas.json` | Gas card + graph for Puerto Rico (DACO rung) |

## In use

| Metric | Source | Geo | Cadence | Bulk URL | Terms |
|---|---|---|---|---|---|
| Home values | Zillow ZHVI (SA by Zillow) | 3.1k counties, U.S. | Monthly (~mid-month) | `files.zillowstatic.com/research/public_csvs/zhvi/…` | Free; attribution to Zillow required |
| Rent (asking rents on new listings) | Zillow ZORI (we seasonally adjust) | ~900 counties, U.S. | Monthly | `…/public_csvs/zori/County_…` | Same |
| Metro rent (counties without a county series) | Zillow ZORI metro (we seasonally adjust) | ~200 metros used | Monthly | `…/public_csvs/zori/Metro_…` | Same |
| City rent (counties without a county or usable metro series) | Zillow ZORI city (we seasonally adjust) | 1 county (2026-10) | Monthly | `…/public_csvs/zori/City_zori_uc_sfrcondomfr_sm_month.csv` | Same |
| City → county | Census 2020 place-by-county and county-subdivision files (`national_place_by_county2020.txt`, `national_cousub2020.txt`); Zillow's own `CountyName` only breaks ties for a name Census puts in several counties (Zillow puts Fernley NV in Churchill County; Census: Lyon) | Place | Static | `www2.census.gov/geo/docs/reference/codes2020/` | Public domain |
| Rent, last map tier (map only) | HUD Fair Market Rents, 2-bedroom, history file `FMR_2Bed_1983_{latest FY}.csv` (cross-checked against HUD's yearly county workbooks FY2025 revised and the latest FY) | County (New England: town, most towns' HUD area) | Yearly (Oct 1) | `www.huduser.gov/portal/datasets/FMR/FMR_2Bed_1983_2027.csv` (linked from `huduser.gov/portal/datasets/fmr.html`) | Public domain |
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
| County rent | Seasonally adjusted by whatchanged (county pattern blended with the state (or U.S.) pattern based on history length): log seasonal factors = w·own + (1−w)·state pattern, w = n/(n+8), n = fewest leak-free seasonal ratios (ratio months ≤ 2024-06, so no 2025+ value enters a factor) in any calendar month (n ≤ 8, so w ≤ 0.5). State patterns = median factors of that state's counties with ≥6 ratios in every month (≥5 such counties; else the U.S. pattern); a series with no usable ratios uses the state pattern. Shipped as `saPool` (pattern blended in) and `saW` (own weight) and said in the card/graph ⓘ. Series with no data by Jan 2024 are not published. Validated by `scripts/rent-seasonal-holdout.py` (see below) | 877 counties (129 state pattern only, 344 own weight < 0.5, 404 full history at 0.5) |
| Metro rent | Same SA method (own pattern blended with the principal city's state pattern), sanity range (−30%..+60%), Jan 2025 + latest month, outlier flag vs the county distribution; only for counties with no county row | 205 metros, 461 counties |
| City rent | Same SA method (own pattern blended with the city's state pattern), sanity range (−20%..+50%), data by Jan 2024, Jan 2025 + latest month; outlier flag vs the county distribution (a flagged city is skipped for the next city); only for counties with no county row and no usable metro; the county's most populous (Zillow SizeRank) usable city | 1 city, 1 county (Murrells Inlet SC for Georgetown County, 4 zips). ~28 more counties have a city series starting Feb 2024–Jan 2025: too short (same rule as county rows) |
| HUD Fair Market Rent (map only) | % change of the 2-BR FMR from FY2025 (effective Oct 1 2024, in force on Jan 20 2025) to the latest FY; no seasonal adjustment (yearly); sanity range (−20%..+50%); only for counties with no Zillow county, usable metro or city rent; Valdez-Cordova AK takes Chugach's. Never a map color (round 17: the county is gray, HUD's figure shows only on hover / tap as "HUD Fair Market Rent estimate … (not actual rents)"); excluded from the scale | 1,889 counties (14,284 zips); median +9.3% vs +4.5% for Zillow county rent (a 2-year, projected HUD measure); Jackson County CO (+59.2%) outside the range; Kalawao HI has no HUD row |
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
  `curRent - curRent / (1 + pct/100)`; `curRent - baseRent` includes seasonality. Covers 877 counties / 56.9% of zip-county.json zips (2026-10 build; 589 / 47.8% before short series were adjusted with their state's pattern). zip-county.json is a housing-unit-weighted Census 2020 build (`scripts/build-zip-county.ts`), not the HUD crosswalk.
- Seasonal blend (why): ZORI's Jan → Aug swing is mostly the shared spring/summer leasing season, and a county's own
  factors from a few years of ratios are noisy. Holdout test (`scripts/rent-seasonal-holdout.py`): residual seasonality
  over Jan 2025–Aug 2026, out of sample (factors use ratio months ≤ 2024-06; Dec 2024 enters one centred average with weight 1/24), as the
  spread across calendar months of the mean month-over-month % change (pp, mean over counties):

  | n (ratios/month) | counties | raw | own only | state only | blend k=8 | blend k=12 |
  |---|---|---|---|---|---|---|
  | 0–1 | 228 | 3.43 | 4.63¹ | 3.41 | 3.41 | 3.41 |
  | 2 | 65 | 2.64 | 3.40 | 2.53 | 2.50 | 2.50 |
  | 3 | 18 | 2.69 | 3.57 | 2.65 | 2.68 | 2.65 |
  | 4–5 | 42 | 2.84 | 3.10 | 2.68 | 2.67 | 2.66 |
  | 6–7 | 102 | 1.99 | 2.25 | 1.86 | 1.91 | 1.88 |
  | 8 | 403 | 1.51 | 1.57 | 1.40 | 1.39 | 1.38 |
  | all n ≥ 2 | 630 | 1.83 | 2.03 | 1.71 | 1.71 | 1.70 |

  ¹ "Own only" in the 0–1 row covers only the 109 counties with n = 1 (a series with no ratio in some calendar month has
  no own factors); the other columns cover all 228.

  The blend beats own-only factors for 524 of 630 counties (n ≥ 2) and matches state-only overall; k=12 is within
  noise of k=8, so k=8 (the decided value) ships. Baseline and current still come from the county's own series.
  The previous rule (own factors with ≥2 ratios per month, state pattern only below that) left more seasonality than no
  adjustment at all for short series.
- Seasonal-pattern caveat (round 14; round 15: measured at the displayed month): the blend is fit on ratio months
  ≤ 2024-06, but some series' seasonal swing has changed since (Manhattan's Jan → Aug swing is ≈ +4.8% in 2022–2025 vs
  +2.3% in its blended pattern). The card shows the change from Jan 2025 to the series' latest (as-of) month, so the
  bias that matters is at that calendar month: gap = the series' own recent swing (median ratios, ratio months
  ≥ 2022-01, ≥ 3 in January and in the as-of month) from January to the as-of month vs the blended pattern's, measured
  (round 16) by its effect on the shown %: gap = the shown % minus the % the same readings would show under the
  series' own recent pattern, (1 + shown) × (1 − (1 + blended swing) / (1 + own swing)), in points (the raw swing
  difference understated large changes: Blue Earth County MN −7.3 → −8.4, Winona County MN −4.7 → −5.5). Where
  |gap| > 1.5 points, `county-rent.json` / `metro-rent.json` rows carry `saCaveat {gap, month}` (month = the as-of
  month; also `rentSaCav` in `counties.json` and the county shards, `rentM.cav` for a metro stand-in) and every place
  the rent number appears says so: the card ⓘ, the trace (appended to a stale reason, never replaced), the Rent graph ⓘ,
  the county map panel ("This August reading may overstate the change by about 2.5 percentage points (≈ $Y/mo): the
  county's recent seasonal swing differs from the pattern used to adjust it", X = |gap| to one decimal, $Y = the
  card's $/mo at the shown % minus at the % less X) and the map tooltip / share image (short "†seasonal pattern
  uncertain" marker; the share image adds the footnote where it fits). The caveat never changes a number. 2026-10
  build (as of Aug 2026): 86 counties (41 overstate, 45 understate; New York County +2.7, Kings County +2.1, Oswego
  County NY −2.5, Skagit County WA −2.0, Hawaii County −2.2, Blue Earth County MN −8.4; Newport County RI none) and
  17 metros (3 overstate).
- `metro-rent.json` (rent ladder's metro rung): county FIPS → CBSA by the **OMB March 2020** delineation — verified
  as Zillow's vintage (all 1,831 Zillow county→metro labels agree with it; the 2023 delineation disagrees for 95
  metros) — and CBSA → Zillow metro by Zillow's own RegionID crosswalk (735 of 749 ZORI metros link; the 14 newer
  ones, e.g. Lebanon NH-VT, Dayton OH, have no ID link and are not used). No name matching. Adds 3,477 zips
  (VA 333, MO 179, IL 178, WV 168, …); state-pattern SA for short series adds 3,729 county zips (WI 239, PA 192, NC 149, NH 132, …).
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
