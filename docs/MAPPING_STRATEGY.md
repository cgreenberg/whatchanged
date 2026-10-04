# Mapping Strategy — whatchanged.us

## Overview

This document describes every geographic and economic mapping decision in the whatchanged.us
data pipeline. The full chain is:

```
User zip code
  → county FIPS (zip-county.json: housing-unit weighted Census 2020 + GeoNames PO-box zips)
  → CPI area code (CBSA crosswalk → Census Division → Regional → National)
  → EIA gas duoarea (county override → CPI-chained city → state → PAD district/sub-district)
  → LAUS unemployment area (county FIPS; Connecticut → 2022 planning region)
  → state → EIA residential electricity price (50 states + DC; none for territories)
  → Census ACS zip-level rent (static JSON; base of the CPI shelter card's dollar figure)
```

Each step has fallback tiers. Bugs in this chain are the most common source of wrong displayed
data. Verify any change with `npm run audit:mappings` and `npm test` (including
`tests/unit/golden-zips.test.ts`).

**One source of truth for both data paths.** The live API calls the TypeScript lookups directly.
The static local-data build (`scripts/build-local-data.py`) reads `src/lib/data/county-geo.json`,
which `scripts/build-county-geo.ts` (`npm run build:county-geo`) generates by calling those same
lookups for every county in `zip-county.json`. Rebuild it after any mapping change; never
re-implement a mapping in Python.

---

## Zip → County FIPS

**File:** `src/lib/data/zip-county.json` (plus `src/lib/data/ct-planning-regions.json`)
**Built by:** `scripts/build-zip-county.ts` (`npm run build:zip-county`)

Each zip is assigned to the county holding the **most housing units** of that zip in the 2020
Census. That is the closest public analogue of HUD's USPS ZIP→County residential ratio. HUD's own
crosswalk now requires a HUD USER login/API token, so it is not used.

Sources (all public, no key):
1. Census 2020 ZCTA ↔ tabulation block relationship file
2. 2020 PL 94-171 redistricting geoheaders (block housing units, population, county subdivision)
3. Census 2020 ZCTA ↔ county relationship file (county names, land-area tiebreak)
4. Census CT county-subdivision relationship file (town → 2022 planning region)
5. GeoNames US postal codes (CC BY 4.0): adds USPS zips that are not ZCTAs (PO boxes, unique zips
   such as 20500) with their county, flagged `zcta: false`, and is a fallback for city names

Island areas without block data are assigned by land area. The build caches downloads in
`$GEO_CACHE_DIR` and needs `NODE_OPTIONS=--max-old-space-size=6144`.

**Multi-county zips:** the county with the most housing units wins, which suits population-weighted
data such as income and unemployment.

**Territories:** PR, VI, GU, MP and AS zips are included. They have no BLS county unemployment
and no EIA gas series. They get national CPI (Tier 4) and the national gas average, both labeled
national.

---

## County → BLS CPI Area (4-Tier Fallback)

**Function:** `getMetroCpiAreaForCounty(countyFips, stateAbbr)` in
`src/lib/mappings/county-metro-cpi.ts`
**Returns:** `{ areaCode, areaName, tier }` where tier = 1 | 2 | 3 | 4

