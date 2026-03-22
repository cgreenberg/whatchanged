# whatchanged.us Data Audit System — Instructions for Claude Code

## Overview

This document provides complete instructions for building an automated audit system that verifies the data displayed on whatchanged.us against multiple external sources. The audit should run weekly, test 10 random zip codes plus national data, take screenshots of both whatchanged.us and source websites, and produce a formatted report with pass/fail verdicts and tolerance analysis.

---

## 1. Website Data Architecture

### API Endpoint

All data for a given zip code comes from a single API call:

```
GET https://whatchanged.us/api/data/{zipcode}
```

Response structure:

```json
{
  "zip": "94080",
  "location": {
    "zip": "94080",
    "countyFips": "06081",
    "countyName": "San Mateo County",
    "stateName": "California",
    "stateAbbr": "CA",
    "cityName": "South San Francisco"
  },
  "unemployment": {
    "data": {
      "current": 3.5,
      "baseline": 3.8,
      "change": -0.3,
      "series": [ ... ],           // historical monthly data
      "countyFips": "06081",
      "seriesId": "LAUCN060810000000003",
      "nationalSeries": [ ... ]
    },
    "error": null,
    "fetchedAt": "2026-03-22T06:36:02.423Z",
    "sourceId": "bls-laus"
  },
  "cpi": {
    "data": {
      "groceriesCurrent": 339.865,
      "groceriesBaseline": 328.687,
      "groceriesChange": 3.4,
      "shelterChange": 3.7,
      "series": [ ... ],
      "metro": "San Francisco-Oakland-Hayward",
      "seriesIds": {
        "groceries": "CUURS49ASAF11",
        "shelter": "CUURS49ASAH1",
        "energy": "CUURS49ASA0E"
      },
      "nationalSeries": [ ... ]
    },
    "error": null,
    "fetchedAt": "2026-03-22T06:36:02.423Z",
    "sourceId": "bls-cpi"
  },
  "gas": {
    "data": {
      "current": 5.628,
      "baseline": 4.389,
      "change": 1.239,
      "region": "SAN FRANCISCO",
      "geoLevel": "San Francisco area avg",
      "isNationalFallback": false,
      "series": [ ... ],
      "nationalSeries": [ ... ]
    },
    "error": null,
    "fetchedAt": "2026-03-22T06:36:02.423Z",
    "sourceId": "eia-gas"
  },
  "tariff": {}
}
```

### Data Categories Displayed

| Category          | Displayed Value (example) | Source Label    | Source ID           |
| ----------------- | ------------------------- | --------------- | ------------------- |
| Gas Prices        | $5.63/gal                 | EIA             | eia-gas             |
| Tariff Impact     | ~$1,529/yr                | Yale Budget Lab | (computed)          |
| Housing Costs     | +3.7% since Jan 2025      | BLS CPI         | bls-cpi (shelter)   |
| Grocery Prices    | +3.4% since Jan 2025      | BLS CPI         | bls-cpi (groceries) |
| Energy Costs      | chart only                | BLS CPI         | bls-cpi (energy)    |
| Unemployment Rate | chart (current 3.5%)      | BLS LAUS        | bls-laus            |

### Charts

The site shows 6 trend charts, each with time horizon toggles (Jan 2025, 3Y, 5Y, 10Y) and a "Show national" checkbox:

1. Gas Prices ($/gal over time)
2. Grocery Prices (% change over time)
3. Housing Costs (% change over time — "Shelter" series)
4. Energy Costs (% change over time)
5. Unemployment Rate (% over time)
6. Interactive map (Leaflet/OpenStreetMap)

---

## 2. External Verification Sources

### 2A. Gas Prices (EIA)

**Primary Source: EIA Weekly Retail Gasoline Prices**

- Web view: `https://www.eia.gov/petroleum/gasdiesel/`
- API v2 base: `https://api.eia.gov/v2/`
- API docs: `https://www.eia.gov/opendata/`
- API key registration: `https://www.eia.gov/opendata/register.php` (free, required)
- Data frequency: Weekly (released Mondays)
- Geographic level: National, PADD region, ~25 metro areas
- Unit: $/gallon, regular unleaded

**Verification approach**: Call the EIA API for the same region shown on whatchanged.us (e.g., "San Francisco") and compare the latest weekly price. The site's `gas.data.region` field tells you which EIA region was used.

**EIA API v2 query example** (gas prices by region):

```
GET https://api.eia.gov/v2/petroleum/pri/grd/data/
  ?api_key={KEY}
  &frequency=weekly
  &data[0]=value
  &facets[duoarea][]=SCA
  &facets[product][]=EPM0
  &sort[0][column]=period
  &sort[0][direction]=desc
  &length=1
```

Region codes (duoarea) for EIA gas prices include:

- `SCA` = California
- `NUS` = National (US)
- Specific metro PADD codes vary — check the EIA API facets endpoint for the full list

**Secondary Source: AAA Gas Prices**

- Web view: `https://gasprices.aaa.com/`
- Geographic level: National, state, some metro areas
- Frequency: Daily
- No public API; must scrape HTML tables
- URL for state data: `https://gasprices.aaa.com/?state=CA`

**Tertiary Source: GasBuddy**

- Web view: `https://www.gasbuddy.com/charts`
- Geographic level: National, state, 50+ metro areas
- Frequency: Daily
- No public API; data embedded in interactive charts
- Can select metro area from dropdown on the charts page

