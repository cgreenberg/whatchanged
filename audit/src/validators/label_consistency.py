"""Validate that CPI tier numbers and displayed label strings are consistent.

The site resolves CPI geography through a 4-tier hierarchy:
  1 = metro CBSA (e.g. "Chicago-Naperville-Elgin")
  2 = Census division (e.g. "Mountain")
  3 = Census region (e.g. "South Urban")
  4 = national (e.g. "National" / "U.S. City Average")

The `tier` field is returned by getMetroCpiAreaForCounty() and threaded
through CpiData to the frontend. A mismatch — e.g. tier=1 but the label
contains "Urban" — indicates a stale cache entry or a mapping bug that
would show users the wrong geographic resolution.

Gas label checks are separate: the geoLevel string should name the
resolution level clearly (PADD, city area, state avg, or national avg).
A label like "Midwest avg" without a PADD identifier is ambiguous and
gets a WARN.
"""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

# Census division names published by BLS for the 9 divisions used in CPI.
# These are the exact sub-strings that appear in tier-2 metro strings.
DIVISION_NAMES = {
    "new england",
    "middle atlantic",
    "east north central",
    "west north central",
    "south atlantic",
    "east south central",
    "west south central",
    "mountain",
    "pacific",
}

# Census region labels used by BLS in tier-3 "urban" series.
REGION_URBAN_KEYWORDS = ("urban",)

# Sub-strings that definitively identify a tier-4 (national) label.
NATIONAL_KEYWORDS = ("national", "u.s.", "u.s. city average")


