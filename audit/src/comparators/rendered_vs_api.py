"""Compare DOM-scraped rendered values against API response.

Catches frontend display bugs where the API returns correct data
but the page renders it wrong (rounding, formatting, stale cache).
"""

from __future__ import annotations

import logging
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)


def compare_rendered_vs_api(
    rendered: dict,
    site_data: dict,
) -> list[CheckResult]:
    """Compare what the user sees (DOM) against what the API returns.

    Args:
        rendered: Dict from browser session DOM scraping
        site_data: Full API response from whatchanged.us

    Returns:
        List of CheckResult for each value comparison.
    """
    results = []

    if not rendered or not site_data:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="rendered",
            check_name="rendered_vs_api",
            message="Missing rendered or API data",
            description="Compare values shown on the rendered page vs the API response (checks for display/rounding bugs).",
        ))
        return results

    # Gas price: API returns e.g. 5.628, page should show $5.63
    gas_data = _safe_get(site_data, "gas", "data")
    if gas_data and "gas_price" in rendered:
        api_gas = gas_data.get("current")
        if api_gas is not None:
            # Site rounds to 2 decimal places for display
            expected_display = round(api_gas, 2)
            rendered_gas = rendered["gas_price"]
            match = abs(rendered_gas - expected_display) < 0.005

            results.append(CheckResult(
                status=CheckStatus.PASS if match else CheckStatus.FAIL,
                category="rendered",
                check_name="gas_price_display",
                site_value=rendered_gas,
                source_value=expected_display,
                difference=abs(rendered_gas - expected_display),
                message=f"API: {api_gas} → expected display: {expected_display}",
                description="Gas price shown on the rendered page vs the API response (checks for display/rounding bugs).",
            ))

    # Grocery % change
    cpi_data = _safe_get(site_data, "cpi", "data")
    if cpi_data and "grocery_pct_change" in rendered:
        api_grocery_change = cpi_data.get("groceriesChange")
        if api_grocery_change is not None:
            rendered_grocery = rendered["grocery_pct_change"]
            match = abs(rendered_grocery - api_grocery_change) < 0.05

            results.append(CheckResult(
                status=CheckStatus.PASS if match else CheckStatus.FAIL,
                category="rendered",
                check_name="grocery_change_display",
                site_value=rendered_grocery,
                source_value=api_grocery_change,
                difference=abs(rendered_grocery - api_grocery_change),
                unit="%",
                message="Grocery % change: rendered vs API",
                description="Grocery % change on the rendered page vs the API response.",
            ))

    # Shelter % change
    if cpi_data and "shelter_pct_change" in rendered:
        api_shelter_change = cpi_data.get("shelterChange")
        if api_shelter_change is not None:
            rendered_shelter = rendered["shelter_pct_change"]
            match = abs(rendered_shelter - api_shelter_change) < 0.05

            results.append(CheckResult(
                status=CheckStatus.PASS if match else CheckStatus.FAIL,
                category="rendered",
                check_name="shelter_change_display",
                site_value=rendered_shelter,
                source_value=api_shelter_change,
                difference=abs(rendered_shelter - api_shelter_change),
                unit="%",
                message="Shelter % change: rendered vs API",
                description="Shelter % change on the rendered page vs the API response.",
            ))

    return results


def _safe_get(data: dict, *keys):
    """Safely traverse nested dict keys, returning None if any key is missing."""
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current