**Series IDs** (`src/lib/api/bls-cpi.ts`):
- Groceries (food at home): `CUUR{areaCode}SAF11`
- Shelter: `CUUR{areaCode}SAH1`
- Rent of primary residence (shelter card's dollar figure only): `CUUR{areaCode}SEHA`

All three are fetched in one batched BLS POST and cached together under `bls:cpi:{areaCode}:all`.
(CPI energy `SA0E` is no longer fetched: the Energy graph became the Electricity graph.)

At the last build, about 20% of zips were Tier 1, 80% Tier 2 and 0.5% Tier 4 (approximate).

### Tier 1 — CBSA Metro CPI (23 metros)

`src/lib/data/cbsa-cpi-crosswalk.json` (built by `scripts/build-cbsa-cpi-crosswalk.ts`) maps the
counties of each BLS-sampled metro to its CPI area. It uses the **OMB February 2013** delineation,
because the BLS 2018 CPI geographic revision defines its self-representing metros with it. Later
delineations add or drop counties that BLS does not sample. For example, the 2013 file keeps
Kenosha WI in Chicago and Pike PA, Orange NY and Dutchess NY in New York.

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

**Important:** each BLS CPI area corresponds to exactly one CBSA. Only counties in that CBSA are
Tier 1, not nearby counties in a different CBSA. Do not add counties unless BLS samples that
county's CBSA for the area. Connecticut's legacy counties (used by the 2013 delineation and by
`zip-county.json`) are in no CPI metro.

### Tier 2 — Census Division CPI (9 divisions)

Used when a county is not in a sampled CBSA. Covers all 50 states + DC.

| Code  | Name                  | States                                        |
|-------|-----------------------|-----------------------------------------------|
| 0110  | New England           | CT, ME, MA, NH, RI, VT                        |
| 0120  | Middle Atlantic       | NJ, NY, PA                                    |
| 0230  | East North Central    | IL, IN, MI, OH, WI                            |
| 0240  | West North Central    | IA, KS, MN, MO, NE, ND, SD                    |
| 0350  | South Atlantic        | DE, DC, FL, GA, MD, NC, SC, VA, WV            |
| 0360  | East South Central    | AL, KY, MS, TN                                |
| 0370  | West South Central    | AR, LA, OK, TX                                |
| 0480  | Mountain              | AZ, CO, ID, MT, NV, NM, UT, WY                |
| 0490  | Pacific               | AK, CA, HI, OR, WA                            |

### Tier 3 — Census Regional CPI (4 regions)

A defensive fallback. All 50 states + DC are covered by Tier 2, so Tier 3 is unreachable today.
Codes: `0100` Northeast, `0200` Midwest, `0300` South, `0400` West.

### Tier 4 — National CPI (code 0000)

Used for territories. Series `CUUR0000SAF11`, `CUUR0000SAH1`, `CUUR0000SA0E`. National CPI is one
shared cache key (`bls:cpi:0000:all`), never fetched per zip. The snapshot also falls back to it,
labeled national, when a local CPI area fails.

**Labels:** `cpiGeoLabel()` in `src/lib/provenance.ts` renders `metro: …`, `division: …`,
`region: …` or `national`. For cache entries without a `tier`, it infers the tier from the area
code (`0000` national, `0x00` region, `0xx0` division, `Sxxx` metro).

---

## County → EIA Gas Series (4-Tier Fallback)

**Function:** `getGasLookup(stateAbbr, cpiAreaCode?, countyFips?)` in `src/lib/api/eia.ts`
**Mapping tables:** `src/lib/mappings/eia-gas.ts`
**EIA API:** `https://api.eia.gov/v2/petroleum/pri/gnd/data/`, product `EPMR` (regular gasoline; was `EPM0` all grades until Oct 2026), weekly
**Returns:** `{ duoarea, geoLevel, tier, cacheKey }`

Tier, cache key and label are derived from the duoarea code itself (`describeDuoarea`), so the same
series always gets the same key and label: `Y*` city → tier 1, `eia:gas:epmr:city:{duoarea}`;
`S{ST}` state → tier 2, `eia:gas:epmr:state:{ST}`; `R*` PADD → tier 3, `eia:gas:epmr:pad:{1A,1B,1C,2,3,4,5XCA}`;
`NUS` → `eia:gas:epmr:national`.

At the last build, about 10% of zips got a city series, 25% a state series and 65% a PADD
(approximate).

### Tier 1a — County override

`COUNTY_EIA_CITY_OVERRIDES` is only needed where the default chain gives the wrong series. Today it
holds just the Cleveland-Elyria counties (39035, 39055, 39085, 39093, 39103 → `YCLE`). Cleveland has
an EIA city series but no BLS CPI metro. Because the CPI crosswalk now uses the exact BLS metro
CBSAs, the CPI→city chain only fires inside those metros. The earlier ~770 distance-based overrides
were equivalent to the default chain and were removed. `scripts/audit-gas-assignments.ts` reports
counties more than 100 miles from their chained EIA city (`--apply` regenerates overrides).

### Tier 1b — CPI metro → EIA city

| CPI Code | Metro                                 | EIA Duoarea | Label                  |
|----------|---------------------------------------|-------------|------------------------|
| S49D     | Seattle-Tacoma-Bellevue               | Y48SE       | Seattle area avg       |
| S49A     | Los Angeles-Long Beach-Anaheim        | Y05LA       | Los Angeles area avg   |
| S49B     | San Francisco-Oakland-Hayward         | Y05SF       | San Francisco area avg |
| S12A     | New York-Newark-Jersey City           | Y35NY       | New York City area avg |
| S11A     | Boston-Cambridge-Newton               | YBOS        | Boston area avg        |
| S23A     | Chicago-Naperville-Elgin              | YORD        | Chicago area avg       |
| S48B     | Denver-Aurora-Lakewood                | YDEN        | Denver area avg        |
| S37B     | Houston-The Woodlands-Sugar Land      | Y44HO       | Houston area avg       |
| S35B     | Miami-Fort Lauderdale-West Palm Beach | YMIA        | Miami area avg         |

Division and regional CPI codes never appear here, so non-metro counties fall through to state or
PADD prices.

### Tier 2 — State series (9 states only)

`SWA`, `SCA`, `SCO`, `SFL`, `SMA`, `SMN`, `SNY`, `SOH`, `STX`. Every other state goes to Tier 3.

### Tier 3 — PAD district / sub-district

| PAD | Duoarea | Label                                        | States reaching this tier            |
|-----|---------|----------------------------------------------|--------------------------------------|
| 1A  | R1X     | New England (PADD 1A) avg                    | CT, ME, NH, RI, VT (MA has state)    |
| 1B  | R1Y     | Central Atlantic (PADD 1B) avg               | NJ, PA, DE, MD, DC (NY has state)    |
| 1C  | R1Z     | Lower Atlantic (PADD 1C) avg                 | VA, WV, NC, SC, GA (FL has state)    |
| 2   | R20     | Midwest (PADD 2) avg                         | MI, IN, IL, WI, IA, MO, ND, SD, NE, KS, KY, TN, OK |
| 3   | R30     | Gulf Coast (PADD 3) avg                      | LA, MS, AL, AR, NM                   |
| 4   | R40     | Rocky Mountain (PADD 4) avg                  | MT, ID, WY, UT                       |
| 5   | R5XCA   | West Coast excl. California (PADD 5) avg     | OR, NV, AZ, AK, HI                   |

PADD 5 uses `R5XCA` ("PADD 5 except California") rather than `R50`. CA and WA always resolve to
their state series first, so every state reaching this tier is outside California, and the
CA-dominated `R50` average would overstate their prices.

**National fallback:** `NUS`, used only when no state matches (territories, unexpected input), and
by the snapshot as a labeled fallback when the local series fails. The national series is never
written under a local cache key.

**PAD ≠ Census region:** PAD districts follow petroleum infrastructure. TN, KY and OK are PADD 2
"Midwest" for gas but South for CPI. This is correct by design, and gas labels always name the PADD.

---

## LAUS Unemployment Area

**Mapping:** `src/lib/mappings/laus-area.ts` (data: `src/lib/data/ct-planning-regions.json`)
**Series ID:** `LAUCN{fips}0000000003` (`buildSeriesId` in `src/lib/api/bls.ts`). The trailing `3`
selects the unemployment rate.
**National overlay:** `LNU04000000` (not seasonally adjusted, matching the NSA county series),
fetched in the same batch as the county series.
**Cache key:** `bls:unemployment:{lausFips}`

For every state except Connecticut, the LAUS area is the county FIPS.

### Connecticut planning regions

Connecticut replaced its 8 counties with 9 planning regions (FIPS 09110–09190) in 2022, and BLS
LAUS publishes only the regions. `zip-county.json` keeps the legacy counties because the OMB 2013
delineation that BLS CPI uses is defined on them. So LAUS has its own translation:

- **Per zip** (`getLausAreaFipsForZip`): the planning region holding most of the zip's housing units
  (2020 blocks → CT town → 2022 region). This is exact at the zip level.
- **Per legacy county** (`getLausAreaForCounty`): the region holding most of the county's housing
  units, flagged `approx: true`, because 5 of the 8 legacy counties are split across regions.

| Legacy county | Dominant planning region |
|---|---|
| 09001 Fairfield  | 09190 Western CT |
| 09003 Hartford   | 09110 Capitol |
| 09005 Litchfield | 09160 Northwest Hills |
| 09007 Middlesex  | 09130 Lower CT River Valley |
| 09009 New Haven  | 09170 South Central CT |
| 09011 New London | 09180 Southeastern CT |
| 09013 Tolland    | 09110 Capitol |
| 09015 Windham    | 09150 Northeastern CT |

The static local-data build uses the same county mapping (via `county-geo.json`) and shows an
approximation note for legacy CT counties. To refresh CT data:
`npm run cache:flush -- 'bls:unemployment:09*' --yes`, then `npm run cache:warm -- <CT zips>`.

### Unemployment headline vs chart

The live chart shows the monthly NSA county series and the NSA national series. The headline change
comes from the static pipeline (`public/data/counties.json` `ur/urBase/urCur`): 3-month averages
seasonally adjusted by whatchanged, with the latest preliminary month excluded. See
`docs/LOCAL_DATA_SOURCES.md`.

---

## Census ACS (Static Data)

**Source:** Census ACS 5-year estimates. **File:** `src/lib/data/census-acs.json` (ZCTA), read by
`src/lib/data/census-acs.ts`. **Build script:** `npm run build:census-acs` (`CENSUS_API_KEY`; build
time only, never at runtime).

Only median gross rent (B25064_001E) is used: the base of the CPI shelter card's dollar estimate.
(The file still carries median household income, which nothing reads since the tariff estimate was
removed; city and county income files were deleted.)

Lookup order for rent:
1. Zip-level (ZCTA) rent
2. For PO-box/unique zips (`zcta: false`) that have no ACS row: a donor zip's rent (largest residential
   zip in the same city, else the most populous in the county; `po-box-acs.json`), labeled
