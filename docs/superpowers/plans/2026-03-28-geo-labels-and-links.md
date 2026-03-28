# Fix Geographic Labels and Add Region Map Links

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make geographic labels accurately reflect data tier (metro vs regional vs national) and link each label to the official government map page for that region.

**Architecture:** Add `tier` field (1/2/3) to both `CpiData` and `GasPriceData` types. Thread tier from the mapping functions through the API modules into the snapshot response. Use tier in the frontend to select the correct label prefix (`metro:` / `region:` / `national`) and the correct `sourceUrl` link. Also update PAD district names to include the PADD identifier.

**Tech Stack:** TypeScript, React (Next.js)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/index.ts` | Modify | Add `tier` to `CpiData` and `GasPriceData` |
| `src/lib/mappings/county-metro-cpi.ts` | Modify | Add `tier` to return type of `getMetroCpiAreaForCounty` |
| `src/lib/api/bls-cpi.ts` | Modify | Pass `tier` through to `CpiData` |
| `src/lib/api/eia.ts` | Modify | Pass `tier` through to `GasPriceData` |
| `src/lib/mappings/eia-gas.ts` | Modify | Add PADD identifiers to `PAD_NAMES` |
| `src/components/HomeContent.tsx` | Modify | Tier-based `geoLevel` labels and `sourceUrl` links |
| `src/components/charts/ChartsSection.tsx` | Modify | Tier-based `geoLevel` and `sourceUrl` for CPI charts |
| `tests/unit/cpi-area-mapping.test.ts` | Modify | Update tests for new return type |

---

### Task 1: Add `tier` to Types

**Files:**
- Modify: `src/types/index.ts:39-60`

- [ ] **Step 1: Add `tier` to `CpiData`**

In `src/types/index.ts`, add `tier` field to `CpiData`:

```typescript
export interface CpiData {
  groceriesCurrent: number
  groceriesBaseline: number
  groceriesChange: number
  shelterChange: number
  series: CpiPoint[]
  metro: string
  tier: 1 | 2 | 3
  seriesIds?: { groceries: string; shelter: string; energy: string }
  nationalSeries?: CpiPoint[]
}
```

- [ ] **Step 2: Add `tier` to `GasPriceData`**

In the same file, add `tier` field to `GasPriceData`:

```typescript
export interface GasPriceData {
  current: number
  baseline: number
  change: number
  region: string
  series: Array<{ date: string; price: number }>
  nationalSeries?: Array<{ date: string; price: number }>
  isNationalFallback?: boolean
  geoLevel?: string
  duoarea?: string
  tier?: 1 | 2 | 3
}
```

Note: `tier` is optional on `GasPriceData` because the national fallback path doesn't go through `getGasLookup`.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add tier field to CpiData and GasPriceData types"
```

---

### Task 2: Add `tier` to CPI Mapping Return Type

**Files:**
- Modify: `src/lib/mappings/county-metro-cpi.ts:55-73`
- Test: `tests/unit/cpi-area-mapping.test.ts`

- [ ] **Step 1: Update `getMetroCpiAreaForCounty` return type and values**

In `src/lib/mappings/county-metro-cpi.ts`, change the function to return `tier`:

```typescript
export function getMetroCpiAreaForCounty(
  countyFips: string,
  stateAbbr: string
): { areaCode: string; areaName: string; tier: 1 | 2 | 3 } {
  // Tier 1: CBSA-based lookup (official OMB → BLS mapping)
  const cbsaArea = (cbsaCrosswalk as Record<string, string>)[countyFips]
  if (cbsaArea && BLS_CPI_AREAS[cbsaArea]) {
    return { areaCode: cbsaArea, areaName: BLS_CPI_AREAS[cbsaArea].name, tier: 1 }
  }

  // Tier 2: Regional CPI fallback
  const regionCode = STATE_TO_REGION[stateAbbr.toUpperCase()]
  if (regionCode && BLS_CPI_AREAS[regionCode]) {
    return { areaCode: regionCode, areaName: BLS_CPI_AREAS[regionCode].name, tier: 2 }
  }

  // Tier 3: National fallback (territories)
  return { areaCode: '0000', areaName: 'National', tier: 3 }
}
```

- [ ] **Step 2: Update tests**

In `tests/unit/cpi-area-mapping.test.ts`, add `tier` assertions to existing tests. For example, in the Tier 1 section:

```typescript
test('Manhattan → New York CPI (S12A)', () => {
  const result = getMetroCpiAreaForCounty('36061', 'NY')
  expect(result.areaCode).toBe('S12A')
  expect(result.areaName).toBe('New York-Newark-Jersey City')
  expect(result.tier).toBe(1)
})
```

In the Tier 2 section:

```typescript
test('rural Mississippi county → South regional (0300)', () => {
  const result = getMetroCpiAreaForCounty('28005', 'MS')
  expect(result.areaCode).toBe('0300')
  expect(result.areaName).toBe('South Urban')
  expect(result.tier).toBe(2)
})
```

In the Tier 3 section:

```typescript
test('Puerto Rico → National (0000)', () => {
  const result = getMetroCpiAreaForCounty('72001', 'PR')
  expect(result.areaCode).toBe('0000')
  expect(result.areaName).toBe('National')
  expect(result.tier).toBe(3)
})
```

Add `tier` assertions to ALL existing tests in this file — every test that calls `getMetroCpiAreaForCounty` should assert the expected tier.

- [ ] **Step 3: Run tests**

Run: `npm test -- --testPathPattern=cpi-area-mapping`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/mappings/county-metro-cpi.ts tests/unit/cpi-area-mapping.test.ts
git commit -m "feat: add tier to getMetroCpiAreaForCounty return type"
```

---

### Task 3: Thread `tier` Through BLS CPI Module

**Files:**
- Modify: `src/lib/api/bls-cpi.ts:14-15,173-186`

- [ ] **Step 1: Destructure `tier` and pass it through**

In `src/lib/api/bls-cpi.ts`, line 15 currently reads:

```typescript
const { areaCode, areaName } = getMetroCpiAreaForCounty(countyFips, stateAbbr)
```

Change to:

```typescript
const { areaCode, areaName, tier } = getMetroCpiAreaForCounty(countyFips, stateAbbr)
```

Then in the return statement (line 173-186), add `tier`:

```typescript
return {
  groceriesCurrent,
  groceriesBaseline,
  groceriesChange,
  shelterChange,
  series,
  metro: areaName,
  tier,
  seriesIds: {
    groceries: groceriesSeries,
    shelter: shelterSeries,
    energy: energySeries,
  },
  ...(nationalSeries ? { nationalSeries } : {}),
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/api/bls-cpi.ts
git commit -m "feat: thread CPI tier through to CpiData response"
```

---

### Task 4: Thread `tier` Through EIA Gas Module

**Files:**
- Modify: `src/lib/api/eia.ts:170-224`

- [ ] **Step 1: Add `tier` to all return statements in `fetchGasPrice`**

In `src/lib/api/eia.ts`, there are three return statements in `fetchGasPrice`:

**Return 1** (line 170, primary is national):
```typescript
return {
  current,
  baseline,
  change: parseFloat((current - baseline).toFixed(3)),
  region: regionName,
  geoLevel: 'National avg',
  isNationalFallback: true,
  duoarea: 'NUS',
  tier: 3 as const,
  series,
}
```

**Return 2** (line 199, primary succeeded):
```typescript
return {
  current,
  baseline,
  change: parseFloat((current - baseline).toFixed(3)),
  region: regionName,
  geoLevel: lookup.geoLevel,
  isNationalFallback: false,
  duoarea: lookup.duoarea,
  tier: lookup.tier,
  series,
  ...(nationalSeries ? { nationalSeries } : {}),
}
```

**Return 3** (line 215, primary failed, national fallback):
```typescript
return {
  current,
  baseline,
  change: parseFloat((current - baseline).toFixed(3)),
  region: 'National avg',
  geoLevel: 'National avg',
  isNationalFallback: true,
  duoarea: 'NUS',
  tier: 3 as const,
  series,
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/api/eia.ts
git commit -m "feat: thread gas tier through to GasPriceData response"
```

---

### Task 5: Update PAD District Names

**Files:**
- Modify: `src/lib/mappings/eia-gas.ts:873-881`

- [ ] **Step 1: Add PADD identifiers to `PAD_NAMES`**

In `src/lib/mappings/eia-gas.ts`, replace the `PAD_NAMES` object:

```typescript
export const PAD_NAMES: Record<string | number, string> = {
  '1A': 'New England (PADD 1A)',
  '1B': 'Central Atlantic (PADD 1B)',
  '1C': 'Lower Atlantic (PADD 1C)',
  2: 'Midwest (PADD 2)',
  3: 'Gulf Coast (PADD 3)',
  4: 'Rocky Mountain (PADD 4)',
  5: 'West Coast (PADD 5)',
}
```

- [ ] **Step 2: Run tests to check for snapshot regressions**

Run: `npm test`
Expected: all tests pass (some tests may assert exact gas label strings — update those if they fail)

- [ ] **Step 3: Commit**

```bash
git add src/lib/mappings/eia-gas.ts
git commit -m "fix: add PADD identifiers to gas PAD district labels"
```

---

### Task 6: Fix CPI Labels and Links in HomeContent.tsx

**Files:**
- Modify: `src/components/HomeContent.tsx:130-177`

- [ ] **Step 1: Fix shelter card `geoLevel` (line 150)**

Replace:
```typescript
geoLevel={snapshot.cpi.data?.metro === 'National' ? 'national' : `metro: ${snapshot.cpi.data?.metro}`}
```

With:
```typescript
geoLevel={
  snapshot.cpi.data?.tier === 3 ? 'national' :
  snapshot.cpi.data?.tier === 2 ? `region: ${snapshot.cpi.data?.metro}` :
  `metro: ${snapshot.cpi.data?.metro}`
}
```

- [ ] **Step 2: Fix shelter card `sourceUrl` (line 152)**

Replace:
```typescript
sourceUrl="https://data.bls.gov/cgi-bin/surveymost?cu"
```

With:
```typescript
sourceUrl={
  snapshot.cpi.data?.tier === 2
    ? 'https://www.bls.gov/cpi/regional-resources.htm'
    : snapshot.cpi.data?.tier === 1
      ? 'https://www.bls.gov/charts/consumer-price-index/consumer-price-index-by-metro-area.htm'
      : 'https://data.bls.gov/cgi-bin/surveymost?cu'
}
```

- [ ] **Step 3: Fix grocery card `geoLevel` (line 171)**

Same change as Step 1 — replace the `geoLevel` prop with tier-based logic:

```typescript
geoLevel={
  snapshot.cpi.data?.tier === 3 ? 'national' :
  snapshot.cpi.data?.tier === 2 ? `region: ${snapshot.cpi.data?.metro}` :
  `metro: ${snapshot.cpi.data?.metro}`
}
```

- [ ] **Step 4: Fix grocery card `sourceUrl` (line 173)**

Same change as Step 2:

```typescript
sourceUrl={
  snapshot.cpi.data?.tier === 2
    ? 'https://www.bls.gov/cpi/regional-resources.htm'
    : snapshot.cpi.data?.tier === 1
      ? 'https://www.bls.gov/charts/consumer-price-index/consumer-price-index-by-metro-area.htm'
      : 'https://data.bls.gov/cgi-bin/surveymost?cu'
}
```

- [ ] **Step 5: Fix gas card `sourceUrl` (line 132)**

Replace:
```typescript
sourceUrl="https://www.eia.gov/petroleum/gasdiesel/"
```

With:
```typescript
sourceUrl={
  snapshot.gas.data.tier === 3
    ? 'https://www.eia.gov/petroleum/weekly/includes/padds.php'
    : 'https://www.eia.gov/petroleum/gasdiesel/'
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/HomeContent.tsx
git commit -m "fix: tier-based geoLevel labels and sourceUrl links on stat cards"
```

---

### Task 7: Fix CPI Labels and Links in ChartsSection.tsx

**Files:**
- Modify: `src/components/charts/ChartsSection.tsx:66-67`

- [ ] **Step 1: Fix CPI chart `geoLevel` and `sourceUrl` (line 66-67)**

Replace:
```typescript
configOverrides: {
  ...(metro ? { sourceLabel: `BLS CPI — ${metro}`, geoLevel: isNational ? 'National' : `Metro: ${metro}` } : {}),
  ...(seriesIdMap[id] ? { sourceUrl: `https://data.bls.gov/timeseries/${seriesIdMap[id]}` } : {}),
},
```

With:
```typescript
configOverrides: {
  ...(metro ? {
    sourceLabel: `BLS CPI — ${metro}`,
    geoLevel: isNational ? 'National'
      : cpiData?.tier === 2 ? `Region: ${metro}`
      : `Metro: ${metro}`,
  } : {}),
  sourceUrl: cpiData?.tier === 2
    ? 'https://www.bls.gov/cpi/regional-resources.htm'
    : cpiData?.tier === 1 && seriesIdMap[id]
      ? `https://data.bls.gov/timeseries/${seriesIdMap[id]}`
      : 'https://data.bls.gov/cgi-bin/surveymost?cu',
},
```

Note: Need to check how `cpiData` is accessed in this function. Look at the case statement above — `cpiData` is `snapshot.cpi.data`. The `isNational` variable is likely derived from `metro === 'National'`. Check the surrounding code to confirm `cpiData` is in scope and has the `tier` field.

- [ ] **Step 2: Commit**

```bash
git add src/components/charts/ChartsSection.tsx
git commit -m "fix: tier-based geoLevel labels and sourceUrl links in CPI charts"
```

---

### Task 8: Run Full Test Suite and Visual Verification

- [ ] **Step 1: Run tests**

Run: `npm test`
Expected: all tests pass. If any gas label tests fail due to the PADD name changes, update the expected strings.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: clean build, no TypeScript errors

- [ ] **Step 3: Visual verification**

With the dev server running (`npm run dev`), check these zips in the browser:

| Zip | Gas Label | CPI Label |
|-----|-----------|-----------|
| 10001 | `New York City area avg` | `metro: New York-Newark-Jersey City` |
| 98683 | `Washington state avg` | `region: West Urban` |
| 37201 | (check gas label includes PADD if PAD-level) | `region: South Urban` |
| 60601 | `Chicago area avg` | `metro: Chicago-Naperville-Elgin` |

Verify:
1. No CPI label says "metro:" for regional data
2. Gas PAD labels include "(PADD X)"
3. CPI source links go to regional-resources.htm for regional zips
4. CPI source links go to metro chart page for metro zips
5. Gas source links go to PADD map page when showing PAD-level data

- [ ] **Step 4: Commit all remaining test fixes**

```bash
git add -A
git commit -m "fix: update test expectations for PADD labels and tier fields"
```
