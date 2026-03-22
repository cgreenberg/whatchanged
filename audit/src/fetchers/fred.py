"""Fetch data from the FRED API (Federal Reserve Economic Data).

FRED mirrors BLS data — this is a Layer 1 cross-check (confirms API pull
was correct), NOT an independent verification source.
"""

import os
import logging
from typing import Optional

import requests

from src.utils import retry_request

logger = logging.getLogger(__name__)

FRED_API_BASE = "https://api.stlouisfed.org/fred/series/observations"


def _is_regional_bls_cpi(series_id: str) -> bool:
    """Return True if this looks like a regional BLS CPI series that FRED doesn't carry.

    FRED reliably mirrors national BLS CPI series (area code '0000') but does
    NOT mirror most regional/metro series.  Regional series have a non-zero area
    code embedded in the ID, e.g.:
      CUURS49DSAF11  — regional (area code S49D)
      CUUR0000SA0    — national (area code 0000, safe to query FRED)
    """
    # BLS CPI series IDs start with "CUU" followed by seasonal flag then area code
    # National series always contain "0000" as the area segment
    upper = series_id.upper()
    if upper.startswith("CUU") and "0000" not in upper:
        return True
    return False


def fetch_fred_series(
    series_id: str,
    limit: int = 12,
) -> Optional[dict]:
    """Fetch recent observations for a FRED series.

    Args:
        series_id: FRED/BLS series ID (e.g., 'CUURS49ASAF11')
        limit: Number of recent observations

    Returns:
        Dict with 'latest_value', 'latest_date', 'observations' on success, None on failure.
        Returns None (without error) if the series is a regional BLS CPI that FRED
        does not carry.
    """
    # FRED doesn't mirror regional BLS CPI series — skip to avoid noisy 400 errors
    if _is_regional_bls_cpi(series_id):
        logger.info(
            "Skipping FRED query for %s — regional BLS CPI series not available on FRED",
            series_id,
        )
        return None

    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        logger.error("FRED_API_KEY environment variable not set")
        return None

    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "desc",
        "limit": limit,
    }

    try:
        response = retry_request("get", FRED_API_BASE, params=params, timeout=20.0)
        data = response.json()

        observations = data.get("observations", [])
        if not observations:
            logger.warning("No FRED observations returned for series %s", series_id)
            return None

        # Filter out missing values (FRED uses "." for missing)
        valid_obs = [
            {"date": obs["date"], "value": float(obs["value"])}
            for obs in observations
            if obs.get("value") and obs["value"] != "."
        ]

        if not valid_obs:
            return None

        return {
            "latest_value": valid_obs[0]["value"],
            "latest_date": valid_obs[0]["date"],
            "observations": valid_obs,
            "raw_response": data,
        }
    except requests.RequestException as e:
        logger.error("FRED API request failed for series %s: %s", series_id, e)
        return None
    except (ValueError, KeyError) as e:
        logger.error("Failed to parse FRED response for series %s: %s", series_id, e)
        return None