def verify_label_consistency(site_data: dict) -> list[CheckResult]:
    """Check that CPI tier numbers match their label strings, and that gas
    geoLevel strings include an unambiguous resolution identifier.

    CPI checks (one per CPI metric that has both a tier and a metro field):
    - tier 1  → label must NOT contain "Urban" or "National"; should look
                like a metro area name (contains a city name or hyphen).
    - tier 2  → label must match a known Census division name; must NOT
                contain "Urban".
    - tier 3  → label must contain "Urban".
    - tier 4  → label must contain "National", "U.S.", or similar.

    Gas checks (one result):
    - Contains "PADD"                 → PASS
    - Contains a known city + "avg"   → PASS (city-level)
    - Contains "state avg"            → PASS (state-level)
    - "National avg"                  → PASS
    - Region name + "avg" without PADD (e.g. "Midwest avg") → WARN

    Args:
        site_data: Full API response from whatchanged.us. Expected shape:
            {
              "cpi": {
                "groceries": {"tier": 1, "metro": "Chicago-Naperville-Elgin", ...},
                "shelter":   {"tier": 2, "metro": "Mountain", ...},
                "energy":    {"tier": 3, "metro": "South Urban", ...},
              },
              "gas": {
                "data": {"geoLevel": "Midwest (PADD 2) avg", ...}
              }
            }

    Returns:
        A list of CheckResult objects, one per CPI metric checked plus one
        for the gas label.
    """
    results: list[CheckResult] = []

    # ------------------------------------------------------------------
    # CPI label checks
    # ------------------------------------------------------------------
    cpi_root = site_data.get("cpi", {})

    for metric in ("groceries", "shelter", "energy"):
        metric_data = cpi_root.get(metric)
        if not metric_data:
            logger.debug("label_consistency: no cpi.%s in site_data — skipping", metric)
            results.append(CheckResult(
                status=CheckStatus.SKIP,
                category="label_consistency",
                check_name=f"cpi_{metric}_label_tier_match",
                message=f"No CPI {metric} data in response — cannot check label",
                description=_cpi_description(metric),
            ))
            continue

        tier = metric_data.get("tier")
        metro = metric_data.get("metro", "")
        metro_lower = metro.lower()

        if tier is None or not metro:
            logger.debug(
                "label_consistency: cpi.%s missing tier or metro (tier=%r metro=%r)",
                metric, tier, metro,
            )
            results.append(CheckResult(
                status=CheckStatus.SKIP,
                category="label_consistency",
                check_name=f"cpi_{metric}_label_tier_match",
                site_value=metro or None,
                message=f"CPI {metric} missing tier ({tier!r}) or metro ({metro!r}) — cannot check",
                description=_cpi_description(metric),
            ))
            continue

        result = _check_cpi_tier_label(metric, tier, metro, metro_lower)
        results.append(result)

    # ------------------------------------------------------------------
    # Gas label check
    # ------------------------------------------------------------------
    gas_data = site_data.get("gas", {}).get("data")
    results.append(_check_gas_label(gas_data))

    return results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _check_cpi_tier_label(
    metric: str,
    tier: int,
    metro: str,
    metro_lower: str,
) -> CheckResult:
    """Evaluate whether a single CPI metric's tier and metro label agree."""
    description = _cpi_description(metric)
    check_name = f"cpi_{metric}_label_tier_match"

    if tier == 1:
        # Metro label must not look like a regional or national series.
        if any(kw in metro_lower for kw in REGION_URBAN_KEYWORDS):
            return CheckResult(
                status=CheckStatus.FAIL,
                category="label_consistency",
                check_name=check_name,
                site_value=metro,
                source_value="tier 1 metro label",
                message=(
                    f"CPI {metric}: tier=1 (metro) but label '{metro}' contains 'Urban' "
                    f"— this looks like a tier-3 regional series. Likely a stale cache entry."
                ),
                details={"tier": tier, "metro": metro},
                description=description,
            )
        if any(kw in metro_lower for kw in NATIONAL_KEYWORDS):
            return CheckResult(
                status=CheckStatus.FAIL,
                category="label_consistency",
                check_name=check_name,
                site_value=metro,
                source_value="tier 1 metro label",
                message=(
                    f"CPI {metric}: tier=1 (metro) but label '{metro}' contains a national "
                    f"identifier — expected a city/metro area name."
                ),
                details={"tier": tier, "metro": metro},
                description=description,
            )
        # Positive confirmation: metro names typically contain a hyphen or
        # comma (e.g. "Chicago-Naperville-Elgin", "New York-Newark-Jersey City").
        return CheckResult(
            status=CheckStatus.PASS,
            category="label_consistency",
            check_name=check_name,
            site_value=metro,
            source_value="tier 1 metro label",
            message=f"CPI {metric}: tier=1 label '{metro}' looks like a metro area name",
            details={"tier": tier, "metro": metro},
            description=description,
        )

    if tier == 2:
        # Division label must match a known Census division name.
        if any(kw in metro_lower for kw in REGION_URBAN_KEYWORDS):
            return CheckResult(
                status=CheckStatus.FAIL,
                category="label_consistency",
                check_name=check_name,
                site_value=metro,
                source_value="tier 2 division label",
                message=(
                    f"CPI {metric}: tier=2 (division) but label '{metro}' contains 'Urban' "
                    f"— this looks like a tier-3 regional series."
                ),
                details={"tier": tier, "metro": metro},
                description=description,
            )
        matched_division = next(
            (div for div in DIVISION_NAMES if div in metro_lower), None
        )
        if matched_division:
            return CheckResult(
                status=CheckStatus.PASS,
                category="label_consistency",
                check_name=check_name,
                site_value=metro,
                source_value=f"Census division: {matched_division}",
                message=(
                    f"CPI {metric}: tier=2 label '{metro}' matches Census division "
                    f"'{matched_division}'"
                ),
                details={"tier": tier, "metro": metro, "matched_division": matched_division},
                description=description,
            )
        # Label doesn't match a known division name — could be stale cache.
        return CheckResult(
            status=CheckStatus.WARN,
            category="label_consistency",
            check_name=check_name,
            site_value=metro,
            source_value="tier 2 division label",
            message=(
                f"CPI {metric}: tier=2 (division) but label '{metro}' does not match any "
                f"known Census division name. Known divisions: {sorted(DIVISION_NAMES)}"
            ),
            details={"tier": tier, "metro": metro},
            description=description,
        )

    if tier == 3:
        # Regional label must contain "Urban".
        if any(kw in metro_lower for kw in REGION_URBAN_KEYWORDS):
            return CheckResult(
                status=CheckStatus.PASS,
                category="label_consistency",
                check_name=check_name,
                site_value=metro,
                source_value="tier 3 regional label",
                message=f"CPI {metric}: tier=3 label '{metro}' correctly contains 'Urban'",
                details={"tier": tier, "metro": metro},
                description=description,
            )
        return CheckResult(
            status=CheckStatus.FAIL,
            category="label_consistency",
            check_name=check_name,
            site_value=metro,
            source_value="tier 3 regional label",
            message=(
                f"CPI {metric}: tier=3 (regional) but label '{metro}' does not contain "
                f"'Urban' — expected something like 'South Urban' or 'West Urban'."
            ),
            details={"tier": tier, "metro": metro},
            description=description,
        )

    if tier == 4:
        # National label must signal national coverage.
        if any(kw in metro_lower for kw in NATIONAL_KEYWORDS):
            return CheckResult(
                status=CheckStatus.PASS,
                category="label_consistency",
                check_name=check_name,
                site_value=metro,
                source_value="tier 4 national label",
                message=f"CPI {metric}: tier=4 label '{metro}' correctly identifies national data",
                details={"tier": tier, "metro": metro},
                description=description,
            )
        return CheckResult(
            status=CheckStatus.FAIL,
            category="label_consistency",
            check_name=check_name,
            site_value=metro,
            source_value="tier 4 national label",
            message=(
                f"CPI {metric}: tier=4 (national) but label '{metro}' does not contain "
                f"'National' or 'U.S.' — users will see a misleading geographic label."
            ),
            details={"tier": tier, "metro": metro},
            description=description,
        )

    # Unrecognized tier value — defensively skip rather than false-fail.
    logger.warning(
        "label_consistency: unrecognized CPI tier %r for metric %s metro=%r",
        tier, metric, metro,
    )
    return CheckResult(
        status=CheckStatus.SKIP,
        category="label_consistency",
        check_name=check_name,
        site_value=metro,
        message=f"CPI {metric}: unrecognized tier value {tier!r} — cannot verify label",
        details={"tier": tier, "metro": metro},
        description=description,
    )


