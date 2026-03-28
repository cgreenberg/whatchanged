"""Validate gas price geographic assignments against EIA PAD district and city boundaries.

Checks that a zip code's gas price comes from a geographically appropriate
EIA region. The site resolves gas prices through a 4-tier hierarchy:
city/county override → state-level series → PAD district → national avg.

This validator does not re-run that hierarchy — it checks the result for
geographic plausibility using the geoLevel and duoarea fields returned
in the API response.
"""

import logging
from typing import Optional
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

# Maps EIA PAD sub-district / district IDs to their member state abbreviations.
# PAD 1 is split into sub-districts; PADs 2-5 are not.
PAD_STATES = {
    '1A': {'CT', 'ME', 'MA', 'NH', 'RI', 'VT'},              # New England
    '1B': {'DE', 'DC', 'MD', 'NJ', 'NY', 'PA'},               # Central Atlantic
    '1C': {'FL', 'GA', 'NC', 'SC', 'VA', 'WV'},               # Lower Atlantic
    '2':  {'IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MN', 'MO',   # Midwest
           'ND', 'NE', 'OH', 'OK', 'SD', 'TN', 'WI'},
    '3':  {'AL', 'AR', 'LA', 'MS', 'NM', 'TX'},               # Gulf Coast
    '4':  {'CO', 'ID', 'MT', 'UT', 'WY'},                     # Rocky Mountain
    '5':  {'AK', 'AZ', 'CA', 'HI', 'NV', 'OR', 'WA'},        # West Coast
}

# Maps lowercase keywords found in EIA city-level geoLevel strings to the
# set of states those cities plausibly serve. Used for Tier-1 city assignments.
EIA_CITY_STATES = {
    'boston':        {'MA'},
    'new york':      {'NY', 'NJ', 'CT'},
    'miami':         {'FL'},
    'chicago':       {'IL', 'IN', 'WI'},
    'cleveland':     {'OH'},
    'houston':       {'TX'},
    'denver':        {'CO'},
    'los angeles':   {'CA'},
    'san francisco': {'CA'},
    'seattle':       {'WA'},
}

# States that have their own EIA state-level gas data series (Tier 2).
# When geoLevel says "<State Name> state avg", only these states legitimately
# get a state-level series rather than a PAD district fallback.
STATE_LEVEL_STATES = {'CA', 'CO', 'FL', 'MA', 'MN', 'NY', 'OH', 'TX', 'WA'}


