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
) -> list[CheckResult]:
    """Compare site gas price against EIA (exact series) and AAA (best-effort).

    Args:
        site_gas: gas.data from whatchanged.us API
        eia_data: Result from eia.fetch_gas_price() for the exact same duoarea,
            or None if the duoarea was not available.
        aaa_data: Result from scrapers.fetch_aaa_gas_price() (may be None)
        tolerance_eia: Acceptable difference vs EIA in $/gal (exact match expected)
        tolerance_aaa: Acceptable difference vs AAA in $/gal

    Returns:
        List of CheckResult for each comparison.
    """
    results = []
    site_price = site_gas.get("current") if site_gas else None

    # Primary: EIA comparison — exact series match or SKIP
    if eia_data is not None:
        eia_price = eia_data.get("latest_price")
        eia_area = eia_data.get("area_name", "")
        eia_cmp = compare_values(site_price, eia_price, tolerance_eia, "$/gal")
        description = (
            f"Gas price from whatchanged.us vs EIA API for the same area ({eia_area}). "
            f"Tolerance: \u00b1${tolerance_eia}/gal."
        )
        results.append(CheckResult(
            status=eia_cmp["status"],
            category="gas",
            check_name="eia_price_match",
            site_value=site_price,
            source_value=eia_price,
            difference=eia_cmp.get("difference"),
            tolerance=tolerance_eia,
            unit="$/gal",
            message=f"EIA region: {eia_area}",
            details={
                "eia_period": eia_data.get("latest_period"),
                "site_region": site_gas.get("region") if site_gas else None,
            },
            description=description,
            source_url="https://www.eia.gov/petroleum/gasdiesel/",
        ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="gas",
            check_name="eia_price_match",
            site_value=site_price,
            message="EIA comparison skipped — exact regional series not available from site API.",
            description="EIA gas price comparison skipped — the site's exact EIA regional series ID (duoarea) was not available in the API response.",
            source_url="https://www.eia.gov/petroleum/gasdiesel/",
        ))

    # Best-effort: AAA cross-check (WARN only, never FAIL)
    # Prefer metro-level AAA price over state average when available
    if aaa_data is not None and site_price is not None:
        site_region = (site_gas.get("region") or "").lower()
        aaa_metros = aaa_data.get("metros", {})
        aaa_state = aaa_data.get("state", "")
        aaa_url = aaa_data.get("source_url", "https://gasprices.aaa.com/")

        # Try to find a matching metro
        metro_price = None
        metro_name = None
        if site_region and aaa_metros:
            for name, price in aaa_metros.items():
                # Match if the site region appears in the AAA metro name
                if site_region.split()[0].lower() in name:
                    metro_price = price
                    metro_name = name
                    break

        if metro_price is not None:
            # Metro-level comparison — tighter tolerance since same geography
            tolerance_metro = 0.50  # EIA vs AAA methodology still differs
            aaa_cmp = compare_values(site_price, metro_price, tolerance_metro, "$/gal")
            status = CheckStatus.WARN if aaa_cmp["status"] == CheckStatus.FAIL else aaa_cmp["status"]
            diff = aaa_cmp.get("difference", 0)
            if status == CheckStatus.PASS:
                msg = f"AAA metro '{metro_name}' (${metro_price:.3f}) matches site (${site_price:.3f}) within ${tolerance_metro}/gal"
            else:
                msg = f"AAA metro '{metro_name}' (${metro_price:.3f}) differs from site (${site_price:.3f}) by ${diff:.2f}/gal — EIA vs AAA methodology difference"
            results.append(CheckResult(
                status=status,
                category="gas",
                check_name="aaa_cross_check",
                site_value=site_price,
                source_value=metro_price,
                difference=aaa_cmp.get("difference"),
                tolerance=tolerance_metro,
                unit="$/gal",
                message=msg,
                description=f"Cross-check gas price against AAA metro-level average for '{metro_name}'. EIA and AAA use different survey methodologies, so $0.20-0.50 differences are normal.",
                source_url=aaa_url,
            ))
        else:
            # Fall back to state average
            aaa_price = aaa_data.get("regular_price")
            if aaa_price is not None:
                tolerance_state = 0.60  # Wider — state avg vs city price
                aaa_cmp = compare_values(site_price, aaa_price, tolerance_state, "$/gal")
                status = CheckStatus.WARN if aaa_cmp["status"] == CheckStatus.FAIL else aaa_cmp["status"]
                diff = aaa_cmp.get("difference", 0)
                if status == CheckStatus.PASS:
                    msg = f"AAA {aaa_state} state avg (${aaa_price:.3f}) matches site (${site_price:.3f}) within ${tolerance_state}/gal"
                else:
                    msg = f"AAA {aaa_state} state avg (${aaa_price:.3f}) differs from site (${site_price:.3f}) by ${diff:.2f}/gal — city vs state + methodology difference"
                results.append(CheckResult(
                    status=status,
                    category="gas",
                    check_name="aaa_cross_check",
                    site_value=site_price,
                    source_value=aaa_price,
                    difference=aaa_cmp.get("difference"),
                    tolerance=tolerance_state,
                    unit="$/gal",
                    message=msg,
                    description=f"Cross-check gas price against AAA {aaa_state} state average. No matching metro found for site region '{site_region}'.",
                    source_url=aaa_url,
                ))
            else:
                results.append(CheckResult(
                    status=CheckStatus.SKIP,
                    category="gas",
                    check_name="aaa_cross_check",
                    message="AAA price extraction failed",
                    description="AAA scraping succeeded but no price could be extracted.",
                    source_url=aaa_url,
                ))
    else:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="gas",
            check_name="aaa_cross_check",
            message="AAA data unavailable (best-effort scraper)",
            description="AAA scraping failed even with Playwright browser rendering. The site may have changed its layout.",
            source_url="https://gasprices.aaa.com/",
        ))

    return results