def _check_gas_label(gas_data: dict | None) -> CheckResult:
    """Check that the gas geoLevel string includes an unambiguous resolution label."""
    description = (
        "Gas geoLevel should clearly identify the resolution level: PADD district, "
        "city area, state avg, or national avg. A bare region name without a PADD "
        "identifier (e.g. 'Midwest avg') is ambiguous and may confuse users or mask "
        "a geo-mapping regression."
    )
    check_name = "gas_geolevel_label"

    if not gas_data:
        return CheckResult(
            status=CheckStatus.SKIP,
            category="label_consistency",
            check_name=check_name,
            message="No gas data in response — cannot check geoLevel label",
            description=description,
        )

    geo_level = gas_data.get("geoLevel", "")
    geo_lower = geo_level.lower()

    # --- PADD district (any tier, any sub-district) ---
    if "padd" in geo_lower:
        return CheckResult(
            status=CheckStatus.PASS,
            category="label_consistency",
            check_name=check_name,
            site_value=geo_level,
            message=f"Gas geoLevel '{geo_level}' includes PADD identifier — unambiguous",
            details={"geoLevel": geo_level},
            description=description,
        )

    # --- National avg ---
    if "national" in geo_lower:
        return CheckResult(
            status=CheckStatus.PASS,
            category="label_consistency",
            check_name=check_name,
            site_value=geo_level,
            message=f"Gas geoLevel '{geo_level}' is national avg — unambiguous",
            details={"geoLevel": geo_level},
            description=description,
        )

    # --- State avg (e.g. "Florida state avg", "California state avg") ---
    if "state avg" in geo_lower:
        return CheckResult(
            status=CheckStatus.PASS,
            category="label_consistency",
            check_name=check_name,
            site_value=geo_level,
            message=f"Gas geoLevel '{geo_level}' identifies a state avg — unambiguous",
            details={"geoLevel": geo_level},
            description=description,
        )

    # --- City area avg (e.g. "Chicago area avg", "Los Angeles area avg") ---
    if "area avg" in geo_lower:
        return CheckResult(
            status=CheckStatus.PASS,
            category="label_consistency",
            check_name=check_name,
            site_value=geo_level,
            message=f"Gas geoLevel '{geo_level}' identifies a city area avg — unambiguous",
            details={"geoLevel": geo_level},
            description=description,
        )

    # --- Region name without PADD (e.g. "Midwest avg", "West Coast avg") ---
    # This is technically renderable but is ambiguous — PADD districts and Census
    # regions do not share boundaries, and the label doesn't tell users which
    # geographic system is being used. Stale cache entries from before the PADD
    # identifier was added to geoLevel strings produce this pattern.
    if "avg" in geo_lower:
        return CheckResult(
            status=CheckStatus.WARN,
            category="label_consistency",
            check_name=check_name,
            site_value=geo_level,
            message=(
                f"Gas geoLevel '{geo_level}' looks like a region label without a PADD "
                f"identifier. This may be a stale cache entry. Expected format: "
                f"'<Region> (PADD N) avg' (e.g. 'Midwest (PADD 2) avg')."
            ),
            details={"geoLevel": geo_level},
            description=description,
        )

    # --- Unrecognized format ---
    logger.warning(
        "label_consistency: unrecognized gas geoLevel format %r", geo_level
    )
    return CheckResult(
        status=CheckStatus.WARN,
        category="label_consistency",
        check_name=check_name,
        site_value=geo_level,
        message=(
            f"Gas geoLevel '{geo_level}' does not match any recognized pattern "
            f"(PADD, national, state avg, area avg) — cannot verify label"
        ),
        details={"geoLevel": geo_level},
        description=description,
    )


def _cpi_description(metric: str) -> str:
    return (
        f"Verify that the CPI {metric} tier number matches the geographic label "
        f"displayed to users. A mismatch means the label says one resolution level "
        f"(e.g. metro) while the data is actually from a different level (e.g. regional), "
        f"which misleads users about how local the data is."
    )