**Tolerance**: Gas prices should match EIA within ±$0.05/gal (accounting for weekly timing differences). AAA and GasBuddy may differ more (±$0.15) due to methodology differences.

### 2B. BLS CPI Data (Groceries, Housing/Shelter, Energy)

**Primary Source: BLS Public Data API v2**

- API endpoint: `https://api.bls.gov/publicAPI/v2/timeseries/data/`
- API docs: `https://www.bls.gov/developers/home.htm`
- Registration: `https://data.bls.gov/registrationEngine/` (free, required for v2)
- Web viewer: `https://data.bls.gov/timeseries/{SERIES_ID}`
- Data frequency: Monthly
- Geographic level: National + ~30 metro statistical areas

**How to query BLS API v2**:

```bash
curl -X POST "https://api.bls.gov/publicAPI/v2/timeseries/data/" \
  -H "Content-Type: application/json" \
  -d '{
    "seriesid": ["CUURS49ASAF11", "CUURS49ASAH1", "CUURS49ASA0E"],
    "startyear": "2025",
    "endyear": "2026",
    "registrationkey": "{BLS_API_KEY}"
  }'
```

**CPI Series ID format**: `CUUR{AREA}{ITEM}`

- `CU` = Consumer Price Index
- `U` = Not seasonally adjusted
- `R` = Monthly
- Area code = metro identifier (e.g., `S49A` — check BLS area code tables)
- Item code = expenditure category

**Key item codes**:
| Item Code | Category |
|-----------|----------|
| SAF11 | Food at home (groceries) |
| SAH1 | Shelter (housing costs) |
| SA0E | Energy |
| SA0 | All items |

**BLS CPI series ID reference**: `https://www.bls.gov/cpi/factsheets/cpi-series-ids.htm`
**BLS area codes**: `https://www.bls.gov/help/hlpforma.htm` → select "CPI" survey

**IMPORTANT AUDIT CHECK**: The auditor MUST verify that the BLS series ID maps to the correct metro area. During initial testing, we found that series `CUURS49ASAF11` maps to **Los Angeles-Long Beach-Anaheim** on the BLS website, yet whatchanged.us labels it as "San Francisco-Oakland-Hayward". The audit should always confirm the area name returned by BLS matches what the website claims.

**Secondary Source: FRED (Federal Reserve Economic Data)**

- Web view: `https://fred.stlouisfed.org/`
- API docs: `https://fred.stlouisfed.org/docs/api/fred/`
- API key: `https://fred.stlouisfed.org/docs/api/api_key.html` (free)
- FRED mirrors BLS data with minimal lag
- Search by BLS series ID or browse CPI category: `https://fred.stlouisfed.org/categories/9`

**FRED API query example**:

```
GET https://api.stlouisfed.org/fred/series/observations
  ?series_id=CUURS49ASAF11
  &api_key={FRED_KEY}
  &file_type=json
  &sort_order=desc
  &limit=1
```

**Tertiary Source: USDA Food Price Outlook** (groceries only)

- Web view: `https://www.ers.usda.gov/data-products/food-price-outlook`
- Based on BLS CPI data (not independent, but provides forecasts)
- Monthly updates with 18-month forecast horizon
- API: `https://www.ers.usda.gov/developer/data-apis`

**Tolerance**: BLS CPI index values should match exactly (within rounding to 3 decimal places). Percentage changes computed by the site should match within ±0.1 percentage points.

### 2C. Unemployment (BLS LAUS)

**Primary Source: BLS Local Area Unemployment Statistics**

- Web view: `https://www.bls.gov/lau/`
- Data viewer: `https://data.bls.gov/timeseries/{SERIES_ID}`
- Same BLS API v2 as CPI (see above)
- Data frequency: Monthly (released ~1 month lag)
- Geographic level: National, state, county, metro, city

**LAUS Series ID format**: `LAUCN{STATE_FIPS}{COUNTY_FIPS}0000000003`

- `LA` = Local Area Unemployment
- `UCN` = County, Not seasonally adjusted
- State FIPS + County FIPS = 5 digits (e.g., 06081 = San Mateo County, CA)
- Trailing `0000000003` = unemployment rate measure

**Example**: `LAUCN060810000000003` = San Mateo County unemployment rate

**Secondary Source: California EDD (state-specific)**

- Data portal: `https://data.edd.ca.gov/`
- San Mateo LAUS: `https://data.edd.ca.gov/Labor-Force-and-Unemployment-Rates/Local-Area-Unemployment-Statistics-LAUS-San-Mateo-/5i58-iagd/data`
- OData API available for programmatic access
- Same underlying BLS data, but may be available sooner

**Secondary Source: FRED**

- FRED also mirrors BLS LAUS data
- Search for county unemployment: `https://fred.stlouisfed.org/searchresults/?st=unemployment+rate+san+mateo`

**Tolerance**: Unemployment rates should match exactly (to 1 decimal place).

### 2D. Tariff Impact

**Primary Source: Yale Budget Lab**

- Report: `https://budgetlab.yale.edu/research/where-we-stand-fiscal-economic-and-distributional-effects-all-us-tariffs`
- Methodology: Uses 10-digit HTS code product-level data with CBO income definitions
- Published household cost estimates by income decile
- NOT available via API; figures must be extracted from published reports/PDFs
- Updated periodically (not on fixed schedule)

**The tariff calculation on whatchanged.us appears to work as**:

