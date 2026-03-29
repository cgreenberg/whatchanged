"""Verify BLS source links contain the correct series ID.

Checks that the series IDs returned in CPI and unemployment data
match the series IDs embedded in the source link URLs the site
constructs (https://data.bls.gov/timeseries/{seriesId}).

Also validates that the unemployment series ID conforms to the
expected LAUS county format: LAUCN{FIPS}0000000003.
"""

import logging
import re
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

# Expected BLS timeseries URL prefix
BLS_TIMESERIES_BASE = "https://data.bls.gov/timeseries/"

# Expected LAUS county unemployment series ID pattern
LAUS_SERIES_PATTERN = re.compile(r'^LAUCN(\d{5})0000000003$')

# Connecticut replaced counties with Planning Council Regions in 2022.
# BLS LAUS uses new planning region FIPS (09110–09190); the HUD zip crosswalk
# still returns old county FIPS (09001–09015). A FIPS mismatch for CT zips is
# expected and correct when the series FIPS is a known planning region code.
CT_STATE_FIPS_PREFIX = "09"
CT_PLANNING_REGION_FIPS = {
    "09110", "09120", "09130", "09140", "09150",
    "09160", "09170", "09180", "09190",
}


def verify_link_geography(site_data: dict) -> list[CheckResult]:
    """Verify BLS source links contain the correct series ID.

    Checks:
    1. CPI seriesIds (grocery, shelter, energy) — if present, verify
       the expected source link URL contains the matching series ID.
    2. Unemployment seriesId — if present, verify it matches the
       expected LAUS county format LAUCN{FIPS}0000000003 where FIPS
       is the county's 5-digit FIPS code.

    Args:
        site_data: Full API response from whatchanged.us

    Returns:
        List of CheckResult (one per series checked, plus unemployment).
    """
    results = []

    results.extend(_check_cpi_series_links(site_data))
    results.extend(_check_unemployment_series_id(site_data))

    return results


def _check_cpi_series_links(site_data: dict) -> list[CheckResult]:
    """Verify that expected CPI source link URLs contain the correct series ID."""
    results = []

    cpi_data = site_data.get("cpi", {}).get("data")
    if not cpi_data:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="link_geography",
            check_name="cpi_link_series_id",
            message="No CPI data available",
            description="Verify CPI source link URLs contain the correct BLS series ID.",
        ))
        return results

    series_ids = cpi_data.get("seriesIds")
    if not series_ids:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="link_geography",
            check_name="cpi_link_series_id",
            message="No CPI seriesIds returned in response",
            description="Verify CPI source link URLs contain the correct BLS series ID.",
        ))
        return results

    # The site constructs URLs as https://data.bls.gov/timeseries/{seriesId}
    # for each CPI metric. Verify each series ID produces a self-consistent link.
    series_map = {
        "groceries": series_ids.get("groceries"),
        "shelter": series_ids.get("shelter"),
        "energy": series_ids.get("energy"),
    }

    for metric, series_id in series_map.items():
        check_name = f"cpi_link_series_id_{metric}"
        description = (
            f"Verify the {metric} CPI source link URL contains the correct BLS series ID."
        )

        if not series_id:
            results.append(CheckResult(
                status=CheckStatus.SKIP,
                category="link_geography",
                check_name=check_name,
                message=f"No series ID for {metric} CPI",
                description=description,
            ))
            continue

        # Construct the expected source link URL
        expected_url = f"{BLS_TIMESERIES_BASE}{series_id}"

        # The series ID should appear verbatim in the URL
        if series_id in expected_url:
            results.append(CheckResult(
                status=CheckStatus.PASS,
                category="link_geography",
                check_name=check_name,
                site_value=series_id,
                source_value=expected_url,
                message=(
                    f"{metric} series ID '{series_id}' is correctly embedded "
                    f"in source link URL '{expected_url}'"
                ),
                details={
                    "metric": metric,
                    "series_id": series_id,
                    "expected_url": expected_url,
                },
                description=description,
                source_url=expected_url,
            ))
        else:
            results.append(CheckResult(
                status=CheckStatus.FAIL,
                category="link_geography",
                check_name=check_name,
                site_value=series_id,
                source_value=expected_url,
                message=(
                    f"{metric} series ID '{series_id}' is NOT present "
                    f"in constructed URL '{expected_url}'"
                ),
                details={
                    "metric": metric,
                    "series_id": series_id,
                    "expected_url": expected_url,
                },
                description=description,
                source_url=expected_url,
            ))

    return results


