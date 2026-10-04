# CLAUDE.md — whatchanged.us

Read fully before touching code. Also read `.claude/rules/orchestration.md` (delegation, models) and
`.claude/rules/code-review.md` (three review agents + pre-deploy check) at session start.

## Purpose

Enter a zip code and see how local **prices** (gas, rent, home prices, groceries, electricity) changed since
**Jan 20, 2025**, with every number sourced and dated, plus a shareable image. The site is prices-only (no jobs or
unemployment data on the page). Live: https://www.whatchanged.us · repo: github.com/cgreenberg/whatchanged.
**No partisan framing:** show the data, its source, geography and window, and let the numbers speak. Never imply more
than the data supports: approximations are labeled, estimates are called estimates.

Stack: Next.js 16 App Router + React 19, TypeScript, Tailwind 4, Framer Motion, Recharts (charts), d3-geo +
topojson-client (county map), `next/og`/Satori (share + OG images), Upstash Redis, Vercel. Jest + MSW, Playwright.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `lint` | Dev server, production build, ESLint |
| `npm test` | Jest (unit + integration, MSW mocks, no network) |
| `npx playwright test` (`npm run test:e2e`) | E2E; `/api/data` is mocked from `tests/fixtures/snapshots/`. `PW_PORT=3107` uses another port (parallel worktrees) |
| `npm run verify:live [-- --codes] [zips]` | Deployed site vs BLS/EIA for 12 fixed zips (incl. BLS gas tiers 19103, 53202, 96813, 99501); `--codes` also checks every mapped EIA/CPI/BLS-gas code (~100 calls, uses BLS quota) |
| `npm run audit:mappings` | Offline audit of every zip's county/CPI/gas mapping (no API calls; also checks the CT planning-region lookup) |
| `npm run build:zip-county` | Rebuild `zip-county.json` + `ct-planning-regions.json` (`NODE_OPTIONS=--max-old-space-size=6144`; caches downloads in `$GEO_CACHE_DIR`) |
| `npm run build:cbsa-crosswalk` | Rebuild `cbsa-cpi-crosswalk.json` (OMB 2013 delineation) |
| `npm run build:county-geo` | Rebuild `county-geo.json` from the TS lookup functions; run after either build above |
| `npm run build:census-acs` | Rebuild `census-acs.json` (zip median rent; `CENSUS_API_KEY`) |
| `npm run data:local` | Fetch → build → validate the static local-data pipeline (`RAW=/path` for the download dir) |
| `npm run cache:refresh [-- --dry-run] [--only=cpi\|gas\|electricity] [--zips=a,b] [--force]` | Fetch every CPI/gas/electricity series and write it to Upstash (what the refresh-cache Action runs; `cache:preload` is an alias). `--dry-run` writes in-memory only. A full run within 12 h of the last successful one is skipped unless `--force`; bad `--only`/`--zips` exit non-zero |
| `npm run cache:flush -- '<glob>' [--yes] [--include-lastgood]` | List (dry run) or delete matching Redis keys; `:lastgood` copies kept unless flagged |
| `npm run cache:warm -- <zip...>` | Hit `/api/data/{zip}` sequentially (`BASE_URL` https, or http://localhost) |
| `npx tsx scripts/audit-gas-assignments.ts [--apply]` | Distance check of county → EIA gas series |

## Two data paths

**1. Live API snapshot** (hero cards, charts, share/OG images)

```
/api/data/[zip] → src/lib/api/snapshot.ts fetchSnapshot(zip)   (?city=/&state= are ignored: numbers come from the zip)
  zip → lookupZip (zip-county.json) → county FIPS
  ├─ BLS CPI   bls-cpi.ts  ┐ through cached-sources.ts → kv.ts getCachedOrFetch (validate, last-good, dedupe)
  │                        │ local CPI failed → shared national CPI key (labeled national)
  ├─ gas  eia.ts (EIA weekly) / bls-gas.ts (BLS monthly) ┘ + shared national gas key of the SAME source
  │                        (EIA → NUS, BLS → APU000074714; overlay, or labeled fallback)
  ├─ electricity  eia-electricity.ts: the zip's STATE (statewide EIA residential price) + shared eia:electricity:US
  │                        (territories: none → "Data unavailable", no fetch)
  ├─ Census ACS  src/lib/data/census-acs.ts (bundled JSON, no runtime API): zip median rent only
  ├─ Rent      src/lib/rent.ts ← src/lib/data/county-rent.json (built by path 2)
  └─ dollarImpact  src/lib/compute/dollar-translations.ts
→ src/lib/hero-cards.ts builds card view-models (page, share card and OG image all use it)
```

`?audit=true` adds `_audit` (series IDs, baseline/latest observations, formulas); `verify:live` uses it.
`src/lib/api/national.ts` (OG image) reuses the same cached accessors and keys.

**Map layers (Gas / Groceries / Electricity):** `/api/map-metrics` (`src/lib/api/map-metrics.ts`) READS THE CACHE
ONLY (each key, else its `:lastgood` copy; never BLS/EIA, never the runtime budget) and returns one value per gas
series / CPI area / state plus `counties: {fips: [gasIdx, cpiIdx]}` from `county-geo.json` (state = FIPS prefix).
Same numbers as the cards (gas $ change, CPI food-at-home %, electricity adjusted %). CDN `s-maxage=3600` when
every area is cached, `300` when any is missing. A key not in the cache is "no data" on the map until the next refresh.

**2. Static monthly pipeline** (Rent card data, Housing graph Zillow tabs, county map)

```
scripts/fetch-local-data.sh RAW → scripts/build-local-data.py → scripts/validate-local-data.py
  → public/data/{counties.json, counties-timeline.json, meta.json, us-housing.json, county/{stateFips}.json}
    (also zip/{zip3}.json and cities/{ST}.json, which the page no longer reads)
  → src/lib/data/county-rent.json
  → docs/validation/{report.md, results.json}
```

`.github/workflows/refresh-local-data.yml` runs on the 20th of each month and opens a PR to `main`. Any FAIL from the
validator fails the run. Sources, methods and sanity filters: `docs/LOCAL_DATA_SOURCES.md`. The client reads these files
through `src/lib/county-data.ts` (no keys, no Redis). The pipeline still computes LAUS, QCEW, permits, etc. into
`counties.json`; nothing in the UI shows them.

- `county/{stateFips}.json` rows carry `hvS` (monthly ZHVI levels since 2016, 1 decimal) and `rentS` (monthly ZORI
  levels seasonally adjusted by whatchanged, 2 decimals) as `{start: 'YYYY-MM', v: [...]}`. `counties.json` (map) omits
  them. The validator FAILs unless every `rentS` reproduces `county-rent.json` `pct` (Rent tab % = Rent card %) and
  every `hvS` reproduces `hv`.
- `us-housing.json`: U.S. ZHVI and SA ZORI (Zillow metro files' United States row) for the Housing graph's
  "Show national".

## Resolution ladders (`src/lib/resolution/`) — which series each number comes from

- **One declarative config:** `ladders.ts` has one ladder per metric (`gas`, `rent` = the housing card, `groceries`,
  `shelter`, `electricity`, `homePrices`): an ordered list of rungs, most local first. Each rung: `id`, plain-English
  `label`, source/citation/license, `level`, `frequency`, `pipeline` (live | static), `covers`, `applies(loc)` (true or
  the reason), `target(loc)`, `resolve(target, ctx)` and `onUnavailable` (`next` | `next-source` | `last`). The walker
  (`resolve.ts`) uses the first rung with data and records every rung's outcome; `/api/data` returns it as `trace`
  (`TraceStep[]` per metric). `getGasLookup()` / `getMetroCpiAreaForCounty()` are the ladders' first applicable rung
  (thin wrappers) — never re-implement tier logic elsewhere.
- Fetching is injected (`LadderContext`): `server-context.ts` (cached BLS/EIA accessors + bundled static data,
  memoized per request) and, for the Housing graph's Home prices tab, the client county shard
  (`homePricesTrace` in `HousingChart.tsx`). `ladders.ts` imports mapping tables only, so it stays client-safe;
  mapping modules import it back, so nothing in it may touch an import at module load (use getters / functions).
- UI: "Where does this come from?" (`SourceTrace.tsx`) in each card's ⓘ panel and under each graph. About page "How
  we pick your numbers" (`HowWePick.tsx`) and `docs/DATA_RESOLUTION.md` (`npm run docs:ladders`; a test fails when
  stale) are generated from the config.
- **How to add a rung** (e.g. Zillow metro rent, Alaska DCRA community gas, Puerto Rico DACO gas): (1) data — live:
  a cached fetcher + context accessor in `server-context.ts`; static: compact JSON from `build-local-data.py` read by a
  small lookup module and exposed as a context accessor; (2) insert one `defineRung({...})` at the right position of the
  metric's `rungs` (Zillow metro between `rent.zillow-county` and `rent.bls-cpi-shelter`; DCRA before
  `gas.bls-hiak-standin`; DACO before `gas.eia-national`); (3) map any new value shape in `fetchSnapshot`;
  (4) `npm run docs:ladders`, add the zip to `tests/unit/resolution-trace.test.ts`, `npm test`. A new metric (home heating
  fuel) = a new ladder in `LADDERS` + `LADDER_ORDER`, a `TraceMetric`, snapshot wiring and a graph passing its `trace`.

