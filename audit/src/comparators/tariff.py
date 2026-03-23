"""Tariff impact estimate comparison: income vs Census, estimate vs Yale methodology."""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult, compare_values

logger = logging.getLogger(__name__)

# Yale Budget Lab's estimate: ~2.05% of household income
YALE_TARIFF_RATE = 0.0205


def compare_tariff(
    site_tariff_cost: float | None,
    site_income: float | None,
    census_data: dict | None,
    tolerance_income: float = 2000.0,
    tolerance_tariff: float = 200.0,
) -> list[CheckResult]:
    """Compare tariff estimate against Census income and Yale methodology.

    Tariff data now comes from the API (tariff.data.estimatedCost / tariff.data.medianIncome),
    not from DOM scraping.

    Args:
        site_tariff_cost: Tariff $/yr from the API (tariff.data.estimatedCost)
        site_income: Median income from the API (tariff.data.medianIncome), if available
        census_data: Result from census.fetch_median_income()
        tolerance_income: Acceptable income difference ($)
        tolerance_tariff: Acceptable tariff estimate difference ($)

    Returns:
        List of CheckResult.
    """
    results = []

    # Check income against Census ACS
    census_income = census_data.get("median_income") if census_data else None

    if site_income is not None and census_income is not None:
        cmp = compare_values(site_income, census_income, tolerance_income, "$")
        results.append(CheckResult(
            status=cmp["status"],
            category="tariff",
            check_name="income_vs_census",
            site_value=site_income,
            source_value=census_income,
            difference=cmp.get("difference"),
            tolerance=tolerance_income,
            unit="dollars",
            message=f"Census ACS {census_data.get('year', '')} median income",
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="tariff",
            check_name="income_vs_census",
            message="Income not available from API or Census",
        ))

    # Check tariff estimate vs Yale methodology
    if site_tariff_cost is not None and census_income is not None:
        expected_tariff = round(census_income * YALE_TARIFF_RATE)
        cmp = compare_values(site_tariff_cost, expected_tariff, tolerance_tariff, "$")
        results.append(CheckResult(
            status=cmp["status"],
            category="tariff",
            check_name="tariff_vs_yale_method",
            site_value=site_tariff_cost,
            source_value=expected_tariff,
            difference=cmp.get("difference"),
            tolerance=tolerance_tariff,
            unit="dollars/yr",
            message=f"Yale Budget Lab method: {census_income} × {YALE_TARIFF_RATE} = {expected_tariff}",
        ))
    elif site_tariff_cost is not None:
        # Can't verify methodology without income, but tariff exists
        results.append(CheckResult(
            status=CheckStatus.WARN,
            category="tariff",
            check_name="tariff_vs_yale_method",
            site_value=site_tariff_cost,
            message="Cannot verify tariff methodology without Census income data",
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="tariff",
            check_name="tariff_vs_yale_method",
            message="No tariff estimate found in API response",
        ))

    return results
