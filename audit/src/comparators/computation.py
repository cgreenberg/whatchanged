"""Re-derive all computed values from raw series data.

Verifies that the site's internal math is correct, independent
of whether the source data itself is right.
"""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)


def verify_computations(site_data: dict) -> list[CheckResult]:
    """Independently recompute all derived values from the raw series data.

    Args:
        site_data: Full API response from whatchanged.us

    Returns:
        List of CheckResult for each computation check.
    """
    results = []

    # 1. Gas price change since Jan 2025
    gas_data = site_data.get("gas", {}).get("data")
    if gas_data:
        gas_result = _verify_gas_change(gas_data)
        if gas_result:
            results.append(gas_result)

    # 2. Grocery CPI % change
    cpi_data = site_data.get("cpi", {}).get("data")
    if cpi_data:
        grocery_result = _verify_grocery_change(cpi_data)
        if grocery_result:
            results.append(grocery_result)

    # 3. Unemployment change
    unemp_data = site_data.get("unemployment", {}).get("data")
    if unemp_data:
        unemp_result = _verify_unemployment_change(unemp_data)
        if unemp_result:
            results.append(unemp_result)

    if not results:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="computation",
            check_name="all_computations",
            message="No computable data available",
            description="Re-derive computed values from raw series data to catch internal math errors.",
        ))

    return results


def _verify_gas_change(gas_data: dict) -> CheckResult | None:
    """Verify gas price change is correctly computed from series."""
    series = gas_data.get("series", [])
    reported_change = gas_data.get("change")

    if not series or reported_change is None:
        return None

    baseline = gas_data.get("baseline")
    current = gas_data.get("current")

    if baseline is None or current is None:
        return None

    recomputed = round(current - baseline, 3)
    match = abs(reported_change - recomputed) < 0.01

    return CheckResult(
        status=CheckStatus.PASS if match else CheckStatus.FAIL,
        category="computation",
        check_name="gas_change_recomputed",
        site_value=reported_change,
        source_value=recomputed,
        difference=abs(reported_change - recomputed),
        message=f"Gas change: {current} - {baseline} = {recomputed} (site says {reported_change})",
        description="Re-derive gas price change from current and baseline values. Catches internal math errors.",
    )


def _verify_grocery_change(cpi_data: dict) -> CheckResult | None:
    """Verify grocery % change is correctly computed from baseline and current."""
    current = cpi_data.get("groceriesCurrent")
    baseline = cpi_data.get("groceriesBaseline")
    reported = cpi_data.get("groceriesChange")

    if current is None or baseline is None or reported is None:
        return None

    if baseline == 0:
        return CheckResult(
            status=CheckStatus.FAIL,
            category="computation",
            check_name="grocery_pct_recomputed",
            message="Grocery baseline is zero — cannot compute % change",
            description="Re-derive grocery CPI % change from current and baseline index values.",
        )

    recomputed = round((current - baseline) / baseline * 100, 1)
    match = abs(reported - recomputed) < 0.15

    return CheckResult(
        status=CheckStatus.PASS if match else CheckStatus.FAIL,
        category="computation",
        check_name="grocery_pct_recomputed",
        site_value=reported,
        source_value=recomputed,
        difference=abs(reported - recomputed),
        unit="percentage points",
        message=f"Grocery CPI: ({current} - {baseline}) / {baseline} × 100 = {recomputed}% (site says {reported}%)",
        description="Re-derive grocery CPI % change from current and baseline index values.",
    )


def _verify_unemployment_change(unemp_data: dict) -> CheckResult | None:
    """Verify unemployment change is correctly computed from current - baseline."""
    current = unemp_data.get("current")
    baseline = unemp_data.get("baseline")
    reported = unemp_data.get("change")

    if current is None or baseline is None or reported is None:
        return None

    recomputed = round(current - baseline, 1)
    match = abs(reported - recomputed) < 0.05

    return CheckResult(
        status=CheckStatus.PASS if match else CheckStatus.FAIL,
        category="computation",
        check_name="unemployment_change_recomputed",
        site_value=reported,
        source_value=recomputed,
        difference=abs(reported - recomputed),
        unit="percentage points",
        message=f"Unemployment: {current} - {baseline} = {recomputed} (site says {reported})",
        description="Re-derive unemployment rate change from current and baseline values.",
    )