## Geography (single source of truth)

- **zip → county:** `src/lib/data/zip-county.json`, built by `scripts/build-zip-county.ts`. Each zip is assigned to the
  county that holds most of its housing units (Census 2020 ZCTA↔block + PL 94-171). Non-ZCTA USPS zips (PO boxes,
  unique zips; `zcta: false`) come from GeoNames. This is not the HUD crosswalk, which now needs a HUD USER token.
- **county → everything else:** `src/lib/data/county-geo.json` (`scripts/build-county-geo.ts`) is generated by calling
  the real TS lookups. `build-local-data.py` reads it, so both paths agree. Never re-implement the mappings in Python
  or regex-parse TS.
- **CPI (4 tiers)** the `groceries` / `shelter` ladders (`getMetroCpiAreaForCounty()` = their first applicable rung): 1 metro (county in
  `cbsa-cpi-crosswalk.json`, the OMB **2013** CBSAs BLS samples) → 2 Census division → 3 region (defensive only) →
  4 national `0000` (territories). Series `CUUR{area}SAF11` / `SAH1`, plus `SEHA` (rent of primary residence,
used only for the shelter card's dollar figure; verified monthly with a Jan 2025 value for all 37 areas, recorded in
`tests/fixtures/bls-cpi-rent-seha.json`). CPI energy `SA0E` is no longer fetched. Only add CBSAs that BLS actually samples.
- **Electricity** = the zip's state (`hasElectricitySeries`: 50 states + DC). No county or metro series exists;
  territories (PR, GU, VI, AS, MP) have none and show "Data unavailable" with the reason.