3. Otherwise no local figure (`isRentFallback`): the shelter dollar figure is null; no national rent is
   substituted

---

## Electricity (EIA, statewide)

**Source:** EIA API v2 `electricity/retail-sales`, sector `RES`, monthly price (¢/kWh), sales and
customers, by state (50 + DC) and `US`. **Implementation:** `src/lib/api/eia-electricity.ts`.
**Mapping:** the zip's state (`location.stateAbbr`); territories have no series ("Data unavailable").
**Cache:** `eia:electricity:{ST}`, `eia:electricity:US` (shared national comparison).

The % change compares seasonally adjusted prices (classical decomposition; factors fit on 2014–2024,
so the Jan 2025 baseline never revises). Dollars: (adjusted price now − adjusted Jan 2025) × the
state's average residential kWh per customer per month over the latest 12 complete months.

---

## Dollar Translation Formulas

**Implementation:** `src/lib/compute/dollar-translations.ts` (computed in `snapshot.ts` and returned
as `dollarImpact`) and `src/lib/rent.ts`. All values keep their sign: a drop is negative.

| Card | Formula |
|---|---|
| Groceries | `round(6000 × groceriesChangePct / 100)` $/yr |
| Rent (Zillow ZORI, new leases) | `round(curRent − curRent / (1 + pct/100))` $/mo, `pct` SA by whatchanged, `curRent` observed |
| Shelter fallback (CPI) | `round(localAcsRent × 12 × rentIndexChangePct / 100)` $/yr (BLS rent of primary residence %), or null without local rent |
| Gas | `current − baseline` $/gal (not annualized) |
| Electricity | `round((avg12Current − avg12Baseline) ¢/kWh × stateKwhPerMonth / 100)` $/mo (12-month average prices: latest 12 months vs the 12 ending Jan 2025) |