1. Get zip-level median household income (from Census ACS or IRS SOI)
2. Apply Yale Budget Lab's distributional tariff burden estimate for that income level
3. Display as "~$X,XXX/yr based on $Y local income"

**Cross-check sources for tariff estimates**:

| Source            | URL                                                                                              | Estimate Range          |
| ----------------- | ------------------------------------------------------------------------------------------------ | ----------------------- |
| Tax Foundation    | `https://taxfoundation.org/research/all/federal/trump-tariffs-trade-war/`                        | ~$1,000-1,500/household |
| Tax Policy Center | `https://taxpolicycenter.org/features/tracking-trump-tariffs`                                    | ~$1,230/household       |
| PIIE              | `https://www.piie.com/research/trade-investment/tariffs`                                         | ~$1,200-2,600/household |
| Penn Wharton      | `https://budgetmodel.wharton.upenn.edu/`                                                         | ~$1,300/household       |
| NTU               | `https://www.ntu.org/publications/detail/new-tariffs-will-cost-us-households-over-2000-annually` | ~$2,048/household       |

**Income verification sources**:

- Census ACS (zip-level median income): `https://data.census.gov/` — Table B19013
  - API: `https://api.census.gov/data/{YEAR}/acs/acs5?get=B19013_001E&for=zip%20code%20tabulation%20area:{ZIP}`
- IRS SOI (zip-level AGI): `https://www.irs.gov/statistics/soi-tax-stats-individual-income-tax-statistics-zip-code-data-soi`
  - Downloadable CSVs by state; 1-2 year lag

**Tolerance**: Tariff impact is an estimate, so wider tolerance is acceptable. The income figure should match Census ACS within ±$2,000 (ACS has margins of error). The tariff calculation should be within ±$200 of what you'd compute from the Yale Budget Lab's published methodology.

### 2E. Housing Cost Alternatives (Cross-checks)

These are NOT the primary source but can provide sanity checks on the BLS shelter CPI trend:

| Source                      | URL                                                                                      | Level                    | Frequency | API?         |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------ | --------- | ------------ |
| Zillow ZORI                 | `https://www.zillow.com/research/data/`                                                  | Zip, city, metro, county | Monthly   | CSV download |
| Redfin Data                 | `https://www.redfin.com/news/data-center/`                                               | Zip, city, metro, county | Weekly    | CSV download |
| ApartmentList               | `https://www.apartmentlist.com/research/category/data-rent-estimates`                    | City, metro, state       | Monthly   | CSV download |
| Census ACS                  | `https://data.census.gov/` (B25064 median rent)                                          | Zip, county, metro       | Annual    | API          |
| BEA Regional Price Parities | `https://www.bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area` | State, metro             | Annual    | API          |

---

## 3. Audit Procedure

### 3A. Zip Code Selection

Each weekly audit should test **10 random zip codes** plus national-level data. To ensure geographic diversity, select zip codes from different regions:

```python
import random

# Pool of valid US zip codes spanning diverse regions and population sizes
# The auditor should maintain a larger pool; here's a starter set by region
ZIP_POOLS = {
    "northeast": ["10001", "02101", "19103", "06510", "21201"],
    "southeast": ["30301", "33101", "27601", "37201", "35203"],
    "midwest": ["60601", "48201", "55401", "63101", "43215"],
    "southwest": ["85001", "73101", "78201", "87101", "89101"],
    "west": ["90001", "94080", "98101", "80201", "97201"],
    "rural": ["59101", "82001", "05401", "72201", "38601"],
    "small_town": ["47401", "61801", "49007", "45056", "16801"]
}

def select_audit_zips(n=10):
    """Select n geographically diverse zip codes."""
    all_zips = [z for pool in ZIP_POOLS.values() for z in pool]
    return random.sample(all_zips, min(n, len(all_zips)))
```

Alternatively, the auditor can pull a random sample from a complete ZCTA file (available from Census: `https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html`).

### 3B. Data Collection Steps

For each zip code in the audit set:

**Step 1: Fetch whatchanged.us data**

```python
import requests
import json

def fetch_site_data(zip_code):
    """Fetch all data from whatchanged.us for a given zip code."""
    resp = requests.get(f"https://whatchanged.us/api/data/{zip_code}")
    resp.raise_for_status()
    return resp.json()
```

**Step 2: Take screenshot of whatchanged.us**

Use Playwright or Puppeteer to capture a full-page screenshot:

```python
from playwright.sync_api import sync_playwright

def screenshot_site(zip_code, output_path):
    """Capture full-page screenshot of whatchanged.us for a zip code."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(f"https://whatchanged.us/?zip={zip_code}", wait_until="networkidle")
        page.wait_for_timeout(3000)  # wait for charts to render
        page.screenshot(path=output_path, full_page=True)
        browser.close()
```

**Step 3: Fetch and screenshot primary source data**

For each data category, query the government API AND take a screenshot of the web view:

```python
def verify_gas_price(site_data, screenshots_dir):
    """Verify gas price against EIA."""
    gas = site_data["gas"]["data"]
    region = gas["region"]

    # 1. Query EIA API
    eia_resp = requests.get("https://api.eia.gov/v2/petroleum/pri/grd/data/", params={
        "api_key": EIA_API_KEY,
        "frequency": "weekly",
        "data[0]": "value",
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "length": 5
    })
    eia_data = eia_resp.json()

    # 2. Screenshot EIA web page
    screenshot_url(
        "https://www.eia.gov/petroleum/gasdiesel/",
        f"{screenshots_dir}/eia_gas.png"
    )

    # 3. Screenshot AAA for cross-reference
    state_abbr = site_data["location"]["stateAbbr"]
    screenshot_url(
        f"https://gasprices.aaa.com/?state={state_abbr}",
        f"{screenshots_dir}/aaa_gas.png"
    )

    return {
        "category": "gas_price",
        "site_value": gas["current"],
        "eia_value": eia_data,  # parse latest value
        "tolerance": 0.05,
        "unit": "$/gal"
    }


def verify_cpi_data(site_data, screenshots_dir):
    """Verify CPI data (groceries, shelter, energy) against BLS API."""
    cpi = site_data["cpi"]["data"]
    series_ids = cpi["seriesIds"]

    # 1. Query BLS API v2
    bls_resp = requests.post(
        "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        json={
            "seriesid": list(series_ids.values()),
            "startyear": "2025",
            "endyear": "2026",
            "registrationkey": BLS_API_KEY
        }
    )
    bls_data = bls_resp.json()

    # 2. Screenshot each BLS series web view
    for name, series_id in series_ids.items():
        screenshot_url(
            f"https://data.bls.gov/timeseries/{series_id}",
            f"{screenshots_dir}/bls_{name}.png"
        )

    # 3. CRITICAL: Verify the metro area name matches
    # Parse the BLS page to confirm the area matches site_data["cpi"]["data"]["metro"]

    # 4. Also screenshot FRED as secondary verification
    for name, series_id in series_ids.items():
        screenshot_url(
            f"https://fred.stlouisfed.org/series/{series_id}",
            f"{screenshots_dir}/fred_{name}.png"
        )

    return {
        "category": "cpi",
        "groceries_site": cpi["groceriesCurrent"],
        "shelter_change_site": cpi["shelterChange"],
        "bls_values": bls_data,  # parse to compare
        "tolerance_index": 0.01,  # absolute index value
        "tolerance_pct": 0.1      # percentage points
    }


def verify_unemployment(site_data, screenshots_dir):
    """Verify unemployment rate against BLS LAUS."""
    unemp = site_data["unemployment"]["data"]
    series_id = unemp["seriesId"]

    # 1. Query BLS API
    bls_resp = requests.post(
        "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        json={
            "seriesid": [series_id],
            "startyear": "2024",
            "endyear": "2026",
            "registrationkey": BLS_API_KEY
        }
    )

    # 2. Screenshot BLS viewer
    screenshot_url(
        f"https://data.bls.gov/timeseries/{series_id}",
        f"{screenshots_dir}/bls_unemployment.png"
    )

    # 3. Screenshot FRED
    screenshot_url(
        f"https://fred.stlouisfed.org/series/{series_id}",
        f"{screenshots_dir}/fred_unemployment.png"
    )

    return {
        "category": "unemployment",
        "site_value": unemp["current"],
        "site_baseline": unemp["baseline"],
        "bls_value": None,  # parse from API response
        "tolerance": 0.1    # percentage points
    }
```

**Step 4: Verify tariff calculations**

```python
def verify_tariff(site_data, screenshots_dir):
    """Verify tariff impact calculation."""
    # The tariff data may be computed client-side
    # Check the displayed income figure against Census ACS
    zip_code = site_data["zip"]

    # 1. Query Census ACS for median household income
    census_resp = requests.get(
        f"https://api.census.gov/data/2023/acs/acs5",
        params={
            "get": "B19013_001E",
            "for": f"zip code tabulation area:{zip_code}",
            "key": CENSUS_API_KEY
        }
    )

    # 2. Screenshot Yale Budget Lab report
    screenshot_url(
        "https://budgetlab.yale.edu/research/where-we-stand-fiscal-economic-and-distributional-effects-all-us-tariffs",
        f"{screenshots_dir}/yale_tariff.png"
    )

    # 3. Screenshot Tax Foundation for cross-reference
    screenshot_url(
        "https://taxfoundation.org/research/all/federal/trump-tariffs-trade-war/",
        f"{screenshots_dir}/taxfoundation_tariff.png"
    )

    return {
        "category": "tariff",
        "displayed_income": None,  # extract from page
        "census_income": None,     # parse from API
        "tolerance_income": 2000,
        "tolerance_tariff": 200
    }
```

### 3C. Comparison Logic

```python
def compare_values(site_value, source_value, tolerance, unit=""):
    """Compare a site value against a source value within tolerance."""
    if site_value is None or source_value is None:
        return {"status": "SKIP", "reason": "Missing data"}

    diff = abs(site_value - source_value)
    pct_diff = (diff / source_value * 100) if source_value != 0 else float('inf')

    passed = diff <= tolerance

    return {
        "status": "PASS" if passed else "FAIL",
        "site_value": site_value,
        "source_value": source_value,
        "difference": round(diff, 4),
        "pct_difference": round(pct_diff, 2),
        "tolerance": tolerance,
        "unit": unit
    }
```

### 3D. Tolerance Table

| Data Point        | Primary Source      | Tolerance | Rationale                 |
| ----------------- | ------------------- | --------- | ------------------------- |
| Gas price ($/gal) | EIA API             | ±$0.05    | Weekly timing differences |
| Gas price vs AAA  | AAA website         | ±$0.15    | Different methodology     |
| CPI index value   | BLS API             | ±0.01     | Should be exact match     |
| CPI % change      | BLS (computed)      | ±0.1 pp   | Rounding differences      |
| Unemployment rate | BLS LAUS API        | ±0.0      | Should be exact match     |
| Median income     | Census ACS          | ±$2,000   | ACS margin of error       |
| Tariff estimate   | Yale Budget Lab     | ±$200     | Estimate uncertainty      |
| Metro area name   | BLS series metadata | EXACT     | Must match precisely      |