- **Gas** the `gas` ladder (`getGasLookup()` in `src/lib/api/eia.ts` = its first applicable rung), tables in `src/lib/mappings/eia-gas.ts` (EIA) and
  `src/lib/mappings/bls-gas.ts` (BLS). Most local first:
  1. EIA weekly city: county override (Cleveland only) or CPI metro → EIA city (`CPI_TO_EIA_CITY`)
  2. **BLS monthly** CPI average price `APU{area}74714` for a CPI metro **without** an EIA city (Philadelphia, Detroit,
     Minneapolis, St. Louis, DC, Atlanta, Tampa, Baltimore, Dallas, Phoenix, Riverside, San Diego, Honolulu `S49F`,
     Anchorage `S49G`). BLS titles S49F/S49G "Urban Hawaii/Alaska", but they are the Urban Honolulu CBSA (15003) and
     the Anchorage CBSA (02020, 02170) only: label them "Honolulu metro" / "Anchorage metro".
  3. HI / AK zips outside those CBSAs → the same S49F / S49G series as a **labeled stand-in** (`standIn: true`):
     "Honolulu-area price (BLS)"; card + gas chart caveat "Honolulu-area price — no BLS or EIA series for {county};
     local prices are typically higher" (`HI_AK_STANDIN_GAS_NOTE`); share card / OG / og:description use
     "Honolulu-area price*" plus a footnote (`GAS_STANDIN_FOOTNOTE`). Anchorage analog for AK.
  4. one of EIA's 9 state series
  5. EIA PADD/sub-PADD (1A `R1X`, 1B `R1Y`, 1C `R1Z`, `R20`/`R30`/`R40`; PADD 5 → `R5XCA` "West Coast excl.
     California", because CA and WA always use their state series)  6. `NUS`.
  BLS Census-division gas series (e.g. East North Central `0230`) are deliberately **not** used: they are urban averages
  weighted to the division's big metros and read as more local than they are; Midwest zips keep EIA `R20`.
  BLS outage: the snapshot falls back to the zip's EIA weekly tier as a whole (`getGasLookup(…, { eiaOnly: true })`:
  state / PADD; `NUS` for HI/AK), local and national both EIA, `fallback: 'eia'`, captioned; the refresh plan warms
  those keys too.
  `GasLookupResult`/`GasPriceData` carry `source: 'eia' | 'bls'` and `frequency: 'weekly' | 'monthly'`; one series per
  location — baseline, current and national comparison always come from the same source (BLS → `APU000074714` over the
  same months; EIA → `NUS`). EIA tier/key/label come from the duoarea prefix (`describeDuoarea`); BLS from the area
  code (`describeBlsGasArea`: metro tier 1, HI/AK stand-in tier 2, region/national tier 3). EIA product is **`EPMR` (regular
  gasoline)**, `EIA_GAS_PRODUCT` in `eia.ts`; series `EMM_EPMR_PTE_{duoarea}_DPG`. (EPM0 "all grades" ran ~10–15¢
  above regular.) BLS average prices exist monthly (also for bimonthly CPI metros, ~2–6 week lag) with Jan 2025 values
  for every area in `BLS_GAS_PUBLISHED_AREAS`; since 2021 they come from crowdsourced station data and run ~10¢ above
  EIA. Zip coverage: EIA city 10.1%, BLS metro 9.8% (incl. Honolulu/Anchorage), BLS HI/AK stand-in 0.7%, EIA state
  21.5%, EIA PADD 57.4%, national 0.5%.
  Monthly BLS figures lag weekly EIA by weeks, so BLS tiers always name their month and source: card detail
  "through Aug 2026 (monthly)"; "National: $x (+$y) · U.S. city avg, BLS, Aug 2026" vs "· U.S. avg, EIA, week of
  Sep 28" (`gasNationalSourceTag`); share card "Philadelphia metro · thru Aug '26" and "Natl (BLS): …"; OG "since Jan
  2025, thru Aug '26"; the gas chart's dashed overlay is labeled by source (`nationalLabel`).
