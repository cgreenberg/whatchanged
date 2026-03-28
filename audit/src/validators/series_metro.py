"""Verify BLS series IDs map to the correct metro area.

Uses the BLS API v2 catalog metadata (series_name, area fields)
rather than scraping the BLS web UI, which is unreliable.

This is the most critical validator — a wrong area code means
data from the wrong city entirely.

Also handles regional CPI awareness: the site returns metro values
like "Northeast Urban", "Midwest Urban", etc. for non-metro counties.
BLS catalog metadata uses "Northeast" or "Northeast urban" for these
series. The validators here handle matching and appropriateness checks
for both metro and regional CPI assignments.
"""

import logging
from typing import Optional
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

REGIONAL_ALIASES = {
    'northeast urban': ['northeast', 'northeast urban'],
    'midwest urban': ['midwest', 'midwest urban'],
    'south urban': ['south', 'south urban'],
    'west urban': ['west', 'west urban'],
}

CENSUS_REGIONS = {
    'northeast': {'CT', 'ME', 'MA', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'},
    'midwest': {'IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'},
    'south': {'AL', 'AR', 'DE', 'DC', 'FL', 'GA', 'KY', 'LA', 'MD', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA', 'WV'},
    'west': {'AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NV', 'NM', 'OR', 'UT', 'WA', 'WY'},
}

CPI_METRO_STATES = {
    'boston': {'MA', 'NH'},
    'new york': {'NY', 'NJ', 'CT', 'PA'},
    'philadelphia': {'PA', 'NJ', 'DE', 'MD'},
    'chicago': {'IL', 'IN', 'WI'},
    'detroit': {'MI'},
    'minneapolis': {'MN', 'WI'},
    'st. louis': {'MO', 'IL'},
    'washington': {'DC', 'VA', 'MD', 'WV'},
    'miami': {'FL'},
    'atlanta': {'GA'},
    'tampa': {'FL'},
    'baltimore': {'MD'},
    'dallas': {'TX'},
    'houston': {'TX'},
    'phoenix': {'AZ'},
    'denver': {'CO'},
    'los angeles': {'CA'},
    'san francisco': {'CA'},
    'riverside': {'CA'},
    'seattle': {'WA'},
    'san diego': {'CA'},
    'honolulu': {'HI'},
    'anchorage': {'AK'},
}


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
            description="Verify BLS series IDs actually map to the metro area the site claims. A mismatch means data from the wrong city.",
        ))
        return results

    site_metro = cpi_data.get("metro", "")
    series_ids = cpi_data.get("seriesIds", {})

    # Dynamic description based on whether this is a regional or metro CPI
    is_regional = "Urban" in site_metro
    if is_regional:
        mismatch_msg = "A mismatch means data from the wrong region."
    else:
        mismatch_msg = "A mismatch means data from the wrong city."

    if not bls_data:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="metro_mapping",
            check_name="series_metro_verification",
            message="No BLS API data available for verification",
            description=f"Verify BLS series IDs actually map to the metro area the site claims. {mismatch_msg}",
        ))
        return results

    for name, series_id in series_ids.items():
        description = f"Verify BLS series {series_id} actually maps to the metro area the site claims ('{site_metro}'). {mismatch_msg}"

        if series_id not in bls_data:
            results.append(CheckResult(
                status=CheckStatus.SKIP,
                category="metro_mapping",
                check_name=f"metro_match_{name}",
                message=f"Series {series_id} not found in BLS response",
                description=description,
                source_url=f"https://data.bls.gov/timeseries/{series_id}",
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
            description=description,
            source_url=f"https://data.bls.gov/timeseries/{series_id}",
        ))

    return results


