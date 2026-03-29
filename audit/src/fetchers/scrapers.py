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
    """Scrape state and metro gas prices from AAA using Playwright.

    AAA requires JavaScript rendering. This is still best-effort —
    returns None on any failure.

    Args:
        state_abbr: Two-letter state code (e.g., 'CA', 'WA')

    Returns:
        Dict with 'regular_price', 'state', 'metros', 'source_url' on success,
        None on failure.
    """
    # NOTE (March 2026): gasprices.aaa.com is behind Cloudflare Bot Management
    # and returns 403 to all headless browsers. This function gracefully returns
    # None, producing a SKIP in the audit. Do not spend time debugging selectors.
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
            # Longer timeout — some state pages are slow
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)  # Let JS render prices

            price = None

            # Method 1: State price has class "price-text--blue" (national is "--red")
            blue_el = page.query_selector(".price-text--blue")
            if blue_el:
                blue_text = blue_el.inner_text()
                m = re.search(r'([\d]+\.[\d]{2,3})', blue_text)
                if m:
                    price = float(m.group(1))

            # Method 2: Parse the state price table — "Current Avg." row
            if price is None:
                text = page.inner_text("body")
                current_match = re.search(
                    r'Current Avg\.\s*\$?([\d]+\.[\d]{2,3})',
                    text,
                )
                if current_match:
                    price = float(current_match.group(1))

            # Extract metro prices from "METRO AVERAGE PRICES" section
            metros = _extract_aaa_metros(page)

            browser.close()

            if price and 1.0 <= price <= 10.0:
                result = {
                    "regular_price": price,
                    "state": state_abbr,
                    "source_url": url,
                }
                if metros:
                    result["metros"] = metros
                return result

            logger.info("AAA: could not extract state price for %s", state_abbr)
            return None

    except Exception as e:
        logger.info("AAA scraper failed for state %s: %s", state_abbr, type(e).__name__)
        return None


def _extract_aaa_metros(page) -> dict:
    """Extract metro-level gas prices from AAA state page.

    The page has a "METRO AVERAGE PRICES" section with expandable
    accordions per metro. We click "Expand all" to reveal the price
    tables, then parse "Current Avg." rows for each metro.

    Returns:
        Dict mapping metro name (lowercase) to regular price, e.g.
        {"new york": 3.85, "albany-schenectady-troy": 3.87, ...}
    """
    metros = {}
    try:
        # Click "Expand all" to reveal metro price tables
        expand = page.query_selector("text=Expand all")
        if expand:
            expand.click()
            page.wait_for_timeout(2000)

        text = page.inner_text("body")
        lines = text.split("\n")

        in_metro = False
        current_metro = None

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            if "metro average prices" in stripped.lower():
                in_metro = True
                continue
            if not in_metro:
                continue
            # Stop at the "STATE GAS PRICES" section
            if "state gas prices" in stripped.lower():
                break

            # Skip UI controls
            if stripped in ("Expand all", "Collapse all", "Sort A-Z",
                            "Sort Z-A", "Sort Highest", "Sort Lowest"):
                continue
            # Skip table headers
            if stripped.startswith("Regular\t"):
                continue

            # "Current Avg." row has the prices we want
            m = re.match(r'Current Avg\.\s*\$?([\d]+\.[\d]{2,3})', stripped)
            if m and current_metro:
                price = float(m.group(1))
                if 1.0 <= price <= 10.0:
                    metros[current_metro] = price
                current_metro = None
                continue

            # Skip other data rows (Yesterday, Week Ago, etc.)
            if stripped.startswith(("Yesterday", "Week Ago", "Month Ago",
                                    "Year Ago", "Regular Unleaded", "Diesel")):
                continue

            # Anything else in the metro section is a metro name
            if re.match(r'^[A-Za-z]', stripped) and not stripped.startswith("$"):
                current_metro = stripped.lower()

    except Exception as e:
        logger.debug("AAA metro extraction failed: %s", e)

    return metros
