"""Fetch data from the BLS API v2 (CPI and LAUS series)."""

import os
import logging
from typing import Optional

import requests

from src.utils import retry_request

logger = logging.getLogger(__name__)

BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"


def fetch_bls_series(
    series_ids: list[str],
    start_year: str = "2024",
    end_year: str = "2026",
) -> Optional[dict]:
    """Fetch one or more BLS time series.

    Batches multiple series in a single API call (BLS allows up to 50).
    Returns dict keyed by series ID with data and metadata.

    Args:
        series_ids: List of BLS series IDs (e.g., ['CUURS49ASAF11', 'LAUCN060810000000003'])
        start_year: Start year for data range
        end_year: End year for data range

    Returns:
        Dict mapping series_id -> {name, data: [{year, period, value}], catalog} or None on failure.
    """
    api_key = os.environ.get("BLS_API_KEY")
    if not api_key:
        logger.error("BLS_API_KEY environment variable not set")
        return None

    payload = {
        "seriesid": series_ids,
        "startyear": start_year,
        "endyear": end_year,
        "registrationkey": api_key,
        "catalog": True,  # Request metadata including series name/area
    }

    try:
        response = retry_request("post", BLS_API_URL, json=payload, timeout=30.0)

        # BLS sometimes returns HTML error pages instead of JSON
        content_type = response.headers.get("content-type", "")
        if "json" not in content_type:
            logger.warning("BLS API returned non-JSON response (content-type: %s) — may be rate limited or down", content_type)
            return None

        data = response.json()

        if data.get("status") != "REQUEST_SUCCEEDED":
            logger.warning("BLS API returned status: %s, message: %s",
                          data.get("status"), data.get("message", []))
            return None

        results = {}
        for series in data.get("Results", {}).get("series", []):
            series_id = series.get("seriesID", "")
            catalog = series.get("catalog", {})

            series_data = []
            for item in series.get("data", []):
                try:
                    series_data.append({
                        "year": item["year"],
                        "period": item["period"],
                        "value": float(item["value"]),
                        "period_name": item.get("periodName", ""),
                    })
                except (ValueError, KeyError) as e:
                    logger.debug("Skipping invalid BLS data point: %s", e)
                    continue

            results[series_id] = {
                "series_name": catalog.get("series_title", ""),
                "area_name": catalog.get("area", ""),
                "item_name": catalog.get("item", ""),
                "data": series_data,
                "catalog": catalog,
            }

        return results
    except requests.RequestException as e:
        logger.error("BLS API request failed: %s", e)
        return None
    except (ValueError, KeyError) as e:
        logger.error("Failed to parse BLS response: %s", e)
        return None


def get_latest_value(series_data: list[dict]) -> Optional[dict]:
    """Get the most recent data point from a BLS series.

    BLS returns data in reverse chronological order (newest first).
    """
    if not series_data:
        return None
    return series_data[0]


def get_jan_2025_value(series_data: list[dict]) -> Optional[dict]:
    """Find the January 2025 data point in a BLS series.

    Used for baseline comparison (Jan 20, 2025 inauguration).
    """
    for item in series_data:
        if item["year"] == "2025" and item["period"] == "M01":
            return item
    return None
