# Mapping Strategy — whatchanged.us

## Overview

This document describes every geographic and economic mapping decision in the whatchanged.us
data pipeline. The full chain is:

```
User zip code
  → county FIPS (HUD USPS crosswalk)
  → CPI area code (CBSA crosswalk → Census Division → Regional → National)
  → EIA gas duoarea (county override → CPI-chained city → state → PAD district)
  → LAUS unemployment series ID (county FIPS, with CT Planning Region remap)
  → Census ACS zip-level income and rent (static JSON)
```

Each step has multiple fallback tiers. Bugs in this chain are the #1 source of incorrect
displayed data — verify any change with `npx tsx scripts/audit-zip-mappings.ts`.

---

## Zip → County FIPS

**Source:** HUD USPS Residential Address Crosswalk
**File:** `src/lib/data/zip-county.json` (built by `scripts/process-crosswalk.ts`)
**Reference:** https://www.huduser.gov/portal/datasets/usps_crosswalk.html

**Why HUD and not Census ZCTA:**
HUD's crosswalk is derived from actual USPS residential delivery records, not
census-defined ZCTAs. It reflects where people actually live, making it more accurate
for income and economic data lookups. ZCTAs can lag real-world zip code assignments.

**Update frequency:** HUD publishes quarterly. The bundled file should be refreshed
annually or whenever new zip codes appear in user traffic. Rebuild with
`scripts/process-crosswalk.ts` after downloading a new crosswalk file.

**Multi-county zips:** When a zip code spans multiple counties, HUD provides a ratio
of residential addresses in each. The code selects the county with the highest
residential address ratio. This is the correct heuristic for economic data (income,
unemployment) which is population-weighted.

**Territories:** Puerto Rico (PR), U.S. Virgin Islands (VI), and Guam (GU) have FIPS
codes but no BLS county-level unemployment data and no EIA gas price data. They fall
through to Tier 4 (national CPI) and the national gas fallback.

---

## County → BLS CPI Area (4-Tier Fallback)

**Function:** `getMetroCpiAreaForCounty(countyFips, stateAbbr)` in
`src/lib/mappings/county-metro-cpi.ts`

**Returns:** `{ areaCode, areaName, tier }` where tier = 1 | 2 | 3 | 4

**Series ID format:**
- Groceries (food at home): `CUUR{areaCode}SAF11`
- Shelter: `CUUR{areaCode}SAH1`
- Energy: `CUUR{areaCode}SA0E`

**BLS CPI API:** https://api.bls.gov/publicAPI/v2/timeseries/data/
**BLS series explorer:** https://data.bls.gov/timeseries/CUUR{code}SAF11

### Tier 1 — CBSA Metro CPI (23 metros)

Covers 204 counties matched to a BLS-sampled metropolitan CPI area via the OMB CBSA
delineation file. Built by `scripts/build-cbsa-cpi-crosswalk.ts` and stored in
`src/lib/data/cbsa-cpi-crosswalk.json`.

Approximately 16.5% of the 33,780 US zip codes fall into Tier 1.

| Code  | Name                                     | Census Region |
|-------|------------------------------------------|---------------|
| S11A  | Boston-Cambridge-Newton                  | Northeast     |
| S12A  | New York-Newark-Jersey City              | Northeast     |
| S12B  | Philadelphia-Camden-Wilmington           | Northeast     |
| S23A  | Chicago-Naperville-Elgin                 | Midwest       |
| S23B  | Detroit-Warren-Dearborn                  | Midwest       |
| S24A  | Minneapolis-St. Paul-Bloomington         | Midwest       |
| S24B  | St. Louis                                | Midwest       |
| S35A  | Washington-Arlington-Alexandria          | South         |
| S35B  | Miami-Fort Lauderdale-West Palm Beach    | South         |
| S35C  | Atlanta-Sandy Springs-Roswell            | South         |
| S35D  | Tampa-St. Petersburg-Clearwater          | South         |
| S35E  | Baltimore-Columbia-Towson                | South         |
| S37A  | Dallas-Fort Worth-Arlington              | South         |
| S37B  | Houston-The Woodlands-Sugar Land         | South         |
| S48A  | Phoenix-Mesa-Scottsdale                  | West          |
| S48B  | Denver-Aurora-Lakewood                   | West          |
| S49A  | Los Angeles-Long Beach-Anaheim           | West          |
| S49B  | San Francisco-Oakland-Hayward            | West          |
| S49C  | Riverside-San Bernardino-Ontario         | West          |
| S49D  | Seattle-Tacoma-Bellevue                  | West          |
| S49E  | San Diego-Carlsbad                       | West          |
| S49F  | Urban Hawaii                             | West          |
| S49G  | Urban Alaska                             | West          |

