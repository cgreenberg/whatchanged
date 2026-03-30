"""Verify dollar translation formulas match independently computed values.

AUDIT ISOLATION: This module does NOT import from the main codebase.
All formulas, rates, and constants are independently hardcoded with source
comments.

The site computes dollar impacts server-side (in snapshot.ts via
dollar-translations.ts) and returns them in the API response as
dollarImpact.groceries, dollarImpact.shelter, dollarImpact.gas,
dollarImpact.tariff.

This validator recomputes expected values from the raw API data
(CPI % changes, Census income/rent) using independently hardcoded
formulas and compares against the site's pre-computed values.
"""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------
# Independently hardcoded constants
# Source: Census ACS 5-year estimate (2023), table B19013 (national)
# Used as scaling denominator for grocery spend adjustment
NATIONAL_MEDIAN_INCOME = 74580

# Source: Census ACS 5-year estimate (2023), table B25064 (national)
# Used as default when zip-specific rent is unavailable
NATIONAL_MEDIAN_RENT = 1271

# Source: BLS Consumer Expenditure Survey (2023)
# Average annual food-at-home + food-away-from-home spending ~$6000
ANNUAL_GROCERY_BASE = 6000
# -----------------------------------------------------------------

# Tolerance for dollar comparisons
TOLERANCE_DOLLARS = 1  # $1 rounding tolerance


def _expected_grocery_impact(pct_change: float, local_income: float) -> int:
    """Compute expected annual grocery dollar impact.

    Formula: (ANNUAL_GROCERY_BASE * local_income / NATIONAL_MEDIAN_INCOME) * abs(pct_change) / 100
    Source: dollar-translations formula, MAPPING_STRATEGY.md
    """
    grocery_spend = ANNUAL_GROCERY_BASE * (local_income / NATIONAL_MEDIAN_INCOME)
    return round(grocery_spend * abs(pct_change) / 100)


def _expected_shelter_impact(pct_change: float, median_rent: float) -> int:
    """Compute expected annual shelter dollar impact.

    Formula: (median_rent * 12) * abs(pct_change) / 100
    Source: dollar-translations formula, MAPPING_STRATEGY.md
    """
    annual_rent = median_rent * 12
    return round(annual_rent * abs(pct_change) / 100)


