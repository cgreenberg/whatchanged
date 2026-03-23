"""Fetch data from the whatchanged.us public API."""

import logging
from typing import Optional
import requests

from src.utils import retry_request

logger = logging.getLogger(__name__)

DEFAULT_SITE_URL = "https://whatchanged.us"


def fetch_site_data(zip_code: str, site_url: str = DEFAULT_SITE_URL) -> Optional[dict]:
    """Fetch all data from whatchanged.us for a given zip code.

    Args:
        zip_code: 5-digit zip code
        site_url: Base URL of the site (e.g. http://localhost:3000 for local dev)

    Returns parsed JSON dict on success, None on any error.
    Does not raise — errors are logged and returned as None.
    """
    url = f"{site_url}/api/data/{zip_code}?audit=true"
    try:
        response = retry_request("get", url, timeout=15.0)
        data = response.json()

        # Check for API-level error responses
        if "error" in data and data["error"]:
            logger.warning("whatchanged.us returned error for zip %s: %s", zip_code, data["error"])
            return None

        return data
    except requests.RequestException as e:
        logger.error("Failed to fetch whatchanged.us data for zip %s: %s", zip_code, e)
        return None
    except (ValueError, KeyError) as e:
        logger.error("Invalid JSON response from whatchanged.us for zip %s: %s", zip_code, e)
        return None