- **CT planning regions** `src/lib/mappings/laus-area.ts`: Connecticut zip / legacy county → 2022 planning region
  (09110–09190), data in `ct-planning-regions.json`. Used by the static pipeline (`county-geo.json` `lausFips`).
- **AK:** the Valdez-Cordova map shape takes Chugach values (approx). **Territories:** national CPI, national gas.
- Labels: `cpiGeoLabel()` in `src/lib/provenance.ts` (`metro: …` / `division: …` / `region: …` / `national`) infers
  the tier from the area code for old cache entries. Gas labels always name the PADD.
- Full rationale: `docs/MAPPING_STRATEGY.md`. Golden expectations: `tests/unit/golden-zips.test.ts`.

## Hero cards (`src/lib/hero-cards.ts`, always four; rendered by `StatCard.tsx`)

Cards are deliberately terse (owner rule): big number (+ inline dollar translation, always "≈"), at most ONE short
secondary line (window "since Jan 2025" and/or "U.S. +x"; gas also has its "+$0.87 since Jan 2025" line), and ONE
short source line `{short area} · {source} · {Mon YYYY}` (`sourceLine`: "Atlanta metro · BLS · Aug 2026", "Fulton
County · Zillow · Aug 2026", "Honolulu-area* · BLS …", "U.S. avg (local n/a) · EIA …"). Caveats on the face are
short tags only ("⚠ unusual", "*", "(local n/a)" / "(metro n/a)", Stale badge). Everything else — the full
provenance line(s), adjustments, "through … (monthly)", national source tags, HI/AK stand-in and outlier
explanations, fallback notes, the seasonal-adjustment note, dollar bases, the Zillow-vs-CPI note — goes in `info` /
`moreProvenance` and is shown in the card's ⓘ disclosure (button with `aria-expanded`/`aria-controls`, Escape
closes). Keep each card face ≤ 120 characters (`tests/unit/provenance.test.tsx`, `tests/e2e/labels.spec.ts`).

| Card | Number | Dollar line (formula source) |
|---|---|---|
| Gas | EIA weekly $/gal: latest vs last weekly reading in [Jan 6, Jan 20] 2025; BLS tiers: latest month vs Jan 2025 ("since Jan 2025", provenance "BLS CPI average price, regular gasoline · {area} · monthly · …") | signed `current − baseline` $/gal (`eia.ts` / `bls-gas.ts`) |
| Rent (new leases) | Zillow ZORI county % since Jan 2025, SA by whatchanged | `curRent − curRent/(1+pct/100)` $/mo on observed rent (`rentMonthlyChange`, `src/lib/rent.ts`) |
| ↳ fallback, county has no rent | "Shelter (CPI)", CPI SAH1 % | "≈ +$X/yr in rent" = `round(localAcsRent × 12 × rentIndexPct/100)` where `rentIndexPct` is the same area's CPI **rent of primary residence** (`SEHA`) % — never the shelter % (≈2/3 owners' equivalent rent); **null** without local ACS rent or without SEHA (e.g. older cached CPI) (`computeShelterImpact`) |
| Groceries | CPI food at home (SAF11) % | `round(6000 × pct/100)` $/yr, signed (`computeGroceryImpact`) |
| Electricity | EIA average residential price for the zip's **state**, ¢/kWh: big number = latest **published** monthly price (with its month); "+x% since Jan 2025" = **seasonally adjusted** price change (see below); card "U.S. +y%" = EIA U.S. average, same method, same months | `round((saCurrent − saBaseline) × usageKwh / 100)` $/mo, `usageKwh` = state residential sales ÷ customers averaged over the latest 12 complete months (`computeElectricityImpact`); null without usage |

