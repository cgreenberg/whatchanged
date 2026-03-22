"""Best-effort web scrapers for independent cross-check sources.

These are Layer 4 checks — they use non-government data sources that
collect data independently. If scraping fails (CAPTCHAs, dynamic JS,
rate limits), the check returns SKIP, never crashes the audit.
"""

import logging
import re
from typing import Optional

import requests

from src.utils import retry_request

logger = logging.getLogger(__name__)


def fetch_aaa_gas_price(state_abbr: str) -> Optional[dict]:
    """Attempt to scrape state gas price from AAA.

    AAA uses dynamic JavaScript rendering and sometimes shows CAPTCHAs.
    This is best-effort — returns None on any failure.

    Args:
        state_abbr: Two-letter state code (e.g., 'CA', 'WA')

    Returns:
        Dict with 'regular_price', 'state' on success, None on failure.
    """
    url = f"https://gasprices.aaa.com/?state={state_abbr}"

    try:
        response = retry_request(
            "get", url,
            timeout=15.0,
            retries=1,  # Only 1 attempt for scrapers
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; WhatChangedAudit/1.0)"
            }
        )
        html = response.text

        # AAA embeds prices in structured data or specific elements
        # Look for regular unleaded price pattern
        # This is fragile by design — if it breaks, we SKIP
        price_match = re.search(
            r'regular["\s:]*?\$?([\d]+\.[\d]{2,3})',
            html,
            re.IGNORECASE,
        )

        if price_match:
            price = float(price_match.group(1))
            # Sanity check: gas price should be between $1 and $10
            if 1.0 <= price <= 10.0:
                return {
                    "regular_price": price,
                    "state": state_abbr,
                    "source_url": url,
                }

        logger.info("Could not extract AAA gas price for state %s (scraper may need update)", state_abbr)
        return None

    except Exception as e:
        # Catch everything — scrapers must never crash the audit
        logger.info("AAA scraper failed for state %s (best-effort): %s", state_abbr, type(e).__name__)
        return None
