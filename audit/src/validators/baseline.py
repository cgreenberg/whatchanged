"""Verify that baseline values correspond to January 2025 in the series data.

Catches bugs where the baseline is computed from the wrong month.
"""

import logging
from datetime import date
from typing import Optional
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)


def verify_baselines(site_data: dict) -> list[CheckResult]:
    """Verify that Jan 2025 baseline values match the actual series data.

    For each data category, find the Jan 2025 data point in the series
    and confirm it matches the reported baseline.

    Args:
        site_data: Full API response from whatchanged.us

    Returns:
        List of CheckResult.
    """
    results = []

    # Gas baseline
    gas_data = site_data.get("gas", {}).get("data")
    if gas_data:
        gas_result = _check_gas_baseline(gas_data)
        if gas_result:
            results.append(gas_result)

    # Unemployment baseline
    unemp_data = site_data.get("unemployment", {}).get("data")
    if unemp_data:
        unemp_result = _check_unemployment_baseline(unemp_data)
        if unemp_result:
            results.append(unemp_result)

    # CPI baseline
    cpi_data = site_data.get("cpi", {}).get("data")
    if cpi_data:
        cpi_result = _check_cpi_baseline(cpi_data)
        if cpi_result:
            results.append(cpi_result)

    if not results:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="baseline",
            check_name="baseline_verification",
            message="No baseline data available to verify",
            description="Verify that baseline values correspond to January 2025 in the series data.",
        ))

    return results


def _check_gas_baseline(gas_data: dict) -> Optional[CheckResult]:
    """Verify gas baseline matches Jan 2025 series data."""
    baseline = gas_data.get("baseline")
    series = gas_data.get("series", [])

    if baseline is None or not series:
        return None

    jan_2025 = _find_jan_2025_in_series(series, date_key="date", value_key="price")
    if jan_2025 is None:
        jan_2025 = _find_jan_2025_in_series(series, date_key="date", value_key="value")

    if jan_2025 is None:
        return CheckResult(
            status=CheckStatus.WARN,
            category="baseline",
            check_name="gas_baseline",
            message="Could not find Jan 2025 in gas series to verify baseline",
            details={"reported_baseline": baseline},
            description="Verify the gas price baseline matches the Jan 20, 2025 data point in the series (inauguration day).",
        )

    tolerance = 0.10
    match = abs(baseline - jan_2025) < tolerance
    return CheckResult(
        status=CheckStatus.PASS if match else CheckStatus.FAIL,
        category="baseline",
        check_name="gas_baseline",
        site_value=baseline,
        source_value=jan_2025,
        difference=abs(baseline - jan_2025),
        tolerance=tolerance,
        message=f"Gas baseline: reported {baseline}, series Jan 2025 = {jan_2025}",
        description="Verify the gas price baseline matches the Jan 20, 2025 data point in the series (inauguration day).",
    )


def _check_unemployment_baseline(unemp_data: dict) -> Optional[CheckResult]:
    """Verify unemployment baseline matches Jan 2025 series data."""
    baseline = unemp_data.get("baseline")
    series = unemp_data.get("series", [])

    if baseline is None or not series:
        return None

    jan_2025 = _find_jan_2025_in_series(series, date_key="date", value_key="rate")

    if jan_2025 is None:
        return CheckResult(
            status=CheckStatus.WARN,
            category="baseline",
            check_name="unemployment_baseline",
            message="Could not find Jan 2025 in unemployment series",
            details={"reported_baseline": baseline},
            description="Verify the unemployment baseline matches the January 2025 data point in the series.",
        )

    match = abs(baseline - jan_2025) < 0.1
    return CheckResult(
        status=CheckStatus.PASS if match else CheckStatus.FAIL,
        category="baseline",
        check_name="unemployment_baseline",
        site_value=baseline,
        source_value=jan_2025,
        difference=abs(baseline - jan_2025),
        message=f"Unemployment baseline: reported {baseline}, series Jan 2025 = {jan_2025}",
        description="Verify the unemployment baseline matches the January 2025 data point in the series.",
    )


def _check_cpi_baseline(cpi_data: dict) -> Optional[CheckResult]:
    """Verify CPI grocery baseline matches Jan 2025 series data."""
    baseline = cpi_data.get("groceriesBaseline")
    series = cpi_data.get("series", [])

    if baseline is None or not series:
        return None

    jan_2025 = _find_jan_2025_in_series(series, date_key="date", value_key="groceries")

    if jan_2025 is None:
        return CheckResult(
            status=CheckStatus.WARN,
            category="baseline",
            check_name="cpi_grocery_baseline",
            message="Could not find Jan 2025 in CPI series",
            details={"reported_baseline": baseline},
            description="Verify the CPI grocery baseline matches the January 2025 index value in the series.",
        )

    match = abs(baseline - jan_2025) < 0.01
    return CheckResult(
        status=CheckStatus.PASS if match else CheckStatus.FAIL,
        category="baseline",
        check_name="cpi_grocery_baseline",
        site_value=baseline,
        source_value=jan_2025,
        difference=abs(baseline - jan_2025),
        message=f"CPI grocery baseline: reported {baseline}, series Jan 2025 = {jan_2025}",
        description="Verify the CPI grocery baseline matches the January 2025 index value in the series.",
    )


def _find_jan_2025_in_series(
    series: list[dict],
    date_key: str = "date",
    value_key: str = "value",
) -> Optional[float]:
    """Find the January 2025 value in a time series, preferring Jan 20 2025.

    For weekly data (e.g. gas prices), there may be multiple January 2025
    entries (Jan 6, Jan 13, Jan 20, Jan 27). The site uses Jan 20 2025
    (inauguration day) as the baseline, so we pick the entry whose date is
    closest to 2025-01-20. An exact match is always preferred.

    Handles various date formats:
    - "2025-01-01", "2025-01-20", "2025-01"
    - {"year": "2025", "period": "M01"}
    """
    TARGET = date(2025, 1, 20)

    candidates: list[tuple[int, float]] = []  # (distance_in_days, value)

    for point in series:
        date_val = point.get(date_key, "")

        if not isinstance(date_val, str) or not date_val.startswith("2025-01"):
            continue

        val = point.get(value_key)
        if val is None:
            continue
        try:
            float_val = float(val)
        except (ValueError, TypeError):
            continue

        # Attempt to parse a full date for proximity ranking.
        # Fall back to distance 0 for month-only strings ("2025-01").
        try:
            parts = date_val.split("-")
            if len(parts) >= 3:
                entry_date = date(int(parts[0]), int(parts[1]), int(parts[2]))
                distance = abs((entry_date - TARGET).days)
            else:
                distance = 0  # month-only — treat as exact match
        except (ValueError, IndexError):
            continue

        candidates.append((distance, float_val))

    if not candidates:
        return None

    # Return the value from the candidate closest to Jan 20 2025.
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]