def verify_cpi_region_appropriate(site_data: dict) -> list[CheckResult]:
    """Verify that a regional CPI assignment is correct for the zip's state.

    For regional CPI (where metro contains "Urban"), checks that the
    zip's state belongs to the correct Census region.

    Args:
        site_data: Full API response from whatchanged.us

    Returns:
        List with one CheckResult.
    """
    cpi_data = site_data.get("cpi", {}).get("data")
    if not cpi_data:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="geo_mapping",
            check_name="cpi_region_appropriate",
            message="No CPI data available to verify",
            description="Verify regional CPI assignment matches the zip's Census region.",
        )]

    site_metro = cpi_data.get("metro", "")

    # Only applies to regional CPI (e.g. "Northeast Urban", "South Urban")
    if "Urban" not in site_metro:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="geo_mapping",
            check_name="cpi_region_appropriate",
            message=f"Not a regional CPI assignment (metro='{site_metro}')",
            description="Verify regional CPI assignment matches the zip's Census region.",
        )]

    state_abbr = site_data.get("location", {}).get("stateAbbr", "")
    if not state_abbr:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="geo_mapping",
            check_name="cpi_region_appropriate",
            message="No state info available to verify region assignment",
            description="Verify regional CPI assignment matches the zip's Census region.",
        )]

    # Extract region name from metro string: "Northeast Urban" → "northeast"
    region_name = site_metro.lower().replace(" urban", "").strip()

    if region_name not in CENSUS_REGIONS:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="geo_mapping",
            check_name="cpi_region_appropriate",
            message=f"Unknown region name '{region_name}' extracted from metro '{site_metro}'",
            description="Verify regional CPI assignment matches the zip's Census region.",
        )]

    expected_states = CENSUS_REGIONS[region_name]
    state_upper = state_abbr.upper()

    if state_upper in expected_states:
        return [CheckResult(
            status=CheckStatus.PASS,
            category="geo_mapping",
            check_name="cpi_region_appropriate",
            site_value=site_metro,
            source_value=f"{region_name.title()} region states",
            message=f"State {state_upper} correctly assigned to {site_metro} CPI region",
            details={"state": state_upper, "region": region_name, "metro": site_metro},
            description="Verify regional CPI assignment matches the zip's Census region.",
        )]
    else:
        return [CheckResult(
            status=CheckStatus.FAIL,
            category="geo_mapping",
            check_name="cpi_region_appropriate",
            site_value=site_metro,
            source_value=f"{region_name.title()} region states",
            message=f"State {state_upper} does NOT belong to {site_metro} CPI region",
            details={"state": state_upper, "region": region_name, "metro": site_metro, "expected_states": sorted(expected_states)},
            description="Verify regional CPI assignment matches the zip's Census region.",
        )]