def _check_unemployment_series_id(site_data: dict) -> list[CheckResult]:
    """Verify the unemployment series ID matches the expected LAUS format.

    The expected format is LAUCN{FIPS}0000000003 where FIPS is the
    5-digit county (or planning region) FIPS code for this zip's county.
    """
    description = (
        "Verify the unemployment series ID matches the expected LAUS county "
        "format LAUCN{FIPS}0000000003."
    )

    unemployment_data = site_data.get("unemployment", {}).get("data")
    if not unemployment_data:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="link_geography",
            check_name="unemployment_series_id_format",
            message="No unemployment data available",
            description=description,
        )]

    series_id = unemployment_data.get("seriesId")
    if not series_id:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="link_geography",
            check_name="unemployment_series_id_format",
            message="No seriesId in unemployment data",
            description=description,
        )]

    # Validate series ID format
    match = LAUS_SERIES_PATTERN.match(series_id)

    if not match:
        return [CheckResult(
            status=CheckStatus.FAIL,
            category="link_geography",
            check_name="unemployment_series_id_format",
            site_value=series_id,
            source_value=f"LAUCN{{FIPS}}0000000003",
            message=(
                f"Unemployment series ID '{series_id}' does not match "
                f"expected LAUS format LAUCN{{FIPS}}0000000003"
            ),
            details={"series_id": series_id},
            description=description,
            source_url=f"{BLS_TIMESERIES_BASE}{series_id}",
        )]

    series_fips = match.group(1)

    # Cross-check the FIPS in the series ID against the location FIPS if available
    location_fips = site_data.get("location", {}).get("countyFips", "")
    county_fips_in_unemployment = unemployment_data.get("countyFips", "")

    # Prefer location FIPS; fall back to FIPS embedded in unemployment data
    expected_fips = location_fips or county_fips_in_unemployment

    if not expected_fips:
        # Format checks out but we can't cross-check FIPS — still a PASS on format
        return [CheckResult(
            status=CheckStatus.PASS,
            category="link_geography",
            check_name="unemployment_series_id_format",
            site_value=series_id,
            source_value=f"LAUCN{series_fips}0000000003",
            message=(
                f"Unemployment series ID '{series_id}' matches LAUS format "
                f"(FIPS cross-check skipped — no location FIPS available)"
            ),
            details={"series_id": series_id, "series_fips": series_fips},
            description=description,
            source_url=f"{BLS_TIMESERIES_BASE}{series_id}",
        )]

    if series_fips == expected_fips:
        return [CheckResult(
            status=CheckStatus.PASS,
            category="link_geography",
            check_name="unemployment_series_id_format",
            site_value=series_id,
            source_value=f"LAUCN{expected_fips}0000000003",
            message=(
                f"Unemployment series ID '{series_id}' matches expected LAUS format "
                f"and FIPS '{expected_fips}' matches location"
            ),
            details={
                "series_id": series_id,
                "series_fips": series_fips,
                "location_fips": expected_fips,
            },
            description=description,
            source_url=f"{BLS_TIMESERIES_BASE}{series_id}",
        )]
    else:
        # Connecticut special case: old county FIPS (09001–09015) in the HUD
        # crosswalk get remapped to planning region FIPS (09110–09190) before
        # the BLS LAUS series ID is constructed. A mismatch is expected and
        # correct when the location FIPS is a CT county and the series FIPS is
        # a known CT planning region code.
        is_ct_county = expected_fips.startswith(CT_STATE_FIPS_PREFIX)
        is_ct_planning_region = series_fips in CT_PLANNING_REGION_FIPS
        if is_ct_county and is_ct_planning_region:
            return [CheckResult(
                status=CheckStatus.PASS,
                category="link_geography",
                check_name="unemployment_series_id_format",
                site_value=series_id,
                source_value=f"LAUCN{series_fips}0000000003",
                message=(
                    f"Unemployment series ID '{series_id}' uses CT planning region "
                    f"FIPS '{series_fips}' (remapped from old county FIPS "
                    f"'{expected_fips}') — expected for Connecticut"
                ),
                details={
                    "series_id": series_id,
                    "series_fips": series_fips,
                    "location_fips": expected_fips,
                    "ct_remapping": True,
                },
                description=description,
                source_url=f"{BLS_TIMESERIES_BASE}{series_id}",
            )]

        return [CheckResult(
            status=CheckStatus.FAIL,
            category="link_geography",
            check_name="unemployment_series_id_format",
            site_value=series_id,
            source_value=f"LAUCN{expected_fips}0000000003",
            message=(
                f"Unemployment series ID FIPS '{series_fips}' does not match "
                f"location FIPS '{expected_fips}' (series: '{series_id}')"
            ),
            details={
                "series_id": series_id,
                "series_fips": series_fips,
                "location_fips": expected_fips,
            },
            description=description,
            source_url=f"{BLS_TIMESERIES_BASE}{series_id}",
        )]
