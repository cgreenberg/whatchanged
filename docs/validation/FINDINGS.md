# Data validation findings (2026-10-01)

Full results are in `report.md`, which `scripts/validate-local-data.py` regenerates. The validator parses every raw file with its own code and does not import the build script. Of 45 checks, 19 pass, 15 warn, 11 are informational and none fail.

## What holds up

| Claim | Evidence |
|---|---|
| The pipeline reproduces its sources | 10 test zips match raw ZHVI within 0.06 pts. 5 counties' 4-quarter wage changes match a recompute from the live BLS QCEW API across 8 quarters each. EIA API electricity prices match EIA's published table 5.6.A for all 62 rows. ACA averages reproduce CMS's national totals ($85 for 2025, $137 for 2026). |
| County rent changes are real | Zillow vs Apartment List since Jan 2025: r = 0.84 across 370 counties and 0.81 across 564 cities. Austin is −0.6% / −4.1%, SF +36.6% / +40.3%, NYC +12.7% / +11.7%, Lake Charles +25.1% / +27.3%. |
| County home-value changes are real for larger counties | ZHVI vs FHFA (2025): r = 0.80 for the 492 counties with ≥50k jobs. ZHVI runs about 1.5 pts below FHFA. One reason is that FHFA uses conforming mortgages only, so it leaves out jumbo-loan markets. |
| County wage changes are internally consistent | Emp-weighted county averages reproduce official state changes (r = 0.94, MAE 0.27 pts). |
| Our seasonal adjustment beats raw data | State LAUS: MAE vs BLS official SA is 0.22 pts with ours and 0.36 pts with raw NSA. |

## What changed in the build because of validation

1. **Paychecks now pool 4 quarters.** A single quarter's change is mostly bonus and stock-vesting timing. For counties with ≥20k jobs, Q1-2026 YoY vs Q4-2025 YoY gives r = 0.03. Two examples: Carver County MN went from +40% to −22%, and SF from +20.5% to −9.5%. The build now compares the average of the last 4 quarters with the 4 before. Prices are averaged over the same 12 months. The middle 90% of large counties now falls between +1.3% and +6.0%, where single quarters had produced ±20% swings.
2. **County unemployment uses 3-month averages.** August 2026 is preliminary and shows implausible drops in 8 large counties. Five of them are in Ohio (Cuyahoga 3.8% → 1.9% YoY). October 2025 is missing (shutdown).
3. **New-construction figures need ≥200 units in the base period.** Small bases produced +449% swings. This lowers coverage to 693 counties.
4. **Connecticut and Alaska:** legacy CT counties now take BLS and Census values from their dominant planning region, using the same mapping as `bls.ts`. Valdez-Cordova AK takes Chugach's values. These are flagged `approx`.
5. **Indeed postings:** 15 metros use older CBSA codes. They're now re-keyed by principal city + state, so 1,438 counties are covered.

## What we cannot claim (show with caveats in the UI)

- **Zip-vs-zip differences within a county are not corroborated.** Between counties, ZHVI agrees with FHFA (r = 0.53) and with Realtor.com list $/sqft (r = 0.54). Within the same county, the agreement is r = 0.06 and 0.11. Zip rents show the same pattern against HUD (r = −0.04 within counties), but HUD is formula-based, so that comparison is weak evidence either way. **Recommendation:** lead with the county or city number, and show the zip figure as an estimate. Don't put a precise "faster than 69% of US zips" rank on within-county differences. Ranking counties is defensible.
- **BLS CPI rent and Zillow measure different things.** CPI rent covers all tenants, including existing leases. Zillow covers new leases. Across the 23 CPI metros, Zillow's change since Jan 2025 matches CPI rent at r = 0.50. Zillow's change a year earlier (Jan 2024 → Jan 2025) matches at r = 0.80. So CPI trails market rents by about a year, which explains why Austin's live "Housing costs" card goes up while Austin rents fall. Both numbers are correct, and the card should say which one it shows.
- **HUD Small Area FMRs are not usable as a "change since Jan 2025" measure.** They are formula-based on survey data about 2 years old, and they correlate with Zillow at only r = 0.23. Don't use them as a rent fallback for change. They could still serve as a rent level.

## Outliers checked and kept (real, not bugs)

- **Rent:** Taylor County TX (Abilene) +48%. All 5 Abilene zips rose 47–60%, job postings rose 29%, and ACA gross premiums rose too. Apartment List doesn't cover Abilene. Lake Charles LA +25% is confirmed by Apartment List (+27%). SF +34% is confirmed by Apartment List (+40%).
- **Unemployment:** Buncombe NC −3.6 pts. The January 2025 baseline was inflated after Hurricane Helene, so this is real but misleading without context.
- **ACA:** Navajo County AZ net premium $65 → $446. This is real in the CMS file, and enrollment fell from 4,641 to 3,111.

## Coverage

Of the site's 33,791 zips, 78% have zip-level home values and 17% have zip-level rent. The rest fall back to county rent, which Zillow covers for 978 counties, or to Zillow city rent (2,637 cities). Puerto Rico has data but no map shape.