---

## 4. Audit Report Format

Each weekly report should be a standalone document (HTML or PDF) containing:

### Report Header

- Report title: "whatchanged.us Weekly Data Audit"
- Date/time of audit run
- Auditor: "Automated Audit System v1.0"
- Overall verdict: PASS / FAIL / PARTIAL (with count of checks)

### Executive Summary

- Total checks performed
- Checks passed / failed / skipped
- Critical findings (any exact-match failures)
- Advisory findings (tolerance-based concerns)

### Per-Zip-Code Section

For each of the 10 zip codes + national:

```
## Zip Code: 94080 — South San Francisco, CA (San Mateo County)

### Gas Prices
| Metric | whatchanged.us | EIA (primary) | AAA (cross-check) | Verdict |
|--------|---------------|---------------|-------------------|---------|
| Current price | $5.63/gal | $5.48/gal | $5.51/gal | ⚠️ WARN |
| Difference | — | +$0.15 | +$0.12 | Over tolerance |

**Screenshots:**
[whatchanged.us gas card] [EIA weekly prices page] [AAA state page]

### CPI — Groceries (Food at Home)
| Metric | whatchanged.us | BLS API | FRED (cross-check) | Verdict |
|--------|---------------|---------|---------------------|---------|
| Current index | 339.865 | 339.865 | 339.865 | ✅ PASS |
| % change since Jan 2025 | +3.4% | +3.4% | — | ✅ PASS |
| Metro area label | SF-Oakland-Hayward | ⚠️ CHECK SERIES | — | ⚠️ CHECK |

**Screenshots:**
[whatchanged.us grocery card] [BLS timeseries page] [FRED series page]

### CPI — Shelter (Housing Costs)
... (same format)

### CPI — Energy
... (same format)

### Unemployment
| Metric | whatchanged.us | BLS LAUS | CA EDD | Verdict |
|--------|---------------|----------|--------|---------|
| Current rate | 3.5% | 3.5% | 3.5% | ✅ PASS |
| Baseline (Jan 2025) | 3.8% | 3.8% | — | ✅ PASS |

### Tariff Impact
| Metric | whatchanged.us | Census ACS | Yale Budget Lab | Verdict |
|--------|---------------|------------|-----------------|---------|
| Local income | $74,580 | $76,200 | — | ✅ PASS (within ±$2k) |
| Tariff estimate | $1,529/yr | — | ~$1,500 range | ✅ PASS |
```

### Appendix: Screenshots

All screenshots should be embedded in the report with timestamps and source URLs.

### Appendix: Raw API Responses

Include truncated JSON responses from each source API for reproducibility.

---

## 5. Special Checks

Beyond value comparisons, the audit should perform these structural checks:

### 5A. Series ID → Metro Area Verification

**This is critical.** For every BLS CPI series ID the site returns, the auditor must:

1. Call the BLS API and inspect the `seriesName` or `area` field in the response
2. OR scrape the BLS timeseries page (`https://data.bls.gov/timeseries/{ID}`) and extract the "Area:" field
3. Compare against the `metro` field from whatchanged.us
4. Flag as FAIL if they don't match

This catches bugs where the wrong area code is used (e.g., showing LA data labeled as SF).

### 5B. Data Freshness

Check that `fetchedAt` timestamps are recent:

- Gas prices: should be within 7 days of current date
- CPI data: should be within 45 days (monthly release cycle)
- Unemployment: should be within 45 days
- Flag as STALE if data is older than expected

### 5C. Baseline Consistency

Verify that the "since Jan 2025" baseline values are correct:

- Fetch the Jan 2025 data point from the series array
- Compute the change independently
- Compare against the displayed change value

### 5D. National Data Consistency

When "Show national" is toggled, verify national series data against:

- BLS national CPI series (CUUR0000SAF11, CUUR0000SAH1, etc.)
- EIA national gas price
- BLS national unemployment (LNS14000000)

### 5E. Historical Series Spot-Checks

For each chart, pick 3 random data points from the historical series and verify them against the BLS/EIA API response for that specific month.

### 5F. Rendered Page vs. API Consistency (DOM Scraping)

**This is a critical layer.** The API could return correct data while the frontend renders it wrong due to a display bug, rounding error, or stale cache. The auditor MUST scrape the actual rendered DOM and compare against the API response.

Use Playwright to extract visible values from the page after it fully renders:

```python
def scrape_rendered_values(zip_code):
    """Scrape the actual values the user sees on the page, not just the API."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(f"https://whatchanged.us/?zip={zip_code}", wait_until="networkidle")
        page.wait_for_timeout(3000)

        rendered = {}

        # Extract the four headline values from the card elements
        # Gas price card: look for the $/gal text
        gas_el = page.query_selector("text=/\\$[0-9]+\\.[0-9]+\\/gal/")
        if gas_el:
            rendered["gas_price_displayed"] = gas_el.inner_text()

        # Tariff card: look for the ~/yr text
        tariff_el = page.query_selector("text=/~\\$[0-9,]+\\/yr/")
        if tariff_el:
            rendered["tariff_displayed"] = tariff_el.inner_text()

        # Housing card: look for the +X.X% text
        # Grocery card: similar pattern
        # Also extract the source attribution text (e.g. "BLS CPI · Mar 2026 · metro: ...")

        # Extract all text content for regex parsing as fallback
        body_text = page.query_selector("body").inner_text()
        rendered["full_text"] = body_text

        browser.close()
        return rendered
```