**Important:** Each BLS CPI area corresponds to exactly one CBSA (the BLS
"self-representing" metro from the 2018 geographic revision). Only counties in that
specific CBSA are in Tier 1 — not nearby counties that are geographically close but
belong to a different CBSA. Do not add counties to the crosswalk unless BLS explicitly
samples that county's CBSA for the area.

**Updating:** If OMB revises CBSA boundaries, download the new delineation file and
re-run `scripts/build-cbsa-cpi-crosswalk.ts`. Also update `CBSA_TO_CPI` in that file
if BLS adds or changes metro CPI areas.

### Tier 2 — Census Division CPI (9 divisions)

Used when a county is not in any sampled CBSA. Covers all 50 states + DC.
Approximately 83% of US zip codes fall here.

| Code  | Name                  | States                                        |
|-------|-----------------------|-----------------------------------------------|
| 0110  | New England           | CT, ME, MA, NH, RI, VT                        |
| 0120  | Middle Atlantic       | NJ, NY, PA                                    |
| 0230  | East North Central    | IL, IN, MI, OH, WI                            |
| 0240  | West North Central    | IA, KS, MN, MO, NE, ND, SD                   |
| 0350  | South Atlantic        | DE, DC, FL, GA, MD, NC, SC, VA, WV            |
| 0360  | East South Central    | AL, KY, MS, TN                                |
| 0370  | West South Central    | AR, LA, OK, TX                                |
| 0480  | Mountain              | AZ, CO, ID, MT, NV, NM, UT, WY               |
| 0490  | Pacific               | AK, CA, HI, OR, WA                            |

### Tier 3 — Census Regional CPI (4 regions)

Defensive fallback — as of writing, all 50 states are covered by Tier 2 divisions, so
Tier 3 is effectively unreachable for the 50 states. Reserved for future gaps.

| Code  | Name            |
|-------|-----------------|
| 0100  | Northeast Urban |
| 0200  | Midwest Urban   |
| 0300  | South Urban     |
| 0400  | West Urban      |

State assignments (mirrors Census region definitions):
- Northeast (0100): CT, ME, MA, NH, NJ, NY, PA, RI, VT
- Midwest (0200): IL, IN, IA, KS, MI, MN, MO, NE, ND, OH, SD, WI
- South (0300): AL, AR, DE, DC, FL, GA, KY, LA, MD, MS, NC, OK, SC, TN, TX, VA, WV
- West (0400): AK, AZ, CA, CO, HI, ID, MT, NV, NM, OR, UT, WA, WY

### Tier 4 — National CPI (code 0000)

Used only for US territories (PR, VI, GU) where no state-level mapping exists. Falls
back to national series `CUUR0000SAF11`, `CUUR0000SAH1`, `CUUR0000SA0E`.

**Cache note:** National CPI data uses a shared cache key (`bls:cpi:0000:all`) — never
fetched per-zip. Flushing this key costs exactly 1 BLS API call.

---

## County → EIA Gas Region (4-Tier Fallback)

**Function:** `getGasLookup(stateAbbr, cpiAreaCode?, countyFips?)` in `src/lib/api/eia.ts`
**Mapping tables:** `src/lib/mappings/eia-gas.ts`

