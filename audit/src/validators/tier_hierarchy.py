"""Validate that each zip gets the most granular CPI tier available.

Tier meanings (from the site's data pipeline):
  1 — metro (CBSA-based, e.g. "Chicago-Naperville-Elgin") — most granular
  2 — Census division (e.g. "East North Central")           — correct for non-metro
  3 — Census region (e.g. "Northeast Urban")               — fallback, should be rare
  4 — national / territories                               — only valid for territories

This validator does NOT import main codebase code (see audit/AUDIT_RULES.md).
It uses only what is present in site_data to classify correctness.
"""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

# US territories that legitimately receive national (tier-4) CPI data.
# BLS publishes no sub-national CPI for these areas.
TERRITORIES = {"PR", "VI", "GU", "AS", "MP"}

# All 50 US state abbreviations — every one of these should get at least
# division-level (tier-2) CPI, never national (tier-4).
US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
}


def _get_cpi_tier(cpi_data: dict) -> int | None:
    """Extract the CPI tier from CPI data.

    Prefers the explicit ``tier`` field; falls back to name-based inference
    for stale cache entries that predate the tier field (per CLAUDE.md).

    Returns None if the tier cannot be determined.
    """
    explicit_tier = cpi_data.get("tier")
    if explicit_tier is not None:
        try:
            return int(explicit_tier)
        except (TypeError, ValueError):
            pass

    # Fallback: infer from metro name (matches frontend logic in HomeContent.tsx)
    metro = cpi_data.get("metro", "")
    metro_lower = metro.lower().strip()

    if not metro_lower:
        return None

    national_aliases = {"national", "u.s. city average", "us city average"}
    if metro_lower in national_aliases:
        return 4
    if "urban" in metro_lower:
        return 3
    # Division names don't contain "Urban" and are not known metro names;
    # we cannot reliably distinguish tier 1 from tier 2 by name alone here,
    # so return 1 as the conservative default (metro).
    return 1


def verify_tier_hierarchy(site_data: dict) -> list[CheckResult]:
    """Validate that the zip's CPI tier assignment is appropriate.

    Rules:
    - Tier 1 (metro):     PASS — most granular possible
    - Tier 2 (division):  PASS — correct for non-metro counties; log division name
    - Tier 3 (regional):  WARN — all 50 states should be covered by divisions
    - Tier 4 (national):  PASS for territories (PR, VI, GU, AS, MP)
                          FAIL for any US state or DC

    Args:
        site_data: Full API response from whatchanged.us /api/data/{zip}

    Returns:
        List containing one CheckResult.
    """
    category = "tier_hierarchy"
    check_name = "cpi_tier_hierarchy"
    description = (
        "Validate that the zip receives the most granular CPI tier available. "
        "Tier 1 = metro (best), 2 = division, 3 = regional (fallback), "
        "4 = national (territories only)."
    )

    cpi_block = site_data.get("cpi", {})
    cpi_data = cpi_block.get("data") if isinstance(cpi_block, dict) else None

    if not cpi_data:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category=category,
            check_name=check_name,
            message="No CPI data present in site_data — cannot evaluate tier hierarchy",
            description=description,
        )]

    tier = _get_cpi_tier(cpi_data)

    if tier is None:
        return [CheckResult(
            status=CheckStatus.SKIP,
            category=category,
            check_name=check_name,
            message="CPI tier could not be determined (missing 'tier' field and 'metro' name)",
            description=description,
        )]

    metro = cpi_data.get("metro", "")

    # Extract state abbreviation for tier-3/4 checks.
    location = site_data.get("location", {})
    state_abbr = ""
    if isinstance(location, dict):
        state_abbr = (location.get("stateAbbr") or "").upper().strip()

    # --- Tier 1: metro — most granular, always correct ---
    if tier == 1:
        return [CheckResult(
            status=CheckStatus.PASS,
            category=category,
            check_name=check_name,
            site_value=tier,
            message=f"Tier 1 (metro): most granular CPI available — '{metro}'",
            details={"tier": tier, "metro": metro, "state": state_abbr},
            description=description,
        )]

    # --- Tier 2: division — correct for non-metro counties ---
    if tier == 2:
        return [CheckResult(
            status=CheckStatus.PASS,
            category=category,
            check_name=check_name,
            site_value=tier,
            message=f"Tier 2 (division): non-metro county receives division CPI — '{metro}'",
            details={"tier": tier, "division": metro, "state": state_abbr},
            description=description,
        )]

    # --- Tier 3: regional — should not appear for any US state ---
    if tier == 3:
        return [CheckResult(
            status=CheckStatus.WARN,
            category=category,
            check_name=check_name,
            site_value=tier,
            message=(
                f"Tier 3 (regional): '{metro}' — all 50 states have division coverage; "
                "regional is a fallback that should not normally be reached. "
                "Check county-metro-cpi.ts STATE_TO_DIVISION mapping."
            ),
            details={"tier": tier, "region": metro, "state": state_abbr},
            description=description,
        )]

    # --- Tier 4: national ---
    if tier == 4:
        if state_abbr in TERRITORIES:
            return [CheckResult(
                status=CheckStatus.PASS,
                category=category,
                check_name=check_name,
                site_value=tier,
                message=(
                    f"Tier 4 (national): territory '{state_abbr}' has no sub-national "
                    "BLS CPI — national is correct"
                ),
                details={"tier": tier, "metro": metro, "state": state_abbr},
                description=description,
            )]

        # US state or DC receiving national CPI is a bug
        state_label = state_abbr if state_abbr else "unknown state"
        return [CheckResult(
            status=CheckStatus.FAIL,
            category=category,
            check_name=check_name,
            site_value=tier,
            message=(
                f"Tier 4 (national) assigned to US state '{state_label}' — "
                "every state should receive at least division-level (tier-2) CPI. "
                "Check STATE_TO_DIVISION in county-metro-cpi.ts."
            ),
            details={"tier": tier, "metro": metro, "state": state_abbr},
            description=description,
        )]

    # Unexpected tier value
    return [CheckResult(
        status=CheckStatus.SKIP,
        category=category,
        check_name=check_name,
        site_value=tier,
        message=f"Unexpected CPI tier value {tier!r} — cannot evaluate",
        details={"tier": tier, "metro": metro, "state": state_abbr},
        description=description,
    )]
