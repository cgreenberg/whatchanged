"""Independent USASpending API fetcher for audit cross-checks.

Queries the USASpending awards API directly to cross-check federal funding
data displayed on whatchanged.us.

AUDIT ISOLATION: This module does NOT import from the main codebase.
The request format was independently derived from the public USASpending
API documentation: https://api.usaspending.gov/docs/endpoints
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from src.utils import retry_request

logger = logging.getLogger(__name__)

# USASpending award search endpoint
# Source: https://api.usaspending.gov/docs/endpoints
USASPENDING_API_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"

# Award type codes for contracts (A-D)
# Source: USASpending API docs — award_type_codes
# A = BPA Call, B = Purchase Order, C = Delivery Order, D = Definitive Contract
CONTRACT_AWARD_TYPES = ["A", "B", "C", "D"]

# Baseline date — matches site's Jan 20, 2025 inauguration anchor
# Source: CLAUDE.md § "Freshness & Baseline"
START_DATE = "2025-01-20"


def fetch_federal_spending(
    county_fips: str,
    state_abbr: str,
) -> Optional[dict]:
    """Fetch federal contract spending for a county from USASpending API.

    Replicates the query logic used by whatchanged.us but independently:
    - POST to spending_by_award endpoint
    - Filter by time period (Jan 20 2025 to today)
    - Filter by place of performance (state + county)
    - Filter by contract award types (A, B, C, D)
    - Sum Award Amount across results

    Args:
        county_fips: 5-digit county FIPS code (e.g. "53011")
        state_abbr: 2-letter state abbreviation (e.g. "WA")

    Returns:
        Dict with keys:
            - total_amount: float — sum of Award Amount across all results
            - num_awards: int — number of awards returned
            - source_url: str — API endpoint used
        Or None if the request fails.
    """
    padded = county_fips.zfill(5)
    county_code = padded[2:]  # last 3 digits = county within state

    end_date = date.today().isoformat()

    body = {
        "filters": {
            "time_period": [
                {"start_date": START_DATE, "end_date": end_date}
            ],
            "place_of_performance_locations": [
                {"country": "USA", "state": state_abbr, "county": county_code}
            ],
            "award_type_codes": CONTRACT_AWARD_TYPES,
        },
        "fields": ["Award ID", "Recipient Name", "Award Amount", "Award Type"],
        "page": 1,
        "limit": 100,
        "sort": "Award Amount",
        "order": "desc",
    }

    try:
        response = retry_request(
            "post",
            USASPENDING_API_URL,
            json=body,
            timeout=15.0,
            retries=2,
        )
        data = response.json()

        results = data.get("results", [])
        total_amount = 0.0
        for award in results:
            amount = award.get("Award Amount")
            if isinstance(amount, (int, float)):
                total_amount += amount

        return {
            "total_amount": total_amount,
            "num_awards": len(results),
            "has_more": data.get("page_metadata", {}).get("hasNext", False),
            "source_url": USASPENDING_API_URL,
        }
    except Exception as e:
        logger.warning("USASpending API request failed for %s/%s: %s", state_abbr, county_fips, e)
        return None