**EIA API:** https://api.eia.gov/v2/petroleum/pri/gnd/data/
**Product filter:** `EPM0` (all grades, all formulations retail gasoline)

**Returns:** `{ duoarea, geoLevel, tier, cacheKey }` where tier = 1 | 2 | 3

### Tier 1a — County FIPS Override → EIA City/Region

Direct county → duoarea overrides defined in `COUNTY_EIA_CITY_OVERRIDES`. Used when
geographic distance or pipeline infrastructure makes the CPI-chained city price
misleading. Overrides are applied before the CPI chain lookup.

Key overrides:
- Ohio/Cuyahoga metro counties (39035, 39093, 39085, 39055, 39103) → Cleveland (`YCLE`)
- SW Washington counties in Portland MSA (53011, 53015, 53059) → WA state avg (`SWA`)
  (EIA has no Portland city series; Seattle would be wrong)
- Jacksonville FL (12031) and Orlando FL (12095) → FL state avg (`SFL`)
  (Miami city avg is inappropriate for north/central FL)
- Upstate NY counties (Buffalo 36029, Rochester 36055, Syracuse 36067) → NY state avg (`SNY`)
- All Louisiana parishes → Gulf Coast avg (`R30`)

Additional distance-based overrides were generated by `scripts/audit-gas-assignments.ts`
for counties more than 100 miles from their CPI-chained EIA city. These cover distant
counties in AK, CA, CO, FL, IA, ID, IL, IN, KS, KY, and other states.

### Tier 1b — CPI Metro Code → EIA City

Maps BLS CPI metro area codes to EIA city duoarea codes. Only metro CPI codes (S\*\*\*)
are in this table — regional codes (01xx–04xx) intentionally fall through to state/PAD.

| CPI Code | Metro Name                    | EIA Duoarea | Label                  |
|----------|-------------------------------|-------------|------------------------|
| S49D     | Seattle-Tacoma-Bellevue       | Y48SE       | Seattle area avg       |
| S49A     | Los Angeles-Long Beach-Anaheim | Y05LA      | Los Angeles area avg   |
| S49B     | San Francisco-Oakland-Hayward | Y05SF       | San Francisco area avg |
| S12A     | New York-Newark-Jersey City   | Y35NY       | New York City area avg |
| S11A     | Boston-Cambridge-Newton       | YBOS        | Boston area avg        |
| S23A     | Chicago-Naperville-Elgin      | YORD        | Chicago area avg       |
| S48B     | Denver-Aurora-Lakewood        | YDEN        | Denver area avg        |
| S37B     | Houston-The Woodlands-Sugar Land | Y44HO    | Houston area avg       |
| S35B     | Miami-Fort Lauderdale-West Palm Beach | YMIA | Miami area avg        |

**All 10 EIA city duoarea codes** (full list published by EIA for product EPM0):
`YBOS`, `Y35NY`, `YMIA`, `YORD`, `YCLE`, `Y44HO`, `YDEN`, `Y05LA`, `Y05SF`, `Y48SE`

Only 9 are reachable via Tier 1b (Cleveland, `YCLE`, is only reachable via Tier 1a county
override — there is no corresponding CPI metro code for Cleveland in the BLS CPI sample).

### Tier 2 — State-Level EIA Codes (9 states only)

EIA publishes state-level retail gas price series for exactly 9 states:

| State | Duoarea | Label                    |
|-------|---------|--------------------------|
| WA    | SWA     | Washington state avg     |
| CA    | SCA     | California state avg     |
| CO    | SCO     | Colorado state avg       |
| FL    | SFL     | Florida state avg        |
| MA    | SMA     | Massachusetts state avg  |
| MN    | SMN     | Minnesota state avg      |
| NY    | SNY     | New York state avg       |
| OH    | SOH     | Ohio state avg           |
| TX    | STX     | Texas state avg          |

All other states fall directly to Tier 3 (PAD district).

