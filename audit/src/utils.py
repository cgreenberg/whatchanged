"""Shared utilities for the audit system."""

import re
import time
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)


def _redact_url(url: str) -> str:
    """Remove API keys from URLs for safe logging."""
    return re.sub(r'(api_key|registrationkey|key)=[^&]+', r'\1=REDACTED', url, flags=re.IGNORECASE)


class CheckStatus(Enum):
    """Status of an audit check."""
    PASS = "PASS"
    FAIL = "FAIL"
    WARN = "WARN"
    SKIP = "SKIP"


@dataclass
class CheckResult:
    """Result of a single audit check."""
    status: CheckStatus
    category: str
    check_name: str
    site_value: Any = None
    source_value: Any = None
    difference: Optional[float] = None
    tolerance: Optional[float] = None
    unit: str = ""
    message: str = ""
    details: dict = field(default_factory=dict)
    screenshots: list = field(default_factory=list)


def retry_request(
    method: str,
    url: str,
    retries: int = 2,
    backoff: float = 5.0,
    timeout: float = 30.0,
    **kwargs,
) -> requests.Response:
    """Make an HTTP request with retry and exponential backoff.

    Args:
        method: HTTP method ('get' or 'post')
        url: Request URL
        retries: Number of retry attempts (total attempts = retries + 1 on first try, but we do retries total attempts)
        backoff: Base backoff time in seconds (doubles each retry)
        timeout: Request timeout in seconds
        **kwargs: Additional arguments passed to requests.request

    Returns:
        requests.Response

    Raises:
        requests.RequestException: If all retries are exhausted
    """
    kwargs.setdefault("timeout", timeout)
    last_exception = None

    for attempt in range(retries):
        try:
            response = requests.request(method, url, **kwargs)
            # Don't retry on 400 Bad Request — bad params won't improve on retry
            if response.status_code == 400:
                logger.error(
                    "Request to %s returned 400 Bad Request (bad params, not retrying)",
                    _redact_url(url),
                )
                response.raise_for_status()
            response.raise_for_status()
            return response
        except requests.RequestException as e:
            last_exception = e
            # Don't retry on 400 — it's a caller error, not a transient failure
            if hasattr(e, 'response') and e.response is not None and e.response.status_code == 400:
                raise
            if attempt < retries - 1:
                wait_time = backoff * (2 ** attempt)
                logger.warning(
                    "Request to %s failed (attempt %d/%d): %s. Retrying in %.1fs...",
                    _redact_url(url), attempt + 1, retries, e, wait_time
                )
                time.sleep(wait_time)
            else:
                logger.error(
                    "Request to %s failed after %d attempts: %s",
                    _redact_url(url), retries, e
                )

    raise last_exception


def compare_values(
    site_value: Optional[float],
    source_value: Optional[float],
    tolerance: float,
    unit: str = "",
) -> dict:
    """Compare a site value against a source value within tolerance.

    Args:
        site_value: Value from whatchanged.us
        source_value: Value from external source
        tolerance: Acceptable difference
        unit: Unit label for reporting

    Returns:
        Dict with status, difference, pct_difference, etc.
    """
    if site_value is None or source_value is None:
        return {
            "status": CheckStatus.SKIP,
            "reason": "Missing data",
            "site_value": site_value,
            "source_value": source_value,
        }

    diff = abs(site_value - source_value)
    pct_diff = (diff / abs(source_value) * 100) if source_value != 0 else (
        0.0 if diff == 0 else float("inf")
    )

    passed = diff <= tolerance

    return {
        "status": CheckStatus.PASS if passed else CheckStatus.FAIL,
        "site_value": site_value,
        "source_value": source_value,
        "difference": round(diff, 4),
        "pct_difference": round(pct_diff, 2),
        "tolerance": tolerance,
        "unit": unit,
    }