def verify_gas_region_appropriate(site_data: dict) -> list[CheckResult]:
    """Check that a zip's gas price comes from a geographically appropriate EIA region.

    Reads the geoLevel field from the gas data in the API response and
    verifies it is consistent with the zip's state:

    - National avg → always valid (PASS)
    - State avg     → PASS (state-level data is inherently correct for that state)
    - PADD X / 1A / 1B / 1C → state must be in PAD_STATES[pad_key]
    - City area avg → state must be in EIA_CITY_STATES[city_keyword]
    - Unknown format → WARN (cannot verify)

    Args:
        site_data: Full API response from whatchanged.us, containing at minimum
                   site_data["gas"]["data"]["geoLevel"] and
                   site_data["location"]["stateAbbr"].

    Returns:
        A list containing one CheckResult.
    """
    description = (
        "Verify gas price data comes from an EIA region that is geographically "
        "appropriate for the zip's state. A wrong region (e.g. Midwest PAD for a "
        "West Coast zip) means systematically incorrect prices."
    )

    gas_data = site_data.get("gas", {}).get("data")
    state_abbr = site_data.get("location", {}).get("stateAbbr")

    if not gas_data or not state_abbr:
        logger.debug(
            "Skipping gas_region_appropriate: gas_data=%s state_abbr=%s",
            bool(gas_data), state_abbr,
        )
        return [CheckResult(
            status=CheckStatus.SKIP,
            category="geo_mapping",
            check_name="gas_region_appropriate",
            message="Missing gas data or state information — cannot verify region",
            description=description,
        )]

    geo_level = gas_data.get("geoLevel", "")
    state_upper = state_abbr.upper()
    geo_lower = geo_level.lower()

    logger.debug(
        "Checking gas region: state=%s geoLevel=%r duoarea=%s tier=%s",
        state_upper,
        geo_level,
        gas_data.get("duoarea"),
        gas_data.get("tier"),
    )

    # --- National avg: valid for any state ---
    if "national" in geo_lower:
        return [CheckResult(
            status=CheckStatus.PASS,
            category="geo_mapping",
            check_name="gas_region_appropriate",
            site_value=geo_level,
            source_value="National (any state)",
            message=f"National gas avg is valid for state {state_upper}",
            details={"state": state_upper, "geoLevel": geo_level},
            description=description,
        )]

    # --- State avg: inherently correct for the state being served ---
    if "state avg" in geo_lower:
        return [CheckResult(
            status=CheckStatus.PASS,
            category="geo_mapping",
            check_name="gas_region_appropriate",
            site_value=geo_level,
            source_value=f"{state_upper} state avg",
            message=f"State-level gas avg is appropriate for state {state_upper}",
            details={"state": state_upper, "geoLevel": geo_level},
            description=description,
        )]

    # --- PADD district: verify state membership ---
    if "padd" in geo_lower:
        pad_key = _extract_pad_key(geo_level)
        if pad_key is None:
            logger.warning("Could not parse PADD key from geoLevel=%r", geo_level)
            return [CheckResult(
                status=CheckStatus.WARN,
                category="geo_mapping",
                check_name="gas_region_appropriate",
                site_value=geo_level,
                source_value=None,
                message=f"Could not parse PADD district from geoLevel '{geo_level}' — cannot verify",
                details={"state": state_upper, "geoLevel": geo_level},
                description=description,
            )]

        if pad_key not in PAD_STATES:
            logger.warning("Unknown PAD key %r extracted from geoLevel=%r", pad_key, geo_level)
            return [CheckResult(
                status=CheckStatus.WARN,
                category="geo_mapping",
                check_name="gas_region_appropriate",
                site_value=geo_level,
                source_value=None,
                message=f"Unknown PADD key '{pad_key}' from geoLevel '{geo_level}' — cannot verify",
                details={"state": state_upper, "geoLevel": geo_level, "pad_key": pad_key},
                description=description,
            )]

        expected_states = PAD_STATES[pad_key]
        if state_upper in expected_states:
            return [CheckResult(
                status=CheckStatus.PASS,
                category="geo_mapping",
                check_name="gas_region_appropriate",
                site_value=geo_level,
                source_value=f"PADD {pad_key} states",
                message=f"State {state_upper} correctly assigned to PADD {pad_key} ({geo_level})",
                details={
                    "state": state_upper,
                    "geoLevel": geo_level,
                    "pad_key": pad_key,
                },
                description=description,
            )]
        else:
            return [CheckResult(
                status=CheckStatus.FAIL,
                category="geo_mapping",
                check_name="gas_region_appropriate",
                site_value=geo_level,
                source_value=f"PADD {pad_key} states",
                message=(
                    f"State {state_upper} is NOT in PADD {pad_key} — "
                    f"expected one of {sorted(expected_states)}"
                ),
                details={
                    "state": state_upper,
                    "geoLevel": geo_level,
                    "pad_key": pad_key,
                    "expected_states": sorted(expected_states),
                },
                description=description,
            )]

    # --- City-level avg: verify state is plausible for that city ---
    if "area avg" in geo_lower:
        matched_city = None
        for city_key in EIA_CITY_STATES:
            if city_key in geo_lower:
                matched_city = city_key
                break

        if matched_city is None:
            logger.warning(
                "Unrecognized city in geoLevel=%r for state=%s", geo_level, state_upper
            )
            return [CheckResult(
                status=CheckStatus.WARN,
                category="geo_mapping",
                check_name="gas_region_appropriate",
                site_value=geo_level,
                source_value=None,
                message=f"Unknown city area '{geo_level}' — cannot verify state appropriateness",
                details={"state": state_upper, "geoLevel": geo_level},
                description=description,
            )]

        allowed_states = EIA_CITY_STATES[matched_city]
        if state_upper in allowed_states:
            return [CheckResult(
                status=CheckStatus.PASS,
                category="geo_mapping",
                check_name="gas_region_appropriate",
                site_value=geo_level,
                source_value=f"{matched_city.title()} area states",
                message=f"State {state_upper} is plausible for '{geo_level}'",
                details={
                    "state": state_upper,
                    "geoLevel": geo_level,
                    "matched_city": matched_city,
                },
                description=description,
            )]
        else:
            return [CheckResult(
                status=CheckStatus.FAIL,
                category="geo_mapping",
                check_name="gas_region_appropriate",
                site_value=geo_level,
                source_value=f"{matched_city.title()} area states",
                message=(
                    f"State {state_upper} is NOT plausible for city area '{geo_level}' "
                    f"(allowed: {sorted(allowed_states)})"
                ),
                details={
                    "state": state_upper,
                    "geoLevel": geo_level,
                    "matched_city": matched_city,
                    "allowed_states": sorted(allowed_states),
                },
                description=description,
            )]

    # --- Unknown geoLevel format ---
    logger.warning(
        "Unrecognized geoLevel format=%r for state=%s — cannot verify", geo_level, state_upper
    )
    return [CheckResult(
        status=CheckStatus.WARN,
        category="geo_mapping",
        check_name="gas_region_appropriate",
        site_value=geo_level,
        source_value=None,
        message=f"Unrecognized geoLevel format '{geo_level}' — cannot verify region appropriateness",
        details={"state": state_upper, "geoLevel": geo_level},
        description=description,
    )]


def _extract_pad_key(geo_level: str) -> Optional[str]:
    """Extract the PAD district key from a geoLevel string.

    Examples:
        "Midwest (PADD 2) avg"  → "2"
        "PADD 1A avg"           → "1A"
        "PADD 1B avg"           → "1B"
        "PADD 1C avg"           → "1C"
        "East Coast (PADD 1) avg" → "1"  (parent district — rare, treated as unknown)

    Returns:
        The PAD key string if parseable, or None if the format is unrecognized.
    """
    import re

    # Match "PADD 1A", "PADD 1B", "PADD 1C", "PADD 2" … "PADD 5"
    # Parenthetical form: "(PADD 2)" or "(PADD 1A)"
    match = re.search(r'PADD\s+([1-5][ABC]?)', geo_level, re.IGNORECASE)
    if match:
        raw = match.group(1).upper()
        # Normalize: "1" alone (parent PAD 1) has no sub-district mapping —
        # return it so the caller can emit WARN for an unknown key.
        return raw

    return None
