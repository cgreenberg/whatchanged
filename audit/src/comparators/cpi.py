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
            description="Check for presence of CPI data from whatchanged.us API.",
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
                description="BLS CPI grocery index value from the site vs directly from the BLS API for the same series ID.",
                source_url=f"https://data.bls.gov/timeseries/{grocery_series_id}",
            ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="cpi",
            check_name="grocery_index_match",
            message=f"Missing BLS data for grocery series {grocery_series_id}",
            description="BLS CPI grocery index value from the site vs directly from the BLS API for the same series ID.",
            source_url=f"https://data.bls.gov/timeseries/{grocery_series_id}" if grocery_series_id else "",
        ))

    # Check grocery % change
    site_grocery_change = site_cpi.get("groceriesChange")
    if site_grocery_change is not None:
        # Recompute from site's own baseline and current
        site_baseline = site_cpi.get("groceriesBaseline")
        site_current = site_cpi.get("groceriesCurrent")
        if site_baseline is not None and site_current is not None:
            if site_baseline == 0:
                results.append(CheckResult(
                    status=CheckStatus.FAIL,
                    category="cpi",
                    check_name="grocery_pct_change_internal",
                    message="Grocery baseline is zero — cannot compute % change",
                    description="Internal consistency check failed: grocery baseline index is zero.",
                ))
            else:
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
                    description="Internal consistency: does the displayed grocery % change match (current - baseline) / baseline x 100?",
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
                description="Confirms BLS shelter CPI series has data. The site shows shelter cost % change from this series.",
                source_url=f"https://data.bls.gov/timeseries/{shelter_series_id}",
            ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="cpi",
            check_name="shelter_data_present",
            message=f"Missing BLS data for shelter series {shelter_series_id}",
            description="Confirms BLS shelter CPI series has data. The site shows shelter cost % change from this series.",
            source_url=f"https://data.bls.gov/timeseries/{shelter_series_id}" if shelter_series_id else "",
        ))

    # Verify shelter % change is reasonable
    if site_shelter_change is not None:
        if -20 <= site_shelter_change <= 50:
            results.append(CheckResult(
                status=CheckStatus.PASS,
                category="cpi",
                check_name="shelter_change_reasonable",
                site_value=site_shelter_change,
                message=f"Shelter change {site_shelter_change}% is within reasonable range",
                description="Sanity check: shelter % change is between -20% and +50%.",
            ))
        else:
            results.append(CheckResult(
                status=CheckStatus.FAIL,
                category="cpi",
                check_name="shelter_change_reasonable",
                site_value=site_shelter_change,
                message=f"Shelter change {site_shelter_change}% is outside reasonable range (-20% to +50%)",
                description="Sanity check: shelter % change should be between -20% and +50%.",
            ))

    # Check energy BLS data present
    energy_series_id = series_ids.get("energy")
    if energy_series_id and bls_data and energy_series_id in bls_data:
        bls_energy = bls_data[energy_series_id]
        if bls_energy["data"]:
            results.append(CheckResult(
                status=CheckStatus.PASS,
                category="cpi",
                check_name="energy_data_present",
                message=f"BLS energy series {energy_series_id} has {len(bls_energy['data'])} data points",
                description="Confirms BLS energy CPI series has data. The site shows energy cost % change from this series.",
                source_url=f"https://data.bls.gov/timeseries/{energy_series_id}",
            ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="cpi",
            check_name="energy_data_present",
            message=f"Missing BLS data for energy series {energy_series_id}",
            description="Confirms BLS energy CPI series has data. The site shows energy cost % change from this series.",
            source_url=f"https://data.bls.gov/timeseries/{energy_series_id}" if energy_series_id else "",
        ))

    # Verify energy % change is reasonable (derived from series array)
    # The API does not return a top-level energyChange field, so compute from series points.
    series_points = site_cpi.get("series") or []
    BASELINE_DATE = "2025-01"
    baseline_energy = next(
        (p["energy"] for p in series_points if p.get("date") == BASELINE_DATE and p.get("energy") is not None),
        None,
    )
    latest_energy = next(
        (p["energy"] for p in reversed(series_points) if p.get("energy") is not None),
        None,
    )

    if baseline_energy is not None and latest_energy is not None:
        if baseline_energy == 0:
            results.append(CheckResult(
                status=CheckStatus.FAIL,
                category="cpi",
                check_name="energy_change_reasonable",
                message="Energy baseline index is zero — cannot compute % change",
                description="Sanity check: energy baseline index from the series array is zero.",
            ))
        else:
            energy_change = round((latest_energy - baseline_energy) / baseline_energy * 100, 1)
            if -50 <= energy_change <= 100:
                results.append(CheckResult(
                    status=CheckStatus.PASS,
                    category="cpi",
                    check_name="energy_change_reasonable",
                    site_value=energy_change,
                    message=f"Energy change {energy_change}% is within reasonable range",
                    description="Sanity check: energy % change since Jan 2025 is between -50% and +100%.",
                ))
            else:
                results.append(CheckResult(
                    status=CheckStatus.FAIL,
                    category="cpi",
                    check_name="energy_change_reasonable",
                    site_value=energy_change,
                    message=f"Energy change {energy_change}% is outside reasonable range (-50% to +100%)",
                    description="Sanity check: energy % change should be between -50% and +100%.",
                ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="cpi",
            check_name="energy_change_reasonable",
            message="No energy data points found in series for Jan 2025 baseline or latest value",
            description="Sanity check: energy % change since Jan 2025 is between -50% and +100%.",
        ))

    return results