**Electricity seasonality** (`src/lib/api/eia-electricity.ts`): residential prices are seasonal (Georgia's July price
runs ~17% above January in a typical year), so Jan 2025 → latest raw would mostly measure the season. The % uses
classical decomposition (centered 2×12 moving average, per-calendar-month median ratio over 2014-07…2024-12,
normalized to mean 1), the same method as Zillow rents; factors use pre-baseline data only, so the baseline never
revises. Rejected alternatives: 12-month averages (Feb 2024–Jan 2025 vs the latest 12 months) mix in pre-inauguration
months and lag ~6 months; same-month-last-year isn't "since Jan 2025". The ⓘ shows the published prices and the
unadjusted %. Sanity: price 5–60 ¢/kWh, change −50…+100 %, usage 100–3,000 kWh/mo. Point-to-point SA is noisier
where states reset rates administratively (e.g. CT's Jan/Jul standard-service changes).

Shelter dollars are **null** whenever the CPI used is national (outage fallback, or territories like PR whose only CPI
is national): national CPI % is never applied to local rent; the card says why.

Share card, OG image and `og:description` tag every number with a short geography (`geoTag`: "Buncombe Co.",
"South Atlantic region", "Lower Atlantic avg", "U.S. avg; local n/a"); flagged county rent (outliers, bundled as
`flagged`/`note` in `county-rent.json`) gets "†" plus an "unusual value" footnote. BLS gas tiers are tagged
"Philadelphia metro", "Washington DC metro", "Honolulu metro" (short names from `CPI_METRO_SHORT_NAMES`, never the CBSA
title cut at a hyphen) with "since Jan 2025" and "thru {Mon 'YY}"; HI/AK stand-ins get "Honolulu-area price*" and the
`GAS_STANDIN_FOOTNOTE`. The gas chart for BLS tiers is monthly; unpublished BLS months (e.g. Oct 2025) stay as empty
rows (`blsUnpublishedMonths`) so charts mark the gap.
Electricity on those surfaces: share card 4th quadrant = "ELECTRICITY (home ¢/kWh, seasonally adj.)", geography line
"{State} · {price}¢/kWh ({Mon 'YY})" (DC short), sparkline of the adjusted % since Jan 2025, big number = adjusted %,
pill "≈ +$Y/mo", basis "$/mo at N kWh/mo (avg {State} home)" (fit tests in `tests/unit/share-card-fit.test.ts` cover
every state). OG stat = adjusted % with "{State} (statewide)" / "since Jan 2025, seas. adj."; the national OG's bottom
band is the U.S. average price and %; `og:description` "Electricity +x% ({State})". Footers: "BLS · EIA · Zillow" or
"BLS · EIA · Census" (Census rent is used only by the CPI shelter card).

Dollar amounts are computed server-side in `snapshot.ts` → `dollarImpact`. The frontend never recomputes them or
substitutes national stand-ins. Sanity ranges (`src/lib/api/validate.ts`, mirrored in `hero-cards.ts`): price %
change −20 to +50, gas $1–$10. Anything outside shows "Data unavailable".

## Page layout (`src/components/HomeContent.tsx`)

1. Zip input + location banner. 2. The four hero cards. 3. Graphs (`ChartsSection.tsx`, configs in
`src/lib/charts/chart-config.ts`): Gas, Groceries, **Housing**, **Electricity** — each with Jan 2025 | 3Y | 5Y | 10Y,
era shading, "Show national" and an ⓘ disclosure (button with `aria-expanded`/`aria-controls`, Escape closes; panel
`chart-info`) holding the description and long notes, leaving at most one short line (`chart-note`) under the graph.
4. National county map (`src/components/map/NationalMap.tsx`).

**Electricity graph** (`electricity` config): ¢/kWh, bold line = seasonally adjusted (`sa`, the card's %), thin
line = published monthly price; headline "+x% since Jan 2025 · seasonally adjusted · {price} in {Mon YYYY}";
"Show national" adds only the U.S. adjusted line.

**Housing graph** (`src/components/charts/HousingChart.tsx`) has three tabs:
- **Rent**: Zillow ZORI county `rentS` (same county/series as the Rent card; its headline % equals the card's %).
- **Home prices**: Zillow ZHVI county `hvS` ("Zillow's smoothed, seasonally adjusted typical home value").
- **Shelter (CPI)**: BLS CPI shelter `SAH1` from the snapshot (all tenants and homeowners).

Graphs are a 2 × 2 grid from 768px (`md`): Gas | Groceries, Housing | Electricity (all configs `size: 'medium'`); one
column below.
Default = Rent when the county shard has `rentS`, else Shelter (CPI). Tabs without data are disabled with "No Zillow
… data for {county}". Zillow tabs compare against `us-housing.json`. `HOUSING_NOTE` (CPI vs Zillow) is in the graph's
ⓘ; the visible line is a short note per tab (`ZORI_SHORT_NOTE`, `ZHVI_SHORT_NOTE`, `SHELTER_SHORT_NOTE`).

**County map:** chips Gas | Rent | Home prices | Groceries | Electricity (`MAP_METRIC_ORDER`, default Home prices).
Rent and Home prices are county metrics (static pipeline): movers and time-lapse (`counties-timeline.json`). Gas ($
change, scale ±$0.50), Groceries and Electricity (%) come from `/api/map-metrics` (metro / region / state series):
a note says why blocks of counties share a color, and there are no movers or Play for them (`NO_MOVERS_NOTE`).
Tapping a county lists all five values, each with the area it covers (`map-value-{key}`). Controls
(metric chips, Play) sit above the map, never over it: an absolutely positioned Play button used to cover the
top-right counties (Maine/New England, much of the upper Midwest on phones) and swallowed those taps. Decorations
(state mesh, highlight ring, month label) are `pointer-events: none`. Every county record has a zip `z` (most
populous Zillow zip, else any crosswalk zip) for "See everything that changed here"; a few small VA independent
cities have no crosswalk zip and no button. `tests/e2e/map.spec.ts` clicks counties by screen point (real hit-testing).

**Baselines** (`src/lib/baseline.ts`, `src/lib/api/bls-common.ts`): CPI uses Jan 2025, else the latest month back to
Nov 2024, else null. Zillow series use Jan 2025. Gas uses the last weekly reading on or before Jan 20 2025, no earlier than
Jan 6. A missing baseline is null, never 0. BLS `"-"` values (e.g. the Oct 2025 shutdown gap) are dropped.

## Data-mixing rules

1. Every card and chart shows a provenance line `source · geography · window · as-of · adjustment`
   (`src/lib/provenance.ts`, `ProvenanceLine.tsx`), generated from API/`meta.json` fields. As-of is the date of the
   data, never today.
2. No hard-coded dates in UI strings except the baseline constants in `src/lib/baseline.ts`
   (`tests/unit/no-hardcoded-dates.test.ts` enforces this).
3. County figures lead (zip-vs-zip differences inside a county are not corroborated). No percentile ranks.
4. Approximations (Valdez-Cordova, national fallbacks) carry an `approx` flag or note in the UI.
5. Zillow rent (asking rent on new leases) and CPI shelter (all tenants + owners' equivalent rent, trails the market
   by ~1 yr) measure different things. Always label which one is shown; never pair one's % with the other's $ base.
6. When the hero cards' as-of months differ by more than one month, show the page-level range (`asOfRange`).
7. Signs are preserved everywhere: a price drop is a negative dollar amount.

## Data caveats (from `docs/validation/FINDINGS.md`)

- Zip-vs-zip differences inside a county are not corroborated (r≈0.06–0.11); county comparisons are.
- CPI shelter trails Zillow by about a year (r=0.50 over the same window, 0.80 lagged a year): Austin CPI is up while rents fell.
- Oct 2025 BLS data is missing (shutdown gap).
- HUD SAFMR is not a rent-change measure.

## Cache (`src/lib/cache/kv.ts`, accessors in `src/lib/api/cached-sources.ts`)

**Preload everything.** `.github/workflows/refresh-cache.yml` runs `npm run cache:refresh` (`scripts/refresh-cache.ts` →
`src/lib/api/refresh.ts`) weekly (Tue 15:00 UTC, after EIA's Monday release), on the 16th and 28th (after BLS CPI
releases) and on demand. It resolves every zip in `zip-county.json` exactly like the snapshot and fetches
every CPI area (33; 3 items each: `SAF11`, `SAH1`, `SEHA`; 15 areas per POST, the 2 national overlay series ride along
in each), every BLS gas series (17 `APU…74714`, packed into the spare room of the CPI POSTs by `planBlsRequests`, ≤ 50
series each), every EIA gas series (27) and EIA residential electricity for every state + DC + US in ONE paged query
(~7,900 rows → **2 EIA requests**), then writes them with the runtime's own parsers, validators, keys and
`writeEnvelope`. A full run is **3 BLS requests** (of 500/day; CPI energy `SA0E` is no longer fetched) and ~29 EIA
requests (`--only=gas` also needs `BLS_API_KEY`; `--only=electricity` needs only `EIA_API_KEY`); batches retry at most 2 times. County unemployment (LAUS) is no longer fetched at runtime. A successful full run writes `refresh:last-success` (ISO time);
a full run that starts < 12 h after it is skipped (two schedules can land on the same day) unless `--force`
(workflow_dispatch input `force`). Each full run also writes `refresh:last-attempt` at start; another unforced full
run within 2 h is skipped, so a failed run plus a coinciding cron can't spend the quota twice. Unknown CLI args
(`--only gas`, `--dryrun`, …) are rejected, never treated as a full run. Keys with no usable upstream data
(status missing/invalid) get a `{key}:missing` marker (21 days) that the runtime honors (no upstream fetch:
last-good copy or "Data unavailable"); the next successful write clears it. It exits
non-zero on any fetch/write error, any CPI/gas gap, or an empty plan. Secrets: `BLS_API_KEY`,
`EIA_API_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`. There are no Vercel crons and no `/api/warm-cache`.

| Key | Runtime TTL |
|---|---|
| `bls:cpi:{areaCode}:all` (`0000` = national, shared) | 21 days |
| `bls:gas:{areaCode}` (BLS monthly gas tiers; `bls:gas:0000` = BLS national, shared) | 21 days |
| `eia:gas:epmr:city:{duoarea}` · `eia:gas:epmr:state:{ST}` · `eia:gas:epmr:pad:{1A,1B,1C,2,3,4,5XCA}` · `eia:gas:epmr:national` | 10 days |
| `eia:electricity:{ST}` (50 states + DC) · `eia:electricity:US` (shared national comparison) | 10 days |
| `budget:{bls\|eia}:{YYYY-MM-DD}` (runtime upstream counter) | 2 days |

- TTLs are longer than the refresh interval, so keys never expire between runs; a user request is normally a hit.
- Values are envelopes `{__v: 2, fetchedAt, data}`; anything else is treated as a miss.
- Each success also writes `{key}:lastgood` (45 days). A failed fetch or validation writes `{key}:failed` for 5 min and
  serves the last-good copy with `stale: true`. With no last-good copy, the card shows "Data unavailable".
- **Runtime upstream budget:** a cache miss may still fetch, but only within a global daily budget (Redis `INCR`
  `budget:bls:{date}` cap 60, `budget:eia:{date}` cap 300; env `BLS_RUNTIME_DAILY_BUDGET` / `EIA_RUNTIME_DAILY_BUDGET`).
  Over budget → last-good copy, else "Data unavailable". The counter is created atomically with its TTL
  (`SET key 0 EX 172800 NX`, then `INCR`). If Redis is unreachable: **in production BLS fails closed** (no runtime BLS
  calls; LRU / last-good copy or "Data unavailable", logged once); EIA (and BLS in local dev) uses a per-instance
  breaker of 20 EIA / 5 BLS calls per hour. This keeps crawlers or a Redis outage from draining the quota the refresh needs.
  An empty, zero or malformed budget env value means the default (it never disables fetches).
- **Redis timeouts:** the Upstash client makes 1 quick retry (`backoff: 50ms`) and aborts each request after ~1 s
  (`REDIS_CALL_TIMEOUT_MS`, also enforced by a race in `redisCall`). **3 consecutive** failures
  (`REDIS_DOWN_AFTER_FAILURES`; any success resets the count) mark Redis down for 5 s (`REDIS_DOWN_COOLDOWN_MS`):
  Redis calls are skipped (no network), so an outage costs ~1 s per call only until the breaker trips. A single
  latency spike never marks Redis down. `scripts/refresh-cache.ts` uses a 10 s timeout and no cool-down.
- **In-process LRU** (`kv.ts`, Redis mode only, 500 entries, `LRU_MAX_ENTRIES`): envelopes this instance read from or
  wrote to Redis (key and `:lastgood`), each expiring at `fetchedAt + TTL`. Consulted only when a Redis call errors or
  Redis is marked down — then it is served instead of fetching upstream. Not a second cache tier on the happy path.
- **Fail closed in production:** on Vercel (`VERCEL`) or `NODE_ENV=production` with no `KV_*` env, runtime BLS fetches
  are refused (error logged once); EIA still uses the in-memory counter. Local dev/tests use the in-memory fallback.
- `validate` callbacks reject out-of-range data on read and before write. Concurrent requests for a key share one
  fetch (in-process dedupe). Census/ACS and rent are bundled JSON, not cached.
- CDN: `s-maxage=86400, stale-while-revalidate=86400` when CPI, gas and (where EIA publishes one) electricity are present and not stale;
  otherwise `s-maxage=300, stale-while-revalidate=300`. A national stand-in for a failed local series
  (`gas.data.fallback` / `cpi.data.fallback === 'national'`, `usesNationalFallback`) counts as degraded too
  (data route, share image, OG image).
- **BLS data-age staleness** (`isBlsPeriodStale`, `snapshot.ts`): CPI whose latest month ended more than
  75 days ago (`BLS_STALE_DAYS`) is marked `stale` and shown with the stale badge, even if the cache entry is fresh
  (the refresh rewrites `fetchedAt` even when BLS hasn't published a new month). Gas: >10 days (`isGasStale`).
  Electricity: latest month ended >100 days ago (`ELECTRICITY_STALE_DAYS`; EIA publishes ~2 months after the month).
- Live `/api/health` checks require `Authorization: Bearer $CRON_SECRET` (`no-store`). Public `/api/health` is cache-only, CDN-cached 60 s (`Vary: Authorization`).
- **Don't flush; re-run `cache:refresh`** (it overwrites in place). If you must flush, flush only the glob you changed
  (`cache:flush`, dry run first); `:lastgood` copies are kept unless `--include-lastgood`. Flushed keys refill from the
  runtime budget or the next refresh. The CDN may serve old responses for up to 24 h; `vercel deploy --prod --force`
  helps but doesn't reliably purge every edge.

## Testing strategy

- **Golden zips** (`golden-zips.test.ts`): hand-checked county/CPI/gas expectations taken from the sources, not the code.
- **Recorded fixtures:** `tests/fixtures/bls-recorded-*.json` and `bls-gas-ap-2024-2026.json` (real BLS responses,
  incl. the 17 `APU…74714` gas series) drive parser and baseline tests (`bls-gas.test.ts` for the BLS gas tiers).
  `eia-electricity-res.json` (real EIA retail-sales rows since 2014 for 11 states + US, trimmed, no key) drives
  `eia-electricity.test.ts`; MSW serves it (other states reuse WA's rows) with real paging.
  `tests/fixtures/snapshots/{zip}.json` drive render tests and Playwright; `map-metrics.json` is what
  `/api/map-metrics` returns for that recorded data (`mockMapMetrics()` in `tests/e2e/helpers.ts`).
- **Render-level:** `hero-cards.test.tsx` asserts the displayed $ equals the API % × stated base, null/out-of-range →
  "Data unavailable", and signs/arrows. `provenance.test.tsx` requires complete provenance. `no-hardcoded-dates.test.ts`.
- **Mapping:** `exhaustive-zip-mappings.test.ts` (every zip; valid code sets come from source modules),
  `reference-codes.test.ts`, `npm run audit:mappings`.
- **E2E:** Playwright with `mockDataApi()` (`tests/e2e/helpers.ts`), never live BLS/EIA.
- **Live:** `.github/workflows/verify-live.yml` runs `verify:live` on Tuesdays at 14:00 UTC and opens an issue on failure.
- **Don't write** tests that re-implement the code under test (inline % formulas, copied parsers, constant snapshots,
  "function equals itself"). Import the real function and assert against independent expected values.

## Critical rules

- Never hard-code secrets; all keys come from env. Never fetch national data per zip (it uses shared keys).
- Batch BLS series in one POST. All runtime BLS/EIA calls go through `cached-sources.ts`.
- Never show a blank card: show data, a skeleton, or "Data unavailable". Never show a national number as local.
- Never cache or display values outside the sanity ranges. A missing baseline is null, never 0.
- For mapping changes: rebuild the generated JSON with its script (don't hand-edit), rebuild `county-geo.json`, run
  `audit:mappings` + `npm test`, then flush only the affected keys.

## Environment variables

Vercel: `BLS_API_KEY`, `EIA_API_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `CRON_SECRET` (live health checks only);
optional `BLS_RUNTIME_DAILY_BUDGET` (default 60) / `EIA_RUNTIME_DAILY_BUDGET` (default 300). GitHub secrets: `BLS_API_KEY`,
`EIA_API_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` (refresh-cache); `BLS_API_KEY` and `EIA_API_KEY` (verify-live);
`CENSUS_API_KEY` is used only by the Census build scripts.

## Deploy

Push to `main` → Vercel production; PRs get previews. After a deploy that changes cache keys, format or mappings, run
the refresh-cache workflow once (Actions → workflow_dispatch) **before or right after** the deploy, then
`npm run verify:live`. Retire any external cron that still calls `/api/warm-cache` (the route is gone).

## Known issues

- HI and AK gas: BLS publishes only Honolulu (S49F) and Anchorage (S49G), monthly; EIA nothing. Elsewhere in HI/AK
  (Hilo, Maui, Kauai, Fairbanks, Juneau…) the Honolulu / Anchorage price is a labeled stand-in; local prices are
  typically higher, and every surface (card, chart, share, OG, og:description) says so.
- PO-box/unique zips (`zcta: false`) have no ACS data of their own; they borrow a donor zip's ACS rent: the largest
  residential zip in the same city (`donorScope: 'city'`), else the most populous in the county (`'county'`) — not
  necessarily the nearest zip.
- Electricity is a statewide average across utilities: a household's own utility rate (and its change) can differ a
  lot from it; the card's ⓘ says so. EIA publishes nothing for territories.
- Zillow county rent covers only ~41% of residential zips (~590 counties). The rest get the CPI shelter card.
- Using the real HUD USPS crosswalk would need a HUD USER API token.
- Kalawao HI and AS/GU/MP/VI have no county record (no Zillow tabs, not on the map).

## Shell command notes

- Never use `node -e` with inline multiline strings (causes permission prompt issues).
- Write utility scripts to `scripts/` and run them as files instead.
