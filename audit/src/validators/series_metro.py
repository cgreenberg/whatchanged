"""Verify BLS series IDs map to the correct metro area.

Uses the BLS API v2 catalog metadata (series_name, area fields)
rather than scraping the BLS web UI, which is unreliable.

This is the most critical validator — a wrong area code means
data from the wrong city entirely.
"""

import logging
from typing import Optional
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)


def verify_series_metro_mapping(
    site_data: dict,
    bls_data: Optional[dict],
) -> list[CheckResult]:
    """Verify that BLS series IDs map to the metro area the site claims.

    For each CPI series ID returned by whatchanged.us, check that the
    BLS API's catalog metadata for that series matches the site's
    claimed metro area.

    Args:
        site_data: Full API response from whatchanged.us
        bls_data: Result from bls.fetch_bls_series() with catalog=True

    Returns:
        List of CheckResult (one per series).
    """
    results = []

    cpi_data = site_data.get("cpi", {}).get("data")
    if not cpi_data:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="metro_mapping",
            check_name="series_metro_verification",
            message="No CPI data available to verify",
        ))
        return results

    site_metro = cpi_data.get("metro", "")
    series_ids = cpi_data.get("seriesIds", {})

    if not bls_data:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="metro_mapping",
            check_name="series_metro_verification",
            message="No BLS API data available for verification",
        ))
        return results

    for name, series_id in series_ids.items():
        if series_id not in bls_data:
            results.append(CheckResult(
                status=CheckStatus.SKIP,
                category="metro_mapping",
                check_name=f"metro_match_{name}",
                message=f"Series {series_id} not found in BLS response",
            ))
            continue

        bls_series = bls_data[series_id]
        bls_area = bls_series.get("area_name", "")
        bls_title = bls_series.get("series_name", "")

        # Check if the site's claimed metro appears in the BLS metadata
        # BLS area_name might be "San Francisco-Oakland-Hayward, CA"
        # Site metro might be "San Francisco-Oakland-Hayward"
        match = _metro_names_match(site_metro, bls_area)

        if not match and bls_title:
            # Also check the series title which sometimes contains the area
            match = _metro_names_match(site_metro, bls_title)

        results.append(CheckResult(
            status=CheckStatus.PASS if match else CheckStatus.FAIL,
            category="metro_mapping",
            check_name=f"metro_match_{name}",
            site_value=site_metro,
            source_value=bls_area or bls_title,
            message=(
                f"Series {series_id}: site says '{site_metro}', "
                f"BLS says '{bls_area}'"
            ),
            details={
                "series_id": series_id,
                "bls_area": bls_area,
                "bls_title": bls_title,
                "category": name,
            },
        ))

    return results


def _metro_names_match(site_metro: str, bls_metro: str) -> bool:
    """Check if two metro area names refer to the same place.

    Handles common differences:
    - BLS includes state suffix: "San Francisco-Oakland-Hayward, CA"
    - Site may omit state: "San Francisco-Oakland-Hayward"
    - Case differences
    - Extra whitespace
    """
    if not site_metro or not bls_metro:
        return False

    # Normalize: lowercase, strip whitespace
    site_norm = site_metro.lower().strip()
    bls_norm = bls_metro.lower().strip()

    # Direct match
    if site_norm == bls_norm:
        return True

    # Check if one contains the other (handles state suffix)
    if site_norm in bls_norm or bls_norm in site_norm:
        return True

    # Strip state suffix from BLS name (", XX" or ", XX-YY")
    bls_no_state = bls_norm.rsplit(",", 1)[0].strip()
    if site_norm == bls_no_state:
        return True

    return False