For each zip code, compare:

1. API response `gas.data.current` (5.628) → rendered "$5.63/gal" (should round correctly)
2. API response `cpi.data.groceriesChange` (3.4) → rendered "+3.4%" (should match)
3. API response `cpi.data.shelterChange` (3.7) → rendered "+3.7%" (should match)
4. API response `unemployment.data.current` (3.5) → rendered chart tooltip (should match)
5. Source attribution text (metro name, date, source label) → API metadata (should match)

**Tolerance**: Rendered values should match the API exactly after expected rounding/formatting. Any difference is a frontend bug.

### 5G. Independent Computation Verification

The site computes derived values (percentage changes, dollar impacts) from raw series data. The auditor must re-derive these independently:

```python
def verify_computations(site_data):
    """Independently recompute all derived values from the raw series data."""
    results = []

    # 1. Gas price change since Jan 2025
    gas = site_data["gas"]["data"]
    gas_series = gas["series"]  # list of {date, price} objects
    jan_2025 = next((p for p in gas_series if p["date"].startswith("2025-01")), None)
    latest = gas_series[-1] if gas_series else None
    if jan_2025 and latest:
        computed_change = round(latest["price"] - jan_2025["price"], 3)
        results.append({
            "check": "gas_change_since_jan2025",
            "site_says": gas["change"],
            "recomputed": computed_change,
            "match": abs(gas["change"] - computed_change) < 0.01
        })

    # 2. CPI grocery % change
    cpi = site_data["cpi"]["data"]
    cpi_series = cpi["series"]
    jan_2025_cpi = next((p for p in cpi_series if p["date"].startswith("2025-01")), None)
    latest_cpi = cpi_series[-1] if cpi_series else None
    if jan_2025_cpi and latest_cpi:
        # The series contains index values; % change = (latest - baseline) / baseline * 100
        computed_grocery_change = round(
            (cpi["groceriesCurrent"] - cpi["groceriesBaseline"]) / cpi["groceriesBaseline"] * 100,
            1
        )
        results.append({
            "check": "grocery_pct_change",
            "site_says": cpi["groceriesChange"],
            "recomputed": computed_grocery_change,
            "match": abs(cpi["groceriesChange"] - computed_grocery_change) < 0.15
        })

    # 3. Unemployment change
    unemp = site_data["unemployment"]["data"]
    computed_unemp_change = round(unemp["current"] - unemp["baseline"], 1)
    results.append({
        "check": "unemployment_change",
        "site_says": unemp["change"],
        "recomputed": computed_unemp_change,
        "match": abs(unemp["change"] - computed_unemp_change) < 0.05
    })

    # 4. Verify baseline values actually correspond to Jan 2025 in the series
    # (catches bugs where baseline is from the wrong month)

    return results
```

Any mismatch here means the site's own internal math is wrong, regardless of whether the source data is correct.

### 5H. Truly Independent Cross-Checks (Non-Government Sources)

FRED mirrors BLS, so it is NOT an independent verification — it confirms the API pull was correct but not that the data is reasonable. The audit should include sources that collect data independently:

**Gas Prices — Independent Sources:**
| Source | Independence | How to Compare |
|--------|-------------|----------------|
| AAA (gasprices.aaa.com) | Fully independent — surveys ~60,000 stations | State/metro avg should be within ±$0.15 of EIA |
| GasBuddy (gasbuddy.com/charts) | Fully independent — crowdsourced from users | Metro avg should be within ±$0.20 of EIA |

**Housing Costs — Independent Sources:**

BLS CPI Shelter is an index, so direct comparison requires deriving % change rates:

| Source             | URL                                                                   | What to Compare                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zillow ZORI        | `https://www.zillow.com/research/data/` (CSV download)                | YoY % change in observed rent for the same metro. If BLS shelter says +3.7% and Zillow says +8%, that's a red flag worth noting (they measure different things but should trend similarly) |
| Redfin Rental Data | `https://www.redfin.com/news/data-center/`                            | Median rent YoY change for same metro                                                                                                                                                      |
| ApartmentList      | `https://www.apartmentlist.com/research/category/data-rent-estimates` | National and metro rent growth rates                                                                                                                                                       |

These won't match BLS exactly (BLS measures owner-equivalent rent + actual rent, not market asking rents), but **the direction and rough magnitude should agree**. If BLS says housing costs are up 3.7% but Zillow and Redfin both say rents dropped 2%, that's a data integrity red flag.

**Grocery Prices — Independent Sources:**

| Source                               | URL                                                         | What to Compare                                                                                                |
| ------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| USDA ERS Food Price Outlook          | `https://www.ers.usda.gov/data-products/food-price-outlook` | Their "food-at-home" CPI forecast vs. actual. Provides context for whether the BLS number is in expected range |
| Instacart/grocery delivery platforms | Scrape category prices for a standard basket                | Very rough sanity check only                                                                                   |
| NielsenIQ / FMI reports              | Published industry reports on grocery inflation             | Annual summaries; useful for "is 3.4% in the right ballpark" checks                                            |

**Unemployment — Independent Sources:**

