---
# Gas Prices: Tiered EIA Mapping + National Fallback

**Date:** 2026-03-21
**Status:** Approved
**Problem:** `fetchGasPrice()` uses `S${stateAbbr}` as the EIA duoarea code, but EIA only has state-level data for 8 states (WA, NY, OH, CA, FL, MN, CO, TX). All other states (including PA/Pittsburgh) get no data, causing the hero card to disappear and the chart to show "Data unavailable."

## Solution

### 1. Tiered duoarea mapping (`src/lib/api/eia.ts`)

Replace `stateToEiaDuoarea()` with a mapping table that returns the best available EIA duoarea code for each state:

- **State-level** (8 states): SWA, SNY, SOH, SCA, SFL, SMN, SCO, STX
- **PADD region** (all other states):
  - PADD 1A (R1X): CT, ME, MA, NH, RI, VT
  - PADD 1B (R1Y): DE, DC, MD, NJ, PA
  - PADD 1C (R1Z): GA, NC, SC, VA, WV
  - PADD 2 (R20): IL, IN, IA, KS, KY, MI, MO, NE, ND, SD, OK, TN, WI
  - PADD 3 (R30): AL, AR, LA, MS, NM
  - PADD 4 (R40): ID, MT, UT, WY
  - PADD 5 (R50): AK, AZ, HI, NV, OR

Note: NY is in PADD 1B but has state-level data (SNY), so it uses state-level. Same logic for OH (PADD 2), FL (PADD 1C), MN (PADD 2), CO (PADD 4), TX (PADD 3).

The function should also return a `geoLevel` string: "State-level" for state codes, "Regional (PADD X)" for PADD codes.

### 2. Parallel fetch with national fallback (`src/lib/api/eia.ts`)

Restructure `fetchGasPrice()`:
- Fetch primary (state or PADD) and national (`NUS`) in parallel via `Promise.allSettled`
- If primary succeeds: use it, attach national as `nationalSeries` (current behavior)
- If primary fails but national succeeds: use national as primary series, set `isNationalFallback: true`, set `region: "National avg"`
- If both fail: throw error (same as today)

### 3. Type update (`src/types/index.ts`)

Add to `GasPriceData`:
- `isNationalFallback?: boolean`
- `geoLevel?: string` (to pass through "State-level" vs "Regional" vs "National avg")

### 4. Hero card update (`src/app/page.tsx`)

- Always render gas hero card when `snapshot.gas.data` exists (no behavior change needed — it already does this)
- Use `snapshot.gas.data.geoLevel` for the geo level label instead of hardcoded "state-level"
- When `isNationalFallback` is true, append "(state data unavailable)" to the geo level label

### 5. Chart config update (`src/lib/charts/chart-config.ts`)

- Remove hardcoded `geoLevel: 'State-level'` from gas chart config — it will be set dynamically from data

## Out of Scope

- City-level EIA codes (YBOS, YCLE, etc.) — could be a future enhancement
- Changes to any other data source
- Caching logic changes

## Test Cases

- Zip 98683 (WA): Should use state-level `SWA` — works as before
- Zip 15120 (PA): Should use PADD 1B `R1Y` — previously failed, now shows regional data
- Zip 99999 (invalid): Should still show clean error
- If EIA API is completely down: should fall back to national, then fail gracefully
