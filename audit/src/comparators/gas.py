"""Gas price comparison: site vs EIA (primary) and AAA (best-effort)."""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult, compare_values

logger = logging.getLogger(__name__)


def compare_gas_price(
    site_gas: dict,
    eia_data: dict | None,
    aaa_data: dict | None,
    tolerance_eia: float = 0.05,
    tolerance_aaa: float = 0.15,
    is_national_comparison: bool = False,
) -> list[CheckResult]:
    """Compare site gas price against EIA and AAA.

    Args:
        site_gas: gas.data from whatchanged.us API
        eia_data: Result from eia.fetch_gas_price()
        aaa_data: Result from scrapers.fetch_aaa_gas_price() (may be None)
        tolerance_eia: Acceptable difference vs EIA in $/gal
        tolerance_aaa: Acceptable difference vs AAA in $/gal
        is_national_comparison: If True, the EIA value is a national average being
            compared against a local/regional site price. A mismatch is downgraded
            from FAIL to WARN because regional prices can legitimately differ by $1+
            from the national average.

    Returns:
        List of CheckResult for each comparison.
    """
    results = []
    site_price = site_gas.get("current") if site_gas else None

    # Primary: EIA comparison
    eia_price = eia_data.get("latest_price") if eia_data else None
    eia_cmp = compare_values(site_price, eia_price, tolerance_eia, "$/gal")
    eia_status = eia_cmp["status"]
    eia_message = f"EIA region: {eia_data.get('area_name', 'unknown')}" if eia_data else "No EIA data"
    if is_national_comparison and eia_status == CheckStatus.FAIL:
        eia_status = CheckStatus.WARN
        eia_message = (
            f"National vs local comparison (advisory only) — "
            f"site shows local/regional price, EIA value is US national average. "
            f"Regional prices can differ by $1+ from national. "
            f"EIA region: {eia_data.get('area_name', 'unknown') if eia_data else 'unknown'}"
        )
    results.append(CheckResult(
        status=eia_status,
        category="gas",
        check_name="eia_price_match",
        site_value=site_price,
        source_value=eia_price,
        difference=eia_cmp.get("difference"),
        tolerance=tolerance_eia,
        unit="$/gal",
        message=eia_message,
        details={
            "eia_period": eia_data.get("latest_period") if eia_data else None,
            "site_region": site_gas.get("region") if site_gas else None,
            "is_national_comparison": is_national_comparison,
        },
    ))

    # Best-effort: AAA cross-check (WARN only, never FAIL)
    aaa_price = aaa_data.get("regular_price") if aaa_data else None
    if aaa_price is not None and site_price is not None:
        aaa_cmp = compare_values(site_price, aaa_price, tolerance_aaa, "$/gal")
        # Downgrade FAIL to WARN for best-effort checks
        status = CheckStatus.WARN if aaa_cmp["status"] == CheckStatus.FAIL else aaa_cmp["status"]
        results.append(CheckResult(
            status=status,
            category="gas",
            check_name="aaa_cross_check",
            site_value=site_price,
            source_value=aaa_price,
            difference=aaa_cmp.get("difference"),
            tolerance=tolerance_aaa,
            unit="$/gal",
            message="AAA best-effort cross-check",
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="gas",
            check_name="aaa_cross_check",
            message="AAA data unavailable (best-effort scraper)",
        ))

    return results