### Tier 3 — PAD District/Sub-District Fallback

**Petroleum Administration for Defense (PAD) Districts** — EIA's primary geographic unit
for petroleum supply analysis. PAD boundaries follow petroleum infrastructure
(pipelines, refineries, terminals), not Census region or state boundaries.

**PAD 1 is split into 3 sub-districts** with meaningfully different prices:

| PAD | Duoarea | Name                          | States                                  |
|-----|---------|-------------------------------|-----------------------------------------|
| 1A  | R1X     | New England (PADD 1A)         | CT, ME, MA, NH, RI, VT                 |
| 1B  | R1Y     | Central Atlantic (PADD 1B)    | NY, NJ, PA, DE, MD, DC                 |
| 1C  | R1Z     | Lower Atlantic (PADD 1C)      | VA, WV, NC, SC, GA, FL                 |
| 2   | R20     | Midwest (PADD 2)              | OH, MI, IN, IL, WI, MN, IA, MO, ND, SD, NE, KS, KY, TN, OK |
| 3   | R30     | Gulf Coast (PADD 3)           | TX, LA, MS, AL, AR, NM                 |
| 4   | R40     | Rocky Mountain (PADD 4)       | MT, ID, WY, CO, UT                     |
| 5   | R50     | West Coast (PADD 5)           | WA, OR, CA, NV, AZ, AK, HI            |

**National fallback:** `NUS` — used only if no state is matched (should not occur for
the 50 states + DC, but handles unexpected input).

**Why PAD ≠ Census region:** PAD districts track petroleum infrastructure corridors. This
causes apparent mismatches — TN and KY are in PAD 2 "Midwest" but Census "South." This
is correct by design. Gas labels always include the PADD identifier (e.g.,
"Midwest (PADD 2) avg") so users can verify the source.

---

## County → LAUS Unemployment

**API:** BLS Local Area Unemployment Statistics (LAUS)
**Base URL:** `https://api.bls.gov/publicAPI/v2/timeseries/data/`
**Function:** `buildSeriesId(countyFips)` in `src/lib/api/bls.ts`

**Series ID format:** `LAUCN{FIPS}0000000003`

Where `{FIPS}` is the 5-digit county FIPS code (2-digit state + 3-digit county), left-padded
with zeros. The trailing `3` selects unemployment rate (not labor force, employment, or
unemployed count).

**National unemployment series:** `LNS14000000` (fetched in the same batch call as the
county series to populate the "Show national" chart overlay).

### Connecticut Planning Region Remap

In January 2022, Connecticut abolished its 8 counties and replaced them with 9 Planning
Council Regions. BLS now publishes LAUS data under the new Planning Region FIPS codes.
The HUD USPS crosswalk still maps CT zip codes to the old county FIPS (09001–09015).

The `CT_COUNTY_TO_PLANNING_REGION` map in `bls.ts` translates old → new before building
the LAUS series ID:

| Old County FIPS | County Name  | New Planning Region FIPS | Planning Region Name            |
|-----------------|--------------|--------------------------|----------------------------------|
| 09001           | Fairfield    | 09120                    | Greater Bridgeport               |
| 09003           | Hartford     | 09110                    | Capitol                          |
| 09005           | Litchfield   | 09160                    | Northwest Hills                  |
| 09007           | Middlesex    | 09130                    | Lower CT River Valley            |
| 09009           | New Haven    | 09170                    | South Central CT                 |
| 09011           | New London   | 09180                    | Southeastern CT                  |
| 09013           | Tolland      | 09150                    | Northeastern CT                  |
| 09015           | Windham      | 09150                    | Northeastern CT                  |

**Known approximations in this mapping:**
1. Fairfield County is mapped entirely to Greater Bridgeport (09120) instead of split
   between Greater Bridgeport and Western CT (09190). Western CT covers Danbury and
   Torrington areas which have different labor market dynamics.