def verify_metro_state_appropriate(site_data: dict) -> list[CheckResult]:
    """Verify that a metro CPI assignment is plausible for the zip's state.

    For metro CPI (where metro does NOT contain "Urban" and is not "National"),
    checks that the zip's state is plausible for the claimed metro area.

    Args:
        site_data: Full API response from whatchanged.us

    Returns:
        List with one CheckResult.
    """
    cpi_data = site_data.get("cpi", {}).get("data")
    if not cpi_data:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="geo_mapping",
            check_name="metro_state_appropriate",
            message="No CPI data available to verify",
            description="Verify metro CPI assignment is plausible for the zip's state.",
        )]

    site_metro = cpi_data.get("metro", "")

    # Skip regional CPI
    if "Urban" in site_metro:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="geo_mapping",
            check_name="metro_state_appropriate",
            message=f"Regional CPI — use verify_cpi_region_appropriate instead (metro='{site_metro}')",
            description="Verify metro CPI assignment is plausible for the zip's state.",
        )]

    # Skip national CPI
    site_norm = site_metro.lower().strip()
    national_aliases = {"national", "u.s. city average", "us city average"}
    if site_norm in national_aliases:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="geo_mapping",
            check_name="metro_state_appropriate",
            message=f"National CPI — no state check needed (metro='{site_metro}')",
            description="Verify metro CPI assignment is plausible for the zip's state.",
        )]

    state_abbr = site_data.get("location", {}).get("stateAbbr", "")
    if not state_abbr:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="geo_mapping",
            check_name="metro_state_appropriate",
            message="No state info available to verify metro assignment",
            description="Verify metro CPI assignment is plausible for the zip's state.",
        )]

    state_upper = state_abbr.upper()
    metro_lower = site_metro.lower()

    # Find matching CPI metro key
    matched_key = None
    for key in CPI_METRO_STATES:
        if key in metro_lower:
            matched_key = key
            break

    if matched_key is None:
        return [CheckResult(
            status=CheckStatus.WARN,
            category="geo_mapping",
            check_name="metro_state_appropriate",
            site_value=site_metro,
            source_value="unknown",
            message=f"Unknown metro '{site_metro}' — cannot verify state appropriateness",
            details={"state": state_upper, "metro": site_metro},
            description="Verify metro CPI assignment is plausible for the zip's state.",
        )]

    allowed_states = CPI_METRO_STATES[matched_key]

    if state_upper in allowed_states:
        return [CheckResult(
            status=CheckStatus.PASS,
            category="geo_mapping",
            check_name="metro_state_appropriate",
            site_value=site_metro,
            source_value=f"{matched_key.title()} metro states",
            message=f"State {state_upper} is plausible for metro '{site_metro}'",
            details={"state": state_upper, "metro": site_metro, "matched_key": matched_key},
            description="Verify metro CPI assignment is plausible for the zip's state.",
        )]
    else:
        return [CheckResult(
            status=CheckStatus.FAIL,
            category="geo_mapping",
            check_name="metro_state_appropriate",
            site_value=site_metro,
            source_value=f"{matched_key.title()} metro states",
            message=f"State {state_upper} is NOT plausible for metro '{site_metro}' (allowed: {sorted(allowed_states)})",
            details={"state": state_upper, "metro": site_metro, "matched_key": matched_key, "allowed_states": sorted(allowed_states)},
            description="Verify metro CPI assignment is plausible for the zip's state.",
        )]


def _metro_names_match(site_metro: str, bls_metro: str) -> bool:
    """Check if two metro area names refer to the same place.

    Handles common differences:
    - BLS includes state suffix: "San Francisco-Oakland-Hayward, CA"
    - Site may omit state: "San Francisco-Oakland-Hayward"
    - Case differences
    - Extra whitespace
    - Regional CPI: site says "Northeast Urban", BLS says "Northeast" or "Northeast urban"

    Uses primary city comparison to avoid false positives like
    "Portland" matching both "Portland-South Portland, ME" and
    "Portland-Vancouver-Hillsboro, OR-WA".
    """
    if not site_metro or not bls_metro:
        return False

    site_norm = site_metro.lower().strip()
    bls_norm = bls_metro.lower().strip()

    # "National" and "U.S. city average" are the same (national CPI series)
    national_aliases = {"national", "u.s. city average", "us city average"}
    if site_norm in national_aliases and bls_norm in national_aliases:
        return True

    # Regional CPI areas
    if site_norm in REGIONAL_ALIASES:
        return bls_norm in REGIONAL_ALIASES[site_norm]

    # Direct match
    if site_norm == bls_norm:
        return True

    # Strip state suffix from BLS name (", XX" or ", XX-YY")
    bls_no_state = bls_norm.rsplit(",", 1)[0].strip()
    site_no_state = site_norm.rsplit(",", 1)[0].strip()

    if site_no_state == bls_no_state:
        return True

    # Compare the primary city (first component before "-")
    site_primary = site_no_state.split("-")[0].strip()
    bls_primary = bls_no_state.split("-")[0].strip()

    if site_primary and bls_primary and site_primary == bls_primary:
        # Primary cities match — but verify they're in the same state if state info available
        site_state = _extract_state(site_metro)
        bls_state = _extract_state(bls_metro)
        if site_state and bls_state:
            return site_state == bls_state
        # No state info to disambiguate — still likely correct
        return True

    return False


def _extract_state(metro_name: str) -> str:
    """Extract state abbreviation from metro name like 'Portland-Vancouver, OR-WA'."""
    import re
    m = re.search(r',\s*([A-Z]{2})', metro_name)
    return m.group(1).lower() if m else ""
