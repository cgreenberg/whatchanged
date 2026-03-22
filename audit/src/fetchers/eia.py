"""Fetch gas prices from the EIA API v2."""

import os
import logging
from typing import Optional

import requests

from src.utils import retry_request

logger = logging.getLogger(__name__)

EIA_API_BASE = "https://api.eia.gov/v2/petroleum/pri/gnd/data/"


def fetch_gas_price(duoarea: str, product: str = "EPM0", num_results: int = 5) -> Optional[dict]:
    """Fetch weekly retail gas prices from EIA for a given area code.

    Args:
        duoarea: EIA area code (e.g., 'SCA' for California, 'NUS' for national average)
        product: EIA product code — 'EPM0' for all grades retail gasoline (default)
        num_results: Number of recent data points to return

    Returns:
        Dict with 'latest_price', 'latest_period', 'series' on success, None on failure.
    """
    api_key = os.environ.get("EIA_API_KEY")
    if not api_key:
        logger.error("EIA_API_KEY environment variable not set")
        return None

    params = {
        "api_key": api_key,
        "frequency": "weekly",
        "data[0]": "value",
        "facets[duoarea][]": duoarea,
        "facets[product][]": product,
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "length": num_results,
    }

    try:
        response = retry_request("get", EIA_API_BASE, params=params, timeout=20.0)
        data = response.json()

        if "response" not in data or "data" not in data["response"]:
            logger.warning("Unexpected EIA response structure for area %s", duoarea)
            return None

        records = data["response"]["data"]
        if not records:
            logger.warning("No EIA data returned for area %s (product=%s)", duoarea, product)
            return None

        latest = records[0]
        return {
            "latest_price": float(latest["value"]) if latest.get("value") else None,
            "latest_period": latest.get("period"),
            "area_name": latest.get("area-name", ""),
            "series": [
                {"period": r["period"], "value": float(r["value"]) if r.get("value") else None}
                for r in records
            ],
            "raw_response": data,
        }
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 400:
            logger.warning(
                "EIA API returned 400 for area=%s product=%s — invalid params, skipping",
                duoarea, product,
            )
        else:
            logger.error("EIA API request failed for area %s: %s", duoarea, e)
        return None
    except requests.RequestException as e:
        logger.error("EIA API request failed for area %s: %s", duoarea, e)
        return None
    except (ValueError, KeyError, TypeError) as e:
        logger.error("Failed to parse EIA response for area %s: %s", duoarea, e)
        return None