| Source                                 | URL                               | What to Compare                                                                           |
| -------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| State employment agency (e.g., CA EDD) | `https://data.edd.ca.gov/`        | Should match BLS LAUS exactly (same methodology) but confirms data pipeline independently |
| Indeed Hiring Lab                      | `https://www.hiringlab.org/data/` | Job postings trend — directional cross-check                                              |

**Tariff Estimates — Independent Sources:**

| Source                         | URL                                                                       | Estimate to Compare         |
| ------------------------------ | ------------------------------------------------------------------------- | --------------------------- |
| Tax Foundation                 | `https://taxfoundation.org/research/all/federal/trump-tariffs-trade-war/` | Household burden estimate   |
| Tax Policy Center              | `https://taxpolicycenter.org/features/tracking-trump-tariffs`             | Distributional analysis     |
| PIIE (Peterson Institute)      | `https://www.piie.com/research/trade-investment/tariffs`                  | Household cost estimates    |
| Penn Wharton Budget Model      | `https://budgetmodel.wharton.upenn.edu/`                                  | Dynamic scoring estimates   |
| NTU (National Taxpayers Union) | `https://www.ntu.org/`                                                    | Per-household tariff burden |

For tariffs, the audit should report ALL available estimates in a comparison table. Since estimates range from ~$1,000 to ~$2,600 per household depending on methodology, the key check is whether whatchanged.us falls within this range and correctly attributes its source (Yale Budget Lab).

### 5I. Source Link Verification

The site displays source attribution links (e.g., "EIA", "BLS CPI", "Yale Budget Lab") that should point to the correct pages. The auditor should:

1. Extract all `<a>` tags from the rendered page
2. Verify each link resolves (HTTP 200, no redirect to error page)
3. Verify the destination page actually contains relevant data for the claimed metro/region
4. Flag broken links or links that point to the wrong geographic area

---

## 6. Required API Keys

The whatchanged.us repo already has API keys for EIA and BLS in its environment configuration (`.env` or deployment secrets). **Reuse those keys for the audit** — do not register new ones unless the existing keys hit rate limits.

If additional keys are needed:

| Service    | Registration URL                                    | Key Name       |
| ---------- | --------------------------------------------------- | -------------- |
| EIA API v2 | `https://www.eia.gov/opendata/register.php`         | EIA_API_KEY    |
| BLS API v2 | `https://data.bls.gov/registrationEngine/`          | BLS_API_KEY    |
| FRED API   | `https://fred.stlouisfed.org/docs/api/api_key.html` | FRED_API_KEY   |
| Census API | `https://api.census.gov/data/key_signup.html`       | CENSUS_API_KEY |

Store any new keys in environment variables or a `.env` file (never commit to git).

---

## 7. Implementation Architecture

### Recommended Stack

```
audit-system/
├── config/
│   ├── .env                    # API keys (reuse from whatchanged.us repo)
│   ├── zip_pools.json          # Zip codes by region
│   └── tolerances.json         # Tolerance thresholds per data category
├── src/
│   ├── fetchers/
│   │   ├── whatchanged.py      # Fetch from whatchanged.us API
│   │   ├── eia.py              # Fetch from EIA API v2
│   │   ├── bls.py              # Fetch from BLS API v2 (CPI + LAUS)
│   │   ├── fred.py             # Fetch from FRED API
│   │   ├── census.py           # Fetch from Census ACS API
│   │   └── scrapers.py         # AAA, GasBuddy, Yale Budget Lab, Zillow CSV
│   ├── screenshots/
│   │   └── capture.py          # Playwright screenshot logic
│   ├── dom_scraper/
│   │   └── rendered_values.py  # Scrape actual displayed values from the page DOM
│   ├── comparators/
│   │   ├── gas.py              # Gas price comparison (EIA + AAA + GasBuddy)
│   │   ├── cpi.py              # CPI comparison (BLS + Zillow/Redfin direction)
│   │   ├── unemployment.py     # Unemployment comparison (BLS + state EDD)
│   │   ├── tariff.py           # Tariff comparison (Yale + Tax Foundation + TPC)
│   │   ├── rendered_vs_api.py  # Compare DOM-scraped values to API response
│   │   └── computation.py      # Re-derive all % changes and $ amounts from series
│   ├── validators/
│   │   ├── series_metro_map.py # Verify BLS series IDs map to claimed metro areas
│   │   ├── freshness.py        # Check fetchedAt timestamps are recent
│   │   ├── link_checker.py     # Verify all source attribution links resolve
│   │   └── baseline.py         # Confirm baseline values match Jan 2025 series point
│   ├── report/
│   │   └── generator.py        # HTML/PDF report builder (Jinja2 templates)
│   └── main.py                 # Orchestrator
├── reports/                    # Generated reports (timestamped)
├── screenshots/                # Screenshot artifacts (organized by date/zip)
└── requirements.txt
```

### Key Dependencies

```
requests
playwright
jinja2          # HTML report templating
weasyprint      # HTML → PDF conversion (optional)
Pillow          # Image processing for screenshots
python-dotenv   # .env file loading
```

### Execution Flow