2. New Haven County is mapped entirely to South Central CT (09170) instead of split
   between South Central CT and Naugatuck Valley (09140). Naugatuck Valley covers
   Waterbury and Derby.

These approximations affect displayed unemployment rates for those CT areas. Flush and
re-warm using `scripts/flush-ct-unemployment.ts` and `scripts/warm-ct-unemployment.ts`
if CT unemployment data appears stale.

---

## Census ACS (Static Data)

**Source:** US Census Bureau American Community Survey (ACS) 5-year estimates
**API:** https://api.census.gov/data/{year}/acs/acs5
**API key:** `process.env.CENSUS_API_KEY` (build-time only — not used at runtime)
**File:** `src/lib/data/census-acs.json` (bundled, served statically)
**Build script:** `scripts/build-census-acs.ts`

**Fields per zip code:**
- `medianHouseholdIncome`: B19013_001E (median household income, past 12 months)
- `medianGrossRent`: B25064_001E (median gross rent)

**Geo level:** ZIP Code Tabulation Areas (ZCTAs) — Census approximation of USPS zip codes.
Some ZCTAs do not match zip codes exactly; the bundled file includes all ZCTAs for which
Census publishes estimates.

**Update frequency:** ACS 5-year estimates are released annually (typically December).
The bundled file should be rebuilt annually with `scripts/build-census-acs.ts` after the
new estimates are released.

**Fallback values** (used when Census has no data for a zip):
- National median household income: `$74,580`
- National median gross rent: `$1,271`

These fallbacks are defined as constants in `src/lib/compute/dollar-translations.ts`.

---

## Tariff Estimate

**Source:** Yale Budget Lab tariff cost analysis
**Reference:** https://budgetlab.yale.edu/research
**Formula:** `median_income × 0.0205`
**Implementation:** `src/lib/tariff.ts`, constant `TARIFF_COST_RATE = 0.0205`

**What 2.05% represents:** Yale Budget Lab estimates current US tariff levels (as of
the 2025 tariff schedule) cost an average American household approximately 2.05% of
their annual income in higher prices on imported goods, domestic goods competing with
imports, and downstream production costs.

**Assumption about rate stability:** The 2.05% rate is treated as static. If Yale Budget
Lab publishes a revised estimate, update `TARIFF_COST_RATE` in `src/lib/tariff.ts`. This
is the only place the rate is defined.

**Geographic scaling:** The formula uses local median income, so the dollar amount scales
with local purchasing power. A household in Beverly Hills (90210) gets a higher absolute
dollar estimate than a household in rural Mississippi — both are 2.05% of their local
median income.

**Label requirement:** This number is always displayed as an estimate and labeled with
the Yale Budget Lab as the source. It is not a measured cost — it is a modeled projection
applied to local income data.

---

## Dollar Translation Formulas

**Implementation:** `src/lib/compute/dollar-translations.ts`

These formulas translate percent-change economic indicators into annual dollar impacts
for display on hero cards.

### Groceries

```
grocerySpend = $6,000 × (localIncome / $74,580)
groceryImpact = grocerySpend × |groceriesChangePct| / 100
```

The $6,000 base is an approximation of annual US household grocery spending. It is
scaled by local income relative to the national median ($74,580) so that higher-income
areas show higher absolute grocery impacts. The absolute value is used because the
impact is framed as "paying more" regardless of direction.

**Fallback:** If no local income data is available, `localIncome` defaults to $74,580
(national median), so `grocerySpend` = $6,000 exactly.

### Shelter

```
annualRent = medianRent × 12
shelterImpact = annualRent × |shelterChangePct| / 100
```

Uses local median gross rent from Census ACS. Annualized and scaled by the percent
change in the shelter CPI since January 2025.

**Fallback:** If no local rent data is available, `medianRent` defaults to $1,271
(national median), giving an annual base of $15,252.

### Gas

```
gasImpact = currentPrice - baselinePrice  (signed, per gallon)
```