def verify_dollar_translations(site_data: dict) -> list[CheckResult]:
    """Verify the site's dollarImpact values match independently computed expectations.

    Args:
        site_data: Full API response from whatchanged.us /api/data/{zip}

    Returns:
        List of CheckResult for each dollar translation checked.
    """
    results = []

    dollar_impact = site_data.get("dollarImpact")

    if dollar_impact is None:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="dollar_translation",
            check_name="dollar_impact_present",
            message="dollarImpact not present in API response (may be old cached response)",
            description="Check that the API response includes pre-computed dollar impact values.",
        ))
        return results

    # --- Extract source data for independent computation ---
    cpi_data = site_data.get("cpi", {}).get("data")
    census_data = site_data.get("census", {}).get("data", {})
    tariff_data = site_data.get("tariff", {}).get("data")
    gas_data = site_data.get("gas", {}).get("data")

    local_income = census_data.get("medianIncome") if census_data else None
    median_rent = census_data.get("medianRent") if census_data else None

    # Use national defaults when local data unavailable (matches site behavior)
    effective_income = local_income if local_income else NATIONAL_MEDIAN_INCOME
    effective_rent = median_rent if median_rent else NATIONAL_MEDIAN_RENT

    # --- Check 1: Grocery dollar impact ---
    groceries_change = cpi_data.get("groceriesChange") if cpi_data else None
    site_grocery_impact = dollar_impact.get("groceries")

    if groceries_change is not None and site_grocery_impact is not None:
        expected = _expected_grocery_impact(groceries_change, effective_income)
        diff = abs(site_grocery_impact - expected)
        match = diff <= TOLERANCE_DOLLARS

        results.append(CheckResult(
            status=CheckStatus.PASS if match else CheckStatus.FAIL,
            category="dollar_translation",
            check_name="grocery_dollar_impact",
            site_value=site_grocery_impact,
            source_value=expected,
            difference=diff,
            tolerance=float(TOLERANCE_DOLLARS),
            unit="dollars/yr",
            message=(
                f"Grocery impact: site=${site_grocery_impact} vs "
                f"expected=${expected} "
                f"(groceriesChange={groceries_change:.2f}%, "
                f"income=${effective_income:,})"
            ),
            description=(
                "Verify grocery dollar impact = "
                f"(${ANNUAL_GROCERY_BASE} * localIncome / ${NATIONAL_MEDIAN_INCOME:,}) "
                f"* abs(groceriesChange%) / 100. "
                f"Tolerance: ${TOLERANCE_DOLLARS}."
            ),
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="dollar_translation",
            check_name="grocery_dollar_impact",
            message="Missing groceriesChange or dollarImpact.groceries for verification",
            description="Verify grocery dollar impact matches independent formula computation.",
        ))

    # --- Check 2: Shelter dollar impact ---
    shelter_change = cpi_data.get("shelterChange") if cpi_data else None
    site_shelter_impact = dollar_impact.get("shelter")

    if shelter_change is not None and site_shelter_impact is not None:
        expected = _expected_shelter_impact(shelter_change, effective_rent)
        diff = abs(site_shelter_impact - expected)
        match = diff <= TOLERANCE_DOLLARS

        results.append(CheckResult(
            status=CheckStatus.PASS if match else CheckStatus.FAIL,
            category="dollar_translation",
            check_name="shelter_dollar_impact",
            site_value=site_shelter_impact,
            source_value=expected,
            difference=diff,
            tolerance=float(TOLERANCE_DOLLARS),
            unit="dollars/yr",
            message=(
                f"Shelter impact: site=${site_shelter_impact} vs "
                f"expected=${expected} "
                f"(shelterChange={shelter_change:.2f}%, "
                f"rent=${effective_rent:,}/mo)"
            ),
            description=(
                "Verify shelter dollar impact = "
                f"(medianRent * 12) * abs(shelterChange%) / 100. "
                f"Tolerance: ${TOLERANCE_DOLLARS}."
            ),
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="dollar_translation",
            check_name="shelter_dollar_impact",
            message="Missing shelterChange or dollarImpact.shelter for verification",
            description="Verify shelter dollar impact matches independent formula computation.",
        ))

    # --- Check 3: Gas dollar impact (simple pass-through) ---
    site_gas_impact = dollar_impact.get("gas")
    gas_change = gas_data.get("change") if gas_data else None

    if site_gas_impact is not None and gas_change is not None:
        # Gas dollar impact is just the raw $/gal change, not a formula
        diff = abs(site_gas_impact - gas_change)
        match = diff < 0.01  # floating point tolerance

        results.append(CheckResult(
            status=CheckStatus.PASS if match else CheckStatus.FAIL,
            category="dollar_translation",
            check_name="gas_dollar_impact",
            site_value=site_gas_impact,
            source_value=gas_change,
            difference=round(diff, 4),
            tolerance=0.01,
            unit="$/gal",
            message=(
                f"Gas impact: site=${site_gas_impact:.3f} vs "
                f"gas.data.change=${gas_change:.3f}"
            ),
            description=(
                "Verify gas dollar impact equals gas.data.change (direct pass-through, "
                "no formula). Tolerance: $0.01."
            ),
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="dollar_translation",
            check_name="gas_dollar_impact",
            message="Missing gas change or dollarImpact.gas for verification",
            description="Verify gas dollar impact equals gas.data.change (direct pass-through).",
        ))

    # --- Check 4: Tariff dollar impact (pass-through from tariff estimate) ---
    site_tariff_impact = dollar_impact.get("tariff")
    tariff_cost = tariff_data.get("estimatedCost") if tariff_data else None

    if site_tariff_impact is not None and tariff_cost is not None:
        diff = abs(site_tariff_impact - tariff_cost)
        match = diff <= TOLERANCE_DOLLARS

        results.append(CheckResult(
            status=CheckStatus.PASS if match else CheckStatus.FAIL,
            category="dollar_translation",
            check_name="tariff_dollar_impact",
            site_value=site_tariff_impact,
            source_value=tariff_cost,
            difference=diff,
            tolerance=float(TOLERANCE_DOLLARS),
            unit="dollars/yr",
            message=(
                f"Tariff impact: site=${site_tariff_impact} vs "
                f"tariff.data.estimatedCost=${tariff_cost}"
            ),
            description=(
                "Verify tariff dollar impact equals tariff.data.estimatedCost "
                "(direct pass-through). Tolerance: $1."
            ),
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="dollar_translation",
            check_name="tariff_dollar_impact",
            message="Missing tariff estimate or dollarImpact.tariff for verification",
            description="Verify tariff dollar impact equals tariff.data.estimatedCost (direct pass-through).",
        ))

    return results
