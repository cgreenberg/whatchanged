"""Tariff impact estimate comparison: income vs Census, estimate vs Yale methodology."""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult, compare_values

logger = logging.getLogger(__name__)

# Yale Budget Lab's estimate: ~2.05% of household income
YALE_TARIFF_RATE = 0.0205


def compare_tariff(
    rendered_tariff: float | None,
    rendered_income: float | None,
    census_data: dict | None,
    tolerance_income: float = 2000.0,
    tolerance_tariff: float = 200.0,
) -> list[CheckResult]:
    """Compare tariff estimate against Census income and Yale methodology.

    Note: tariff data is computed client-side, so values come from DOM scraping,
    not the API (which returns "tariff": {}).

    Args:
        rendered_tariff: Tariff $/yr scraped from the rendered page
        rendered_income: Income figure scraped from the rendered page (if visible)
        census_data: Result from census.fetch_median_income()
        tolerance_income: Acceptable income difference ($)
        tolerance_tariff: Acceptable tariff estimate difference ($)

    Returns:
        List of CheckResult.
    """
    results = []

    # Check income against Census ACS
    census_income = census_data.get("median_income") if census_data else None

    if rendered_income is not None and census_income is not None:
        cmp = compare_values(rendered_income, census_income, tolerance_income, "$")
        results.append(CheckResult(
            status=cmp["status"],
            category="tariff",
            check_name="income_vs_census",
            site_value=rendered_income,
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
            message="Income not available from page or Census",
        ))

    # Check tariff estimate vs Yale methodology
    if rendered_tariff is not None and census_income is not None:
        expected_tariff = round(census_income * YALE_TARIFF_RATE)
        cmp = compare_values(rendered_tariff, expected_tariff, tolerance_tariff, "$")
        results.append(CheckResult(
            status=cmp["status"],
            category="tariff",
            check_name="tariff_vs_yale_method",
            site_value=rendered_tariff,
            source_value=expected_tariff,
            difference=cmp.get("difference"),
            tolerance=tolerance_tariff,
            unit="dollars/yr",
            message=f"Yale Budget Lab method: {census_income} × {YALE_TARIFF_RATE} = {expected_tariff}",
        ))
    elif rendered_tariff is not None:
        # Can't verify methodology without income, but tariff exists
        results.append(CheckResult(
            status=CheckStatus.WARN,
            category="tariff",
            check_name="tariff_vs_yale_method",
            site_value=rendered_tariff,
            message="Cannot verify tariff methodology without Census income data",
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="tariff",
            check_name="tariff_vs_yale_method",
            message="No tariff estimate found on rendered page",
        ))

    return results
