"""Consolidated Playwright browser session for audit.

One browser session per zip code: screenshot + DOM scrape + link extraction.
This avoids multiple expensive browser launches per zip.
"""

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class BrowserResult:
    """All data collected from a single browser session for one zip code."""
    zip_code: str
    screenshot_path: Optional[str] = None
    rendered_values: dict = field(default_factory=dict)
    links: list = field(default_factory=list)
    full_text: str = ""
    error: Optional[str] = None


@dataclass
class SourceScreenshot:
    """Screenshot of an external source page."""
    url: str
    path: str
    success: bool = True
    error: Optional[str] = None


def run_site_session(
    zip_code: str,
    output_dir: str,
    site_base_url: str = "https://whatchanged.us",
    headless: bool = True,
) -> BrowserResult:
    """Open whatchanged.us for a zip, screenshot it, scrape DOM values and links.

    Args:
        zip_code: Zip code to audit
        output_dir: Directory to save screenshots
        site_base_url: Base URL of the site (allows override for testing)
        headless: Whether to run browser in headless mode

    Returns:
        BrowserResult with screenshot path, rendered values, and links.
    """
    result = BrowserResult(zip_code=zip_code)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        result.error = "Playwright not installed"
        logger.error("Playwright not installed — run 'pip install playwright && playwright install chromium'")
        return result

    os.makedirs(output_dir, exist_ok=True)
    screenshot_path = os.path.join(output_dir, "whatchanged_full.png")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)
            page = browser.new_page(viewport={"width": 1280, "height": 900})

            url = f"{site_base_url}/?zip={zip_code}"
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(3000)  # Wait for charts/animations

            # 1. Full-page screenshot
            page.screenshot(path=screenshot_path, full_page=True)
            result.screenshot_path = screenshot_path

            # 2. Scrape rendered values from DOM
            result.rendered_values = _scrape_rendered_values(page)

            # 3. Extract all links
            result.links = _extract_links(page)

            # 4. Get full page text for fallback parsing
            body = page.query_selector("body")
            if body:
                result.full_text = body.inner_text()

            browser.close()

    except Exception as e:
        result.error = f"Browser session failed: {type(e).__name__}: {e}"
        logger.error("Browser session failed for zip %s: %s", zip_code, e)

    return result


def take_source_screenshots(
    urls: list[dict],
    output_dir: str,
    headless: bool = True,
) -> list[SourceScreenshot]:
    """Take screenshots of external source pages (EIA, BLS, FRED, etc.).

    Uses a single shared browser instance for all URLs.

    Args:
        urls: List of dicts with 'url', 'filename' keys
        output_dir: Directory to save screenshots
        headless: Whether to run browser in headless mode

    Returns:
        List of SourceScreenshot results.
    """
    results = []

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.error("Playwright not installed")
        return [SourceScreenshot(url=u["url"], path="", success=False, error="Playwright not installed") for u in urls]

    os.makedirs(output_dir, exist_ok=True)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)

            for url_info in urls:
                url = url_info["url"]
                filename = url_info["filename"]
                path = os.path.join(output_dir, filename)

                try:
                    page = browser.new_page(viewport={"width": 1280, "height": 900})
                    page.goto(url, wait_until="networkidle", timeout=20000)
                    page.wait_for_timeout(2000)
                    page.screenshot(path=path, full_page=True)
                    results.append(SourceScreenshot(url=url, path=path))
                    page.close()
                except Exception as e:
                    logger.warning("Failed to screenshot %s: %s", url, e)
                    results.append(SourceScreenshot(url=url, path=path, success=False, error=str(e)))

            browser.close()

    except Exception as e:
        logger.error("Browser launch failed for source screenshots: %s", e)
        for url_info in urls:
            if not any(r.url == url_info["url"] for r in results):
                results.append(SourceScreenshot(
                    url=url_info["url"], path="", success=False, error=str(e)
                ))

    return results


def _scrape_rendered_values(page) -> dict:
    """Extract visible data values from the rendered whatchanged.us page.

    Looks for specific patterns in the DOM to extract the values
    that users actually see, independent of the API response.
    """
    rendered = {}

    try:
        body_text = page.query_selector("body")
        if not body_text:
            return rendered
        text = body_text.inner_text()

        # Gas price: look for $X.XX/gal pattern
        gas_match = re.search(r'\$([\d]+\.[\d]{2})/gal', text)
        if gas_match:
            rendered["gas_price"] = float(gas_match.group(1))

        # Tariff impact: look for ~$X,XXX/yr pattern near tariff context
        # Must search near "tariff" text to avoid matching grocery/housing dollar translations
        tariff_section = re.search(r'(?:tariff|Tariff)[^\n]*?~?\$?([\d,]+)/yr', text, re.DOTALL)
        if not tariff_section:
            # Fallback: look for the largest /yr amount (tariff is typically the biggest)
            yr_matches = re.findall(r'~?\$?([\d,]+)/yr', text)
            if yr_matches:
                amounts = [float(m.replace(",", "")) for m in yr_matches]
                rendered["tariff_estimate"] = max(amounts)
        else:
            rendered["tariff_estimate"] = float(tariff_section.group(1).replace(",", ""))

        # Percentage changes: look for +X.X% or -X.X% patterns with context
        # Grocery/Housing/Shelter patterns
        grocery_match = re.search(r'(?:grocery|groceries|food)[^%]*?([+-]?[\d]+\.[\d]+)%', text, re.IGNORECASE)
        if grocery_match:
            rendered["grocery_pct_change"] = float(grocery_match.group(1))

        shelter_match = re.search(r'(?:shelter|housing)[^%]*?([+-]?[\d]+\.[\d]+)%', text, re.IGNORECASE)
        if shelter_match:
            rendered["shelter_pct_change"] = float(shelter_match.group(1))

        # Unemployment rate
        unemp_match = re.search(r'(?:unemployment)[^%]*?([\d]+\.[\d]+)%', text, re.IGNORECASE)
        if unemp_match:
            rendered["unemployment_rate"] = float(unemp_match.group(1))

        # Location/metro info
        # Try to find the location banner text
        location_els = page.query_selector_all("h1, h2, [class*='location'], [class*='banner']")
        for el in location_els:
            el_text = el.inner_text()
            if any(word in el_text.lower() for word in ["county", "metro", ","]):
                rendered["location_text"] = el_text.strip()
                break

    except Exception as e:
        logger.warning("DOM scraping partially failed: %s", e)

    return rendered


def _extract_links(page) -> list[dict]:
    """Extract all links from the page for link verification."""
    links = []
    try:
        anchors = page.query_selector_all("a[href]")
        for anchor in anchors:
            href = anchor.get_attribute("href")
            text = anchor.inner_text().strip()
            if href and href.startswith("http"):
                links.append({"href": href, "text": text})
    except Exception as e:
        logger.warning("Link extraction failed: %s", e)

    return links