```python
# main.py pseudocode
def run_weekly_audit():
    timestamp = datetime.now().isoformat()
    zip_codes = select_audit_zips(10)

    results = []
    for zip_code in zip_codes:
        zip_dir = f"screenshots/{timestamp}/{zip_code}"
        os.makedirs(zip_dir, exist_ok=True)

        # 1. Fetch site data
        site_data = fetch_site_data(zip_code)

        # 2. Screenshot the site
        screenshot_site(zip_code, f"{zip_dir}/whatchanged_full.png")

        # 3. Run all verifications
        gas_result = verify_gas_price(site_data, zip_dir)
        cpi_result = verify_cpi_data(site_data, zip_dir)
        unemp_result = verify_unemployment(site_data, zip_dir)
        tariff_result = verify_tariff(site_data, zip_dir)

        # 4. Run structural checks
        series_check = verify_series_metro_mapping(site_data, zip_dir)
        freshness_check = verify_data_freshness(site_data)
        baseline_check = verify_baseline_calculation(site_data)

        results.append({
            "zip": zip_code,
            "location": site_data["location"],
            "checks": [gas_result, cpi_result, unemp_result, tariff_result,
                       series_check, freshness_check, baseline_check]
        })

    # 5. Generate report
    report = generate_report(results, timestamp)
    save_report(report, f"reports/audit_{timestamp}.html")

    return report
```

---

## 8. Scheduling

Run the audit weekly (e.g., every Monday at 9 AM) via cron, GitHub Actions, or a scheduled task:

```bash
# crontab entry
0 9 * * 1 cd /path/to/audit-system && python src/main.py
```

Or use GitHub Actions:

```yaml
name: Weekly Data Audit
on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch: # allow manual trigger

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: npx playwright install chromium
      - run: python src/main.py
        env:
          EIA_API_KEY: ${{ secrets.EIA_API_KEY }}
          BLS_API_KEY: ${{ secrets.BLS_API_KEY }}
          FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
          CENSUS_API_KEY: ${{ secrets.CENSUS_API_KEY }}
      - uses: actions/upload-artifact@v4
        with:
          name: audit-report-${{ github.run_id }}
          path: reports/
```

---

## 9. Known Issues and Edge Cases

1. **EIA region mapping**: Not all zip codes map to an EIA metro-level gas price region. The site falls back to PADD region or national. The audit should check `gas.data.isNationalFallback` and adjust expectations.

2. **BLS CPI metro coverage**: Only ~30 metro areas have CPI data. Rural zip codes will map to the nearest metro or use national data. Check how the site handles this fallback.

3. **Tariff data is empty in API**: The API returns `"tariff": {}` — the tariff calculation appears to happen client-side. The audit may need to scrape the rendered page rather than rely on the API.

4. **BLS data lapse**: BLS data has a note: "Data unavailable due to the 2025 lapse in appropriations." Some months may have gaps. The audit should handle missing data points gracefully.

5. **Rate limiting**: EIA allows 1,000 requests/day per key. BLS allows 500/day. Batch requests and add delays between calls to stay within limits.

6. **Series ID verification is paramount**: The single most valuable check in this audit is confirming that BLS series IDs map to the correct geographic area. A wrong area code means the data is from the wrong city entirely, but may still "look right" (similar index values).

---

## 10. Sample Audit Checklist (per zip code)

### Layer 1: API Correctness (does the site pull the right data?)

```
□ whatchanged.us API returns valid data (no errors)
□ Gas price matches EIA API within ±$0.05
□ CPI groceries index matches BLS API exactly (±0.01)
□ CPI shelter change matches BLS within ±0.1pp
□ CPI energy data present and reasonable
□ Unemployment rate matches BLS LAUS API exactly
□ ALL BLS series IDs verified to map to correct metro area name
□ Data freshness: all fetchedAt within expected window
□ 3 random historical data points spot-checked against source API
```

### Layer 2: Rendered Page Correctness (does the frontend show the right data?)

```
□ Full-page screenshot captured
□ DOM-scraped gas price matches API response (after rounding)
□ DOM-scraped grocery % change matches API response
□ DOM-scraped housing % change matches API response
□ DOM-scraped tariff estimate matches API response
□ Source attribution text (metro, date) matches API metadata
□ All source links resolve (HTTP 200) and point to correct pages
```

### Layer 3: Internal Math (are derived values computed correctly?)

```
□ Gas price change recomputed from series matches site's displayed change
□ Grocery % change recomputed from (current - baseline) / baseline matches
□ Shelter % change recomputed from series matches
□ Unemployment change recomputed from current - baseline matches
□ Baseline values confirmed to correspond to Jan 2025 in series data
□ Dollar-amount impacts (e.g., "~$204/yr more") recomputed and verified
```

### Layer 4: Independent Cross-Checks (is the data in the right ballpark?)

```
□ Gas price cross-checked against AAA (within ±$0.15)
□ Gas price cross-checked against GasBuddy (within ±$0.20)
□ Housing cost trend direction matches Zillow ZORI trend direction
□ Housing cost trend direction matches Redfin rental data direction
□ Grocery inflation rate in plausible range per USDA Food Price Outlook
□ Unemployment rate confirmed via state employment agency (e.g., CA EDD)
□ Tariff estimate falls within range of Tax Foundation / TPC / PIIE estimates
□ Income figure matches Census ACS within ±$2,000
□ National data toggle verified against national-level sources
```

### Layer 5: Screenshots and Evidence

```
□ whatchanged.us full-page screenshot
□ EIA gas price page screenshot
□ AAA state gas price page screenshot
□ BLS timeseries page screenshot for each CPI series
□ BLS LAUS page screenshot for unemployment
□ FRED series page screenshots (secondary)
□ Yale Budget Lab report page screenshot
□ All screenshots timestamped and embedded in report
```
