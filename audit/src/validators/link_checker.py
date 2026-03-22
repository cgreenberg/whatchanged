"""Verify that source attribution links on the page resolve correctly."""

import logging
from src.utils import CheckStatus, CheckResult, retry_request

logger = logging.getLogger(__name__)

# Links that are known to be valid but may block automated requests
SKIP_DOMAINS = {"gasbuddy.com", "zillow.com", "redfin.com", "apartmentlist.com"}


def verify_links(links: list[dict]) -> list[CheckResult]:
    """Check that source attribution links resolve (HTTP 200).

    Args:
        links: List of dicts with 'href' and 'text' keys from browser session

    Returns:
        List of CheckResult for link checks.
    """
    results = []

    if not links:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="links",
            check_name="link_verification",
            message="No links extracted from page",
        ))
        return results

    # Filter to external source links (skip internal nav links)
    source_links = [
        link for link in links
        if _is_source_link(link.get("href", ""))
    ]

    if not source_links:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="links",
            check_name="link_verification",
            message="No external source links found",
        ))
        return results

    for link in source_links:
        href = link["href"]
        text = link.get("text", "")

        # Skip domains known to block automated requests
        if any(domain in href for domain in SKIP_DOMAINS):
            results.append(CheckResult(
                status=CheckStatus.SKIP,
                category="links",
                check_name="link_check",
                message=f"Skipped (blocks automated requests): {href}",
                details={"href": href, "text": text},
            ))
            continue

        try:
            response = retry_request(
                "get", href,
                timeout=10.0,
                retries=1,
                headers={"User-Agent": "Mozilla/5.0 (compatible; WhatChangedAudit/1.0)"},
                allow_redirects=True,
            )
            status_code = response.status_code

            results.append(CheckResult(
                status=CheckStatus.PASS if status_code == 200 else CheckStatus.WARN,
                category="links",
                check_name="link_check",
                message=f"HTTP {status_code}: {href}",
                details={"href": href, "text": text, "status_code": status_code},
            ))

        except Exception as e:
            results.append(CheckResult(
                status=CheckStatus.WARN,
                category="links",
                check_name="link_check",
                message=f"Failed to reach: {href} ({type(e).__name__})",
                details={"href": href, "text": text, "error": str(e)},
            ))

    return results


def _is_source_link(href: str) -> bool:
    """Check if a URL is a data source link (not internal navigation)."""
    if not href or not href.startswith("http"):
        return False

    source_domains = [
        "bls.gov", "eia.gov", "census.gov", "fred.stlouisfed.org",
        "budgetlab.yale.edu", "taxfoundation.org", "taxpolicycenter.org",
        "gasprices.aaa.com", "usaspending.gov",
    ]

    return any(domain in href for domain in source_domains)
