"""Best-effort web scrapers for independent cross-check sources.

These are Layer 4 checks — they use non-government data sources that
collect data independently. If scraping fails (CAPTCHAs, dynamic JS,
rate limits), the check returns SKIP, never crashes the audit.
"""

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


def fetch_aaa_gas_price(state_abbr: str) -> Optional[dict]:
    """Scrape state gas price from AAA using Playwright (not requests).

    AAA requires JavaScript rendering. This is still best-effort —
    returns None on any failure.

    Args:
        state_abbr: Two-letter state code (e.g., 'CA', 'WA')

    Returns:
        Dict with 'regular_price', 'state', 'source_url' on success, None on failure.
    """
    url = f"https://gasprices.aaa.com/?state={state_abbr}"

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.info("Playwright not installed — AAA scraper skipped")
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, wait_until="networkidle", timeout=15000)
            page.wait_for_timeout(2000)  # Let JS render prices

            # Get full page text and look for price patterns
            text = page.inner_text("body")

            # AAA shows prices like "Regular $X.XXX" or in a table
            # Look for regular gas price — typically the first price shown
            # Pattern: a dollar amount near the word "regular" or "current"
            price_match = re.search(
                r'(?:regular|current avg|today)[^\d]*\$?([\d]+\.[\d]{2,3})',
                text,
                re.IGNORECASE,
            )

            if not price_match:
                # Fallback: find any reasonable gas price on the page
                all_prices = re.findall(r'\$([\d]+\.[\d]{2,3})', text)
                # Filter to reasonable gas prices ($1-$10)
                valid = [float(p) for p in all_prices if 1.0 <= float(p) <= 10.0]
                if valid:
                    # Take the first one (usually the headline regular price)
                    price = valid[0]
                else:
                    logger.info("AAA: no valid gas prices found on page for state %s", state_abbr)
                    browser.close()
                    return None
            else:
                price = float(price_match.group(1))

            browser.close()

            if 1.0 <= price <= 10.0:
                return {
                    "regular_price": price,
                    "state": state_abbr,
                    "source_url": url,
                }

            logger.info("AAA: extracted price $%.3f outside valid range for state %s", price, state_abbr)
            return None

    except Exception as e:
        logger.info("AAA scraper failed for state %s: %s", state_abbr, type(e).__name__)
        return None