The rent card is shown when the county has a row in `src/lib/data/county-rent.json`; otherwise the
CPI shelter card is shown, labeled "Shelter prices (CPI, all tenants & homeowners)".

---

## Baseline Anchoring

`src/lib/baseline.ts` (client) and `src/lib/api/bls-common.ts` / `src/lib/api/eia.ts` (server).

- **BLS CPI:** the January 2025 monthly value. If it is missing, the latest month back to November
  2024 is used; otherwise the baseline is null.
- **BLS LAUS:** January 2025 only; otherwise null.
- **EIA gas:** the last weekly reading on or before 2025-01-20 and no earlier than 2025-01-06. The
  national overlay uses the same rule.
- BLS `"-"` values (e.g. the October 2025 shutdown gap) and M13 annual averages are dropped. A
  missing baseline is null, never 0.

**% change:** `(current − baseline) / baseline × 100`, null when not computable.

---

## Sanity Ranges

Defined in `src/lib/api/validate.ts` and mirrored in `src/lib/hero-cards.ts`. Out-of-range values are
never cached as a success and are shown as "Data unavailable".

| Metric              | Min   | Max    |
|---------------------|-------|--------|
| Unemployment rate   | 0%    | 25%    |
| Price % change      | −20%  | +50%   |
| Gas price           | $1.00 | $10.00 |

