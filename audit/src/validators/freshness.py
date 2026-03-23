"""Check that data timestamps are recent enough.

Flags stale data that might indicate a broken cache or API pipeline.
"""

import logging
from datetime import datetime, timezone, timedelta
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

# Maximum age thresholds
FRESHNESS_THRESHOLDS = {
    "gas": timedelta(days=7),
    "cpi": timedelta(days=45),
    "unemployment": timedelta(days=45),
}


def verify_data_freshness(site_data: dict) -> list[CheckResult]:
    """Check that fetchedAt timestamps are within expected freshness windows.

    Args:
        site_data: Full API response from whatchanged.us

    Returns:
        List of CheckResult (one per data source).
    """
    results = []

    source_map = {
        "gas": site_data.get("gas", {}),
        "cpi": site_data.get("cpi", {}),
        "unemployment": site_data.get("unemployment", {}),
    }

    now = datetime.now(timezone.utc)

    for source_name, source_data in source_map.items():
        fetched_at_str = source_data.get("fetchedAt")
        threshold = FRESHNESS_THRESHOLDS.get(source_name, timedelta(days=30))

        if not fetched_at_str:
            results.append(CheckResult(
                status=CheckStatus.SKIP,
                category="freshness",
                check_name=f"freshness_{source_name}",
                message=f"No fetchedAt timestamp for {source_name}",
                description=f"Check that {source_name} data was fetched recently enough (within {threshold.days} days).",
            ))
            continue

        try:
            fetched_at = datetime.fromisoformat(fetched_at_str.replace("Z", "+00:00"))
            age = now - fetched_at

            is_fresh = age <= threshold

            results.append(CheckResult(
                status=CheckStatus.PASS if is_fresh else CheckStatus.WARN,
                category="freshness",
                check_name=f"freshness_{source_name}",
                message=(
                    f"{source_name} data is {age.days} days old "
                    f"(threshold: {threshold.days} days)"
                ),
                details={
                    "fetched_at": fetched_at_str,
                    "age_days": age.days,
                    "threshold_days": threshold.days,
                },
                description=f"Check that {source_name} data was fetched recently enough (within {threshold.days} days).",
            ))

        except (ValueError, TypeError) as e:
            results.append(CheckResult(
                status=CheckStatus.WARN,
                category="freshness",
                check_name=f"freshness_{source_name}",
                message=f"Could not parse fetchedAt for {source_name}: {e}",
                description=f"Check that {source_name} data was fetched recently enough (within {threshold.days} days).",
            ))

    return results