Unlike groceries and shelter, the gas dollar impact is the raw price difference per
gallon — not annualized. The frontend displays this as a per-gallon change, not annual
cost. The value is signed (positive = more expensive, negative = cheaper).

### Tariff

```
tariffImpact = medianIncome × 0.0205  (annual)
```

Described in the Tariff Estimate section above.

### National Fallback Constants

| Constant              | Value   | Source              |
|-----------------------|---------|---------------------|
| NATIONAL_MEDIAN_INCOME | $74,580 | ACS 5-year estimate |
| NATIONAL_MEDIAN_RENT  | $1,271  | ACS 5-year estimate |
| ANNUAL_GROCERY_BASE   | $6,000  | Approximation       |

---

## Baseline Anchoring

**All percent-change calculations use January 20, 2025 as the baseline.**

This date (presidential inauguration) is the conceptual anchor for the app — users want
to know what changed since that date.

**BLS precision:** BLS LAUS and CPI data are monthly. The January 2025 baseline uses
the January 2025 monthly value (period `M01`, year `2025`). BLS has no daily granularity,
so the baseline is the full month of January 2025, not specifically the 20th.

**EIA precision:** EIA publishes weekly retail gas prices. The baseline is the last
weekly reading on or before January 20, 2025. This is selected by filtering the sorted
series for all entries where `date <= 2025-01-20` and taking the last one. EIA gets the
closest approximation to the actual inauguration date.

**Percent change formula (BLS CPI and LAUS):**

```
change = ((current - baseline) / baseline) × 100
```

Rounded to 1 decimal place. A `baseline` of 0 produces a change of 0 (not NaN/Infinity)
via a guard check before division.

**Gas change:** Reported as a signed dollar difference per gallon (`current - baseline`),
not a percent.

---

## Sanity Ranges

Values outside these ranges are treated as data errors and displayed as "Data unavailable":

| Metric              | Min   | Max   | Unit          |
|---------------------|-------|-------|---------------|
| Unemployment rate   | 0%    | 25%   | %             |
| CPI percent change  | -20%  | +50%  | %             |
| Gas price           | $1.00 | $10.00 | $/gallon     |

These ranges are validated in the API response before data is returned to the client.
A county unemployment rate outside 0–25% almost certainly indicates a bad FIPS code or
an API response error.

---

## Known Limitations

### Hawaii and Alaska Gas Prices

HI and AK fall into PAD 5 "West Coast avg" (`R50`). EIA does not publish state-level
retail gas series for HI or AK. West Coast avg is structurally different from actual
prices in those states — gas in Hawaii regularly runs $1+ per gallon above the mainland
West Coast, and Alaska prices vary widely by region. No fix is available without EIA
publishing HI and AK state series.

### ~83% of Zips Get Division-Tier CPI

Only 16.5% of zip codes are in the 23 CBSA metros that BLS samples for metro CPI.
The remaining ~83% get Census Division CPI — a broader geographic average that may not
reflect hyperlocal price conditions. This is correct per BLS methodology (BLS does not
publish sub-metro or county CPI), but users in those areas see a less granular figure.

### Connecticut FIPS Remapping Approximations

As noted above, Fairfield County → Greater Bridgeport (not split with Western CT), and
New Haven County → South Central CT (not split with Naugatuck Valley). These are
one-to-one approximations of what should be partial mappings. Affected zip codes show
unemployment rates for the wrong Planning Region.

### USASpending No Independent Cross-Check

The Python audit in `audit/src/main.py` independently verifies BLS, EIA, and Census
data against government API sources. It does not independently query `api.usaspending.gov`
to cross-check federal cuts dollar amounts. Federal cuts data has no third-party
verification in the current audit system.

### PAD ≠ Census Region Boundaries

EIA PAD districts and BLS CPI Census divisions/regions use different geographic
boundaries. TN, KY, and OK are in PAD 2 "Midwest" for gas prices but in the East South
Central or West South Central Census division for CPI. This is not a bug — the two
systems measure different things (petroleum infrastructure vs. cost-of-living surveys) —
but it can look inconsistent on the UI. Gas labels include the PADD number to allow users
to verify the source.