---

## Known Limitations

- **Hawaii and Alaska gas:** EIA publishes no HI or AK series. They get `R5XCA` (West Coast excl.
  California), an approximation; actual prices there often differ by $1+/gal.
- **Division-tier CPI:** most zips get Census division CPI, a broad average. BLS publishes no county
  or sub-metro CPI.
- **Connecticut:** legacy-county LAUS values are the dominant planning region (approx); zip lookups
  are exact.
- **PO-box zips:** these have no ACS figures of their own and use the nearest residential zip's values.
- **Zillow rent coverage:** county rent exists for only about 41% of residential zips; the rest get
  the CPI shelter card.
- **HUD crosswalk:** a real HUD USPS crosswalk would need a HUD USER API token.

---

## How to Update Each Component

### Zip → county
1. `NODE_OPTIONS=--max-old-space-size=6144 npm run build:zip-county`
2. `npm run build:county-geo`
3. `npm run audit:mappings` and `npm test` (golden zips, exhaustive mappings)
4. Re-run the local-data build so `public/data` picks up the new mapping

### CBSA CPI crosswalk
1. If BLS added or changed metro CPI areas, update `CBSA_TO_CPI` in
   `scripts/build-cbsa-cpi-crosswalk.ts` (and `BLS_CPI_AREAS` in `county-metro-cpi.ts`)
2. `npm run build:cbsa-crosswalk`, then `npm run build:county-geo`
3. `npm run audit:mappings` and `npm test`
4. Run the refresh-cache workflow (or `npm run cache:refresh -- --only=cpi`) — it overwrites the CPI keys in place; no flush needed
5. If the new metro has an EIA city series, add it to `CPI_TO_EIA_CITY` in `eia-gas.ts`

### EIA gas series for a county
1. Add the county FIPS to `COUNTY_EIA_CITY_OVERRIDES` in `src/lib/mappings/eia-gas.ts` (only where
   the default chain is wrong)
2. `npm run build:county-geo`, `npm run audit:mappings`, `npm test`

### Census ACS data
1. Wait for new ACS 5-year estimates (usually December) and update the year in the build scripts
2. `npm run build:census-acs`
3. Commit the JSON. No cache flush is needed, because it is served statically

---

## Diagnostic Tools

```bash
npm run audit:mappings                      # offline audit of every zip (no API calls)
npx tsx scripts/audit-gas-assignments.ts    # distance check for gas assignments
npm run verify:live                         # deployed site vs BLS/EIA for 10 fixed zips (weekly in CI)
npm run verify:live -- --codes              # also every mapped EIA/CPI code (uses BLS quota)
npm test -- tests/unit/golden-zips.test.ts  # hand-checked tricky zips
npm run cache:flush -- 'bls:cpi:*'          # dry run; add --yes to delete
npm run cache:warm -- 98683 10001
```
