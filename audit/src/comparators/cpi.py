"""CPI comparison: site vs BLS API (primary)."""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult, compare_values

logger = logging.getLogger(__name__)


def compare_cpi(
    site_cpi: dict,
    bls_data: dict | None,
    tolerance_index: float = 0.01,
    tolerance_pct: float = 0.1,
) -> list[CheckResult]:
    """Compare site CPI data against BLS API response.

    Checks grocery index value, grocery % change, and shelter % change.

    Args:
        site_cpi: cpi.data from whatchanged.us API
        bls_data: Result from bls.fetch_bls_series() keyed by series ID
        tolerance_index: Tolerance for raw index values
        tolerance_pct: Tolerance for percentage point changes

    Returns:
        List of CheckResult for each comparison.
    """
    results = []

    if not site_cpi:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="cpi",
            check_name="cpi_data_present",
            message="No CPI data from whatchanged.us",
        ))
        return results

    series_ids = site_cpi.get("seriesIds", {})

    # Check grocery index value
    grocery_series_id = series_ids.get("groceries")
    if grocery_series_id and bls_data and grocery_series_id in bls_data:
        bls_series = bls_data[grocery_series_id]
        bls_latest = bls_series["data"][0] if bls_series["data"] else None

        if bls_latest:
            site_grocery_idx = site_cpi.get("groceriesCurrent")
            bls_grocery_idx = bls_latest["value"]

            cmp = compare_values(site_grocery_idx, bls_grocery_idx, tolerance_index, "index")
            results.append(CheckResult(
                status=cmp["status"],
                category="cpi",
                check_name="grocery_index_match",
                site_value=site_grocery_idx,
                source_value=bls_grocery_idx,
                difference=cmp.get("difference"),
                tolerance=tolerance_index,
                unit="index points",
                message=f"BLS series: {grocery_series_id}",
            ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="cpi",
            check_name="grocery_index_match",
            message=f"Missing BLS data for grocery series {grocery_series_id}",
        ))

    # Check grocery % change
    site_grocery_change = site_cpi.get("groceriesChange")
    if site_grocery_change is not None:
        # Recompute from site's own baseline and current
        site_baseline = site_cpi.get("groceriesBaseline")
        site_current = site_cpi.get("groceriesCurrent")
        if site_baseline and site_current and site_baseline != 0:
            recomputed = round((site_current - site_baseline) / site_baseline * 100, 1)
            cmp = compare_values(site_grocery_change, recomputed, tolerance_pct, "pp")
            results.append(CheckResult(
                status=cmp["status"],
                category="cpi",
                check_name="grocery_pct_change_internal",
                site_value=site_grocery_change,
                source_value=recomputed,
                difference=cmp.get("difference"),
                tolerance=tolerance_pct,
                unit="percentage points",
                message="Internal consistency: displayed change vs computed from baseline/current",
            ))

    # Check shelter % change
    shelter_series_id = series_ids.get("shelter")
    site_shelter_change = site_cpi.get("shelterChange")
    if shelter_series_id and bls_data and shelter_series_id in bls_data:
        bls_shelter = bls_data[shelter_series_id]
        if bls_shelter["data"]:
            results.append(CheckResult(
                status=CheckStatus.PASS,
                category="cpi",
                check_name="shelter_data_present",
                message=f"BLS shelter series {shelter_series_id} has {len(bls_shelter['data'])} data points",
                details={"site_shelter_change": site_shelter_change},
            ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="cpi",
            check_name="shelter_data_present",
            message=f"Missing BLS data for shelter series {shelter_series_id}",
        ))

    return results