### Frontend Dollar Translations

Dollar impact amounts displayed on hero cards (`$X more per year`) are computed in the
API via `src/lib/compute/dollar-translations.ts` and returned pre-computed in the
`dollarImpact` field of the snapshot. No end-to-end test currently verifies that the
displayed dollar value matches the correct formula applied to the API data.

---

## How to Update Each Component

### HUD USPS Crosswalk

1. Download new crosswalk from https://www.huduser.gov/portal/datasets/usps_crosswalk.html
2. Run `npx tsx scripts/process-crosswalk.ts` to rebuild `src/lib/data/zip-county.json`
3. Run `npx tsx scripts/audit-zip-mappings.ts` to verify no zips lost their mapping
4. Run `npm test` to confirm 250-city mapping audit passes

### CBSA CPI Crosswalk (OMB Revision)

1. Download new OMB CBSA delineation file from
   https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html
2. If BLS added/changed metro CPI areas, update `CBSA_TO_CPI` in
   `scripts/build-cbsa-cpi-crosswalk.ts`
3. Run `npx tsx scripts/build-cbsa-cpi-crosswalk.ts` to rebuild
   `src/lib/data/cbsa-cpi-crosswalk.json`
4. Run `npx tsx scripts/flush-cpi-cache.ts` then `npx tsx scripts/preload-cache.ts`
5. Run `npm test` and `npx tsx scripts/audit-zip-mappings.ts`

### BLS CPI Areas (New Metro Added)

1. Add the new code and name to `BLS_CPI_AREAS` in
   `src/lib/mappings/county-metro-cpi.ts`
2. Add the CBSA → CPI code mapping to `CBSA_TO_CPI` in
   `scripts/build-cbsa-cpi-crosswalk.ts`
3. Rebuild the crosswalk (step 3 above)
4. If the metro has an EIA city gas series, add it to `CPI_TO_EIA_CITY` in
   `src/lib/mappings/eia-gas.ts`

### EIA Gas Region for a County

1. Add the county FIPS → duoarea entry to `COUNTY_EIA_CITY_OVERRIDES` in
   `src/lib/mappings/eia-gas.ts`
2. Run `npx tsx scripts/audit-zip-mappings.ts` to verify the override is applied
3. Run `npm test`

### Census ACS Data

1. Wait for Census to publish new ACS 5-year estimates (typically December)
2. Update the year in `scripts/build-census-acs.ts` and set `CENSUS_API_KEY` in `.env`
3. Run `npx tsx scripts/build-census-acs.ts` to rebuild `src/lib/data/census-acs.json`
4. Commit the updated JSON file (no cache flush needed — served statically)

### Yale Budget Lab Tariff Rate

1. Check https://budgetlab.yale.edu/research for a revised estimate
2. Update `TARIFF_COST_RATE` in `src/lib/tariff.ts`
3. The dollar-translations unit tests in `tests/unit/dollar-translations.test.ts` will
   need updated expected values if the rate changes
4. Run `npm test` to confirm

---

## Diagnostic Tools

```bash
# Offline audit: flags unmapped counties, gas tier downgrades, CPI tier breakdown
npx tsx scripts/audit-zip-mappings.ts

# Live API verification: confirms every EIA duoarea and BLS CPI series returns data
# WARNING: uses BLS API quota — don't run same day as a cache flush
npx tsx scripts/verify-mappings-live.ts

# CPI tier distribution report (CBSA metro vs division vs national)
npx tsx scripts/audit-cpi-assignments.ts

# 250-city mapping unit test (top 5 cities per state)
npm test -- tests/unit/city-mapping-audit.test.ts

# Python audit: independent verification against BLS/EIA/Census APIs (10 zips)
cd audit && PYTHONPATH=. python src/main.py --zips 98683 --sequential
```
