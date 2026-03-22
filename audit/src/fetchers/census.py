"""Fetch data from the Census ACS API."""

import os
import logging
from typing import Optional

import requests

from src.utils import retry_request

logger = logging.getLogger(__name__)

CENSUS_API_BASE = "https://api.census.gov/data"


def fetch_median_income(zip_code: str, year: str = "2023") -> Optional[dict]:
    """Fetch median household income for a zip code from Census ACS 5-year estimates.

    Args:
        zip_code: 5-digit zip code
        year: ACS data year (latest available is typically 2 years behind)

    Returns:
        Dict with 'median_income', 'zip', 'year' on success, None on failure.
    """
    api_key = os.environ.get("CENSUS_API_KEY")

    params = {
        "get": "B19013_001E",
        "for": f"zip code tabulation area:{zip_code}",
    }
    if api_key:
        params["key"] = api_key

    url = f"{CENSUS_API_BASE}/{year}/acs/acs5"

    try:
        response = retry_request("get", url, params=params, timeout=20.0)
        data = response.json()

        # Census API returns a 2D array: first row is headers, second is data
        if len(data) < 2:
            logger.warning("No Census data returned for zip %s", zip_code)
            return None

        headers = data[0]
        values = data[1]

        income_idx = headers.index("B19013_001E")
        income_raw = values[income_idx]

        if income_raw is None or income_raw == "-666666666":
            logger.warning("Census reports no income data for zip %s", zip_code)
            return None

        return {
            "median_income": float(income_raw),
            "zip": zip_code,
            "year": year,
            "raw_response": data,
        }
    except requests.RequestException as e:
        logger.error("Census API request failed for zip %s: %s", zip_code, e)
        return None
    except (ValueError, KeyError, IndexError) as e:
        logger.error("Failed to parse Census response for zip %s: %s", zip_code, e)
        return None
