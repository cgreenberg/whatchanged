"""Unemployment rate comparison: site vs BLS LAUS (primary)."""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult, compare_values

logger = logging.getLogger(__name__)


def compare_unemployment(
    site_unemp: dict,
    bls_data: dict | None,
    tolerance: float = 0.005,
) -> list[CheckResult]:
    """Compare site unemployment rate against BLS LAUS.

    Args:
        site_unemp: unemployment.data from whatchanged.us API
        bls_data: Result from bls.fetch_bls_series() for the LAUS series
        tolerance: Acceptable difference (0.0 = exact match)

    Returns:
        List of CheckResult.
    """
    results = []

    if not site_unemp:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="unemployment",
            check_name="unemployment_data_present",
            message="No unemployment data from whatchanged.us",
            description="Check for presence of unemployment data from whatchanged.us API.",
        ))
        return results

    series_id = site_unemp.get("seriesId")
    site_rate = site_unemp.get("current")

    if not series_id or not bls_data or series_id not in bls_data:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="unemployment",
            check_name="bls_laus_match",
            message=f"Missing BLS data for series {series_id}",
            description="Unemployment rate from whatchanged.us vs directly from BLS LAUS (Local Area Unemployment Statistics) for the same county.",
            source_url=f"https://data.bls.gov/timeseries/{series_id}" if series_id else "",
        ))
        return results

    bls_series = bls_data[series_id]
    bls_latest = bls_series["data"][0] if bls_series["data"] else None

    if bls_latest:
        bls_rate = bls_latest["value"]
        cmp = compare_values(site_rate, bls_rate, tolerance, "%")

        results.append(CheckResult(
            status=cmp["status"],
            category="unemployment",
            check_name="bls_laus_match",
            site_value=site_rate,
            source_value=bls_rate,
            difference=cmp.get("difference"),
            tolerance=tolerance,
            unit="percentage points",
            message=f"County FIPS: {site_unemp.get('countyFips')}, Series: {series_id}",
            details={
                "bls_period": f"{bls_latest['year']}-{bls_latest['period']}",
                "area_name": bls_series.get("area_name", ""),
            },
            description="Unemployment rate from whatchanged.us vs directly from BLS LAUS (Local Area Unemployment Statistics) for the same county.",
            source_url=f"https://data.bls.gov/timeseries/{series_id}",
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="unemployment",
            check_name="bls_laus_match",
            message="No data points in BLS LAUS series",
            description="Unemployment rate from whatchanged.us vs directly from BLS LAUS (Local Area Unemployment Statistics) for the same county.",
            source_url=f"https://data.bls.gov/timeseries/{series_id}",
        ))

    return results
