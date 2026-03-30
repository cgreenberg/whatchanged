"""Federal spending comparison: site vs independent USASpending API query.

AUDIT ISOLATION: This module does NOT import from the main codebase.
It compares the site's federal.data.amountCut against an independently
fetched total from the USASpending API.

KNOWN LIMITATIONS:
- The site fetches only page 1 (limit 100) of results, so for counties
  with >100 awards, the totals will differ. This is a known aggregation
  gap, not a bug.
- USASpending data updates continuously; the site caches for 24 hours.
  Timing differences are expected.
- Because of these aggregation and timing differences, mismatches produce
  WARN (not FAIL) when the discrepancy exceeds the tolerance.
"""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

# Tolerance: >10% discrepancy triggers a WARN
# Rationale: pagination limits (100 results) and cache staleness (24h TTL)
# mean exact matches are not expected.
TOLERANCE_PCT = 10.0


def compare_federal_spending(
    site_federal: dict | None,
    independent_data: dict | None,
) -> list[CheckResult]:
    """Compare the site's federal funding data against an independent USASpending query.

    Args:
        site_federal: federal.data from whatchanged.us API response.
            Expected keys: amountCut (float), contractsCut (int), countyFips (str)
        independent_data: Result from fetchers.usaspending.fetch_federal_spending().
            Expected keys: total_amount (float), num_awards (int), has_more (bool)

    Returns:
        List of CheckResult.
    """
    results = []

    usaspending_url = "https://www.usaspending.gov/search"
    description_base = (
        "Cross-check federal contract spending from whatchanged.us against "
        "an independent USASpending API query for the same county and date range. "
        "Differences are expected due to pagination limits (100 awards) and "
        "24-hour cache staleness."
    )

    # --- Check 1: Amount comparison ---
    if site_federal is None:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="federal",
            check_name="federal_amount_cross_check",
            message="No federal data in site API response",
            description=description_base,
            source_url=usaspending_url,
        ))
        return results

    if independent_data is None:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="federal",
            check_name="federal_amount_cross_check",
            message="USASpending independent fetch failed — cannot cross-check",
            description=description_base,
            source_url=usaspending_url,
        ))
        return results

    site_amount = site_federal.get("amountCut")
    indie_amount = independent_data.get("total_amount")

    if site_amount is None or indie_amount is None:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="federal",
            check_name="federal_amount_cross_check",
            message="Missing amount data for comparison",
            description=description_base,
            source_url=usaspending_url,
        ))
        return results

    # Both amounts could be 0 (no awards for this county)
    if site_amount == 0 and indie_amount == 0:
        results.append(CheckResult(
            status=CheckStatus.PASS,
            category="federal",
            check_name="federal_amount_cross_check",
            site_value=site_amount,
            source_value=indie_amount,
            difference=0.0,
            tolerance=TOLERANCE_PCT,
            unit="dollars",
            message="Both site and independent query report $0 in federal contracts",
            description=description_base,
            source_url=usaspending_url,
        ))
    else:
        # Calculate percentage difference relative to the larger value
        max_val = max(abs(site_amount), abs(indie_amount))
        diff = abs(site_amount - indie_amount)
        pct_diff = (diff / max_val * 100) if max_val > 0 else 0.0

        if pct_diff <= TOLERANCE_PCT:
            status = CheckStatus.PASS
            msg = (
                f"Federal spending within {TOLERANCE_PCT}% tolerance: "
                f"site=${site_amount:,.0f} vs independent=${indie_amount:,.0f} "
                f"({pct_diff:.1f}% difference)"
            )
        else:
            status = CheckStatus.WARN
            msg = (
                f"Federal spending differs by {pct_diff:.1f}% (>{TOLERANCE_PCT}%): "
                f"site=${site_amount:,.0f} vs independent=${indie_amount:,.0f}"
            )

        # Add context about pagination limits
        has_more = independent_data.get("has_more", False)
        if has_more:
            msg += " — independent query has more pages (pagination limit reached)"

        results.append(CheckResult(
            status=status,
            category="federal",
            check_name="federal_amount_cross_check",
            site_value=site_amount,
            source_value=indie_amount,
            difference=round(diff, 2),
            tolerance=TOLERANCE_PCT,
            unit="dollars",
            message=msg,
            description=description_base,
            details={
                "site_contracts": site_federal.get("contractsCut"),
                "indie_awards": independent_data.get("num_awards"),
                "indie_has_more_pages": has_more,
            },
            source_url=usaspending_url,
        ))

    return results
