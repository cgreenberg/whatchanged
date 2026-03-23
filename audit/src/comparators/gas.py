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
    site_region: str = "",
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
        site_region: Human-readable region name shown on the site (e.g. "New York City").
            Used to make the description clearer when is_national_comparison=True.

    Returns:
        List of CheckResult for each comparison.
    """
    results = []
    site_price = site_gas.get("current") if site_gas else None

    # Primary: EIA comparison
    eia_price = eia_data.get("latest_price") if eia_data else None
    eia_cmp = compare_values(site_price, eia_price, tolerance_eia, "$/gal")
    eia_status = eia_cmp["status"]

    if is_national_comparison:
        check_name = "eia_national_vs_local"
        region_label = site_region or "local"
        if site_price is not None and eia_price is not None:
            description = (
                f"Site shows {region_label} gas at ${site_price:.2f}/gal. "
                f"Compared against US national average (${eia_price:.2f}/gal) because "
                f"the exact EIA regional series was not available. "
                f"Differences of $1-2 are normal for local-vs-national."
            )
        else:
            description = (
                f"Site shows {region_label} gas price. "
                f"Compared against US national average because the exact EIA regional series was not available. "
                f"Differences of $1-2 are normal for local-vs-national."
            )
        eia_message = f"National vs local comparison (advisory only) — EIA value is US national average, site shows {region_label} price"
        if eia_status == CheckStatus.FAIL:
            eia_status = CheckStatus.WARN
        source_url = "https://www.eia.gov/petroleum/gasdiesel/"
    else:
        check_name = "eia_price_match"
        eia_area = eia_data.get("area_name", "unknown") if eia_data else "unknown"
        if site_price is not None and eia_price is not None:
            description = (
                f"Gas price from whatchanged.us (${site_price:.2f}/gal) vs EIA "
                f"for the same region ({eia_area}). "
                f"Should match within ${tolerance_eia:.2f}/gal."
            )
        else:
            description = (
                f"Gas price from whatchanged.us vs EIA for the same region ({eia_area}). "
                f"Should match within ${tolerance_eia:.2f}/gal."
            )
        eia_message = f"EIA region: {eia_area}"
        source_url = "https://www.eia.gov/petroleum/gasdiesel/"

    results.append(CheckResult(
        status=eia_status,
        category="gas",
        check_name=check_name,
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
        description=description,
        source_url=source_url,
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
            description="Cross-check gas price against AAA (independent source). Best-effort — AAA blocks scrapers, so SKIP is normal.",
            source_url="https://gasprices.aaa.com/",
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="gas",
            check_name="aaa_cross_check",
            message="AAA data unavailable (best-effort scraper)",
            description="AAA gas price scraping was attempted but failed (CAPTCHAs, dynamic JS, or site changes). This is expected — AAA blocks automated requests. Not a problem.",
            source_url="https://gasprices.aaa.com/",
        ))

    return results
