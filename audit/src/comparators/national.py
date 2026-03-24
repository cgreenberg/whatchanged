"""National data comparator: verifies nationalSeries fields in the whatchanged.us API.

Each metric in the API response may include a nationalSeries array providing
national-average time-series data. This module:

  1. Verifies national series are present and non-empty.
  2. Applies sanity-range checks on the most recent national values.
  3. Verifies the most recent data point is fresh (not stale).
  4. Compares local values against national values to flag large divergence.

All checks use category="national".
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

# Freshness thresholds
UNEMPLOYMENT_MAX_AGE_DAYS = 60   # Monthly BLS data
CPI_MAX_AGE_DAYS = 60            # Monthly BLS data
GAS_MAX_AGE_DAYS = 14            # Weekly EIA data

# Sanity ranges for national values
UNEMPLOYMENT_RATE_MIN = 0.0
UNEMPLOYMENT_RATE_MAX = 15.0     # % — never exceeded in modern history

CPI_GROCERY_INDEX_MIN = 200.0    # BLS index; well above 200 since ~2015
CPI_GROCERY_INDEX_MAX = 500.0

CPI_SHELTER_INDEX_MIN = 200.0
CPI_SHELTER_INDEX_MAX = 500.0

GAS_PRICE_MIN = 1.0              # $/gal
GAS_PRICE_MAX = 10.0             # $/gal

# Tolerance for local vs national divergence checks
UNEMPLOYMENT_LOCAL_NATIONAL_TOLERANCE = 10.0   # percentage points
GAS_LOCAL_NATIONAL_TOLERANCE = 2.0             # $/gal


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def compare_national_data(site_data: dict) -> list[CheckResult]:
    """Verify national-level data embedded in the whatchanged.us API response.

    Args:
        site_data: Full API response from whatchanged.us for a single zip code.

    Returns:
        List of CheckResult, all with category="national".
    """
    results: list[CheckResult] = []

    unemp_data = site_data.get("unemployment", {}).get("data")
    cpi_data = site_data.get("cpi", {}).get("data")
    gas_data = site_data.get("gas", {}).get("data")

    results.extend(_check_national_unemployment(unemp_data))
    results.extend(_check_national_cpi(cpi_data))
    results.extend(_check_national_gas(gas_data))
    results.extend(_check_local_vs_national(unemp_data, cpi_data, gas_data))

    return results


# ---------------------------------------------------------------------------
# National unemployment checks
# ---------------------------------------------------------------------------

def _check_national_unemployment(unemp_data: Optional[dict]) -> list[CheckResult]:
    results: list[CheckResult] = []
    series = unemp_data.get("nationalSeries") if unemp_data else None

    # 1. Presence check
    if not series:
        results.append(CheckResult(
            status=CheckStatus.WARN,
            category="national",
            check_name="national_unemployment_present",
            message="unemployment.data.nationalSeries is missing or empty",
            description="Verify national unemployment nationalSeries is present in the API response.",
            source_url="https://www.bls.gov/lau/",
        ))
        return results

    results.append(CheckResult(
        status=CheckStatus.PASS,
        category="national",
        check_name="national_unemployment_present",
        site_value=len(series),
        message=f"nationalSeries has {len(series)} data points",
        description="Verify national unemployment nationalSeries is present in the API response.",
        source_url="https://www.bls.gov/lau/",
    ))

    # 2. Most-recent entry
    latest = _latest_entry(series)
    if latest is None:
        results.append(CheckResult(
            status=CheckStatus.WARN,
            category="national",
            check_name="national_unemployment_freshness",
            message="Could not parse a date from nationalSeries entries",
            description="Most recent national unemployment data point should be within 60 days.",
            source_url="https://www.bls.gov/lau/",
        ))
        return results

    latest_rate = latest.get("rate")

    # 3. Freshness
    results.append(_freshness_check(
        latest_date=latest["_parsed_date"],
        max_age_days=UNEMPLOYMENT_MAX_AGE_DAYS,
        check_name="national_unemployment_freshness",
        label="national unemployment",
        source_url="https://www.bls.gov/lau/",
    ))

    # 4. Sanity range
    results.append(_range_check(
        value=latest_rate,
        min_val=UNEMPLOYMENT_RATE_MIN,
        max_val=UNEMPLOYMENT_RATE_MAX,
        check_name="national_unemployment_range",
        label="national unemployment rate",
        unit="%",
        source_url="https://www.bls.gov/lau/",
    ))

    return results


# ---------------------------------------------------------------------------
# National CPI checks
# ---------------------------------------------------------------------------

def _check_national_cpi(cpi_data: Optional[dict]) -> list[CheckResult]:
    results: list[CheckResult] = []
    series = cpi_data.get("nationalSeries") if cpi_data else None

    # 1. Presence check
    if not series:
        results.append(CheckResult(
            status=CheckStatus.WARN,
            category="national",
            check_name="national_cpi_present",
            message="cpi.data.nationalSeries is missing or empty",
            description="Verify national CPI nationalSeries is present in the API response.",
            source_url="https://www.bls.gov/cpi/",
        ))
        return results

    results.append(CheckResult(
        status=CheckStatus.PASS,
        category="national",
        check_name="national_cpi_present",
        site_value=len(series),
        message=f"nationalSeries has {len(series)} data points",
        description="Verify national CPI nationalSeries is present in the API response.",
        source_url="https://www.bls.gov/cpi/",
    ))

    # 2. Most-recent entry
    latest = _latest_entry(series)
    if latest is None:
        results.append(CheckResult(
            status=CheckStatus.WARN,
            category="national",
            check_name="national_cpi_freshness",
            message="Could not parse a date from nationalSeries entries",
            description="Most recent national CPI data point should be within 60 days.",
            source_url="https://www.bls.gov/cpi/",
        ))
        return results

    # 3. Freshness
    results.append(_freshness_check(
        latest_date=latest["_parsed_date"],
        max_age_days=CPI_MAX_AGE_DAYS,
        check_name="national_cpi_freshness",
        label="national CPI",
        source_url="https://www.bls.gov/cpi/",
    ))

    # 4. Grocery index sanity
    grocery_idx = latest.get("groceries")
    results.append(_range_check(
        value=grocery_idx,
        min_val=CPI_GROCERY_INDEX_MIN,
        max_val=CPI_GROCERY_INDEX_MAX,
        check_name="national_cpi_grocery_range",
        label="national grocery CPI index",
        unit="index points",
        source_url="https://www.bls.gov/cpi/",
    ))

    # 5. Shelter index sanity
    shelter_idx = latest.get("shelter")
    results.append(_range_check(
        value=shelter_idx,
        min_val=CPI_SHELTER_INDEX_MIN,
        max_val=CPI_SHELTER_INDEX_MAX,
        check_name="national_cpi_shelter_range",
        label="national shelter CPI index",
        unit="index points",
        source_url="https://www.bls.gov/cpi/",
    ))

    return results


# ---------------------------------------------------------------------------
# National gas checks
# ---------------------------------------------------------------------------

def _check_national_gas(gas_data: Optional[dict]) -> list[CheckResult]:
    results: list[CheckResult] = []
    series = gas_data.get("nationalSeries") if gas_data else None

    # 1. Presence check
    if not series:
        results.append(CheckResult(
            status=CheckStatus.WARN,
            category="national",
            check_name="national_gas_present",
            message="gas.data.nationalSeries is missing or empty",
            description="Verify national gas price nationalSeries is present in the API response.",
            source_url="https://www.eia.gov/petroleum/gasdiesel/",
        ))
        return results

    results.append(CheckResult(
        status=CheckStatus.PASS,
        category="national",
        check_name="national_gas_present",
        site_value=len(series),
        message=f"nationalSeries has {len(series)} data points",
        description="Verify national gas price nationalSeries is present in the API response.",
        source_url="https://www.eia.gov/petroleum/gasdiesel/",
    ))

    # 2. Most-recent entry
    latest = _latest_entry(series)
    if latest is None:
        results.append(CheckResult(
            status=CheckStatus.WARN,
            category="national",
            check_name="national_gas_freshness",
            message="Could not parse a date from nationalSeries entries",
            description="Most recent national gas price data point should be within 14 days (weekly EIA data).",
            source_url="https://www.eia.gov/petroleum/gasdiesel/",
        ))
        return results

    latest_price = latest.get("price")

    # 3. Freshness (tighter — weekly EIA data)
    results.append(_freshness_check(
        latest_date=latest["_parsed_date"],
        max_age_days=GAS_MAX_AGE_DAYS,
        check_name="national_gas_freshness",
        label="national gas price",
        source_url="https://www.eia.gov/petroleum/gasdiesel/",
    ))

    # 4. Sanity range
    results.append(_range_check(
        value=latest_price,
        min_val=GAS_PRICE_MIN,
        max_val=GAS_PRICE_MAX,
        check_name="national_gas_range",
        label="national gas price",
        unit="$/gal",
        source_url="https://www.eia.gov/petroleum/gasdiesel/",
    ))

    return results


# ---------------------------------------------------------------------------
# Local vs national divergence checks
# ---------------------------------------------------------------------------

def _check_local_vs_national(
    unemp_data: Optional[dict],
    cpi_data: Optional[dict],
    gas_data: Optional[dict],
) -> list[CheckResult]:
    """Compare local values against national to catch large divergences.

    - Unemployment: local vs national within 10 percentage points (FAIL if not)
    - Grocery CPI direction: both should be moving the same direction (WARN if not)
    - Gas price: local vs national within $2/gal (FAIL if not)
    """
    results: list[CheckResult] = []

    # --- Unemployment local vs national ---
    local_unemp = unemp_data.get("current") if unemp_data else None
    national_unemp_series = unemp_data.get("nationalSeries") if unemp_data else None
    if local_unemp is not None and national_unemp_series:
        latest_national = _latest_entry(national_unemp_series)
        national_rate = latest_national.get("rate") if latest_national else None
        if national_rate is not None:
            diff = abs(local_unemp - national_rate)
            if diff <= UNEMPLOYMENT_LOCAL_NATIONAL_TOLERANCE:
                results.append(CheckResult(
                    status=CheckStatus.PASS,
                    category="national",
                    check_name="local_vs_national_unemployment",
                    site_value=local_unemp,
                    source_value=national_rate,
                    difference=round(diff, 3),
                    tolerance=UNEMPLOYMENT_LOCAL_NATIONAL_TOLERANCE,
                    unit="percentage points",
                    message=(
                        f"Local {local_unemp}% vs national {national_rate}% "
                        f"(diff {diff:.2f}pp, within {UNEMPLOYMENT_LOCAL_NATIONAL_TOLERANCE}pp tolerance)"
                    ),
                    description=(
                        "Local unemployment rate vs national average. "
                        "A difference > 10pp would be unusual and likely indicates a data mapping error."
                    ),
                    source_url="https://www.bls.gov/lau/",
                ))
            else:
                results.append(CheckResult(
                    status=CheckStatus.FAIL,
                    category="national",
                    check_name="local_vs_national_unemployment",
                    site_value=local_unemp,
                    source_value=national_rate,
                    difference=round(diff, 3),
                    tolerance=UNEMPLOYMENT_LOCAL_NATIONAL_TOLERANCE,
                    unit="percentage points",
                    message=(
                        f"Local {local_unemp}% vs national {national_rate}% — "
                        f"diff {diff:.2f}pp exceeds {UNEMPLOYMENT_LOCAL_NATIONAL_TOLERANCE}pp tolerance"
                    ),
                    description=(
                        "Local unemployment rate vs national average. "
                        "A difference > 10pp is unusual and likely indicates a data mapping error."
                    ),
                    source_url="https://www.bls.gov/lau/",
                ))

    # --- Grocery CPI direction: local vs national ---
    if cpi_data:
        local_grocery_change = cpi_data.get("groceriesChange")
        national_cpi_series = cpi_data.get("nationalSeries")
        if local_grocery_change is not None and national_cpi_series and len(national_cpi_series) >= 2:
            # Compute national grocery direction from the series
            # Sort by date descending and take the most recent vs earliest available for a comparable period
            sorted_series = _sort_series_desc(national_cpi_series)
            national_latest_entry = sorted_series[0] if sorted_series else None
            national_latest_grocery = (
                national_latest_entry.get("groceries") if national_latest_entry else None
            )

            # Find the Jan 2025 baseline entry in the national series
            national_baseline_grocery = _find_jan2025_value(national_cpi_series, "groceries")

            if national_latest_grocery is not None and national_baseline_grocery is not None:
                if national_baseline_grocery != 0:
                    national_grocery_change = (
                        (national_latest_grocery - national_baseline_grocery)
                        / national_baseline_grocery * 100
                    )
                    # Check direction agreement (both positive or both negative)
                    local_up = local_grocery_change >= 0
                    national_up = national_grocery_change >= 0
                    if local_up == national_up:
                        results.append(CheckResult(
                            status=CheckStatus.PASS,
                            category="national",
                            check_name="local_vs_national_grocery_direction",
                            site_value=round(local_grocery_change, 2),
                            source_value=round(national_grocery_change, 2),
                            unit="% change since Jan 2025",
                            message=(
                                f"Local grocery change {local_grocery_change:+.2f}% agrees in direction "
                                f"with national {national_grocery_change:+.2f}%"
                            ),
                            description=(
                                "Local grocery CPI % change vs national — both should move in the "
                                "same direction. Disagreement may indicate a series mapping error."
                            ),
                            source_url="https://www.bls.gov/cpi/",
                        ))
                    else:
                        results.append(CheckResult(
                            status=CheckStatus.WARN,
                            category="national",
                            check_name="local_vs_national_grocery_direction",
                            site_value=round(local_grocery_change, 2),
                            source_value=round(national_grocery_change, 2),
                            unit="% change since Jan 2025",
                            message=(
                                f"Local grocery change {local_grocery_change:+.2f}% DISAGREES in direction "
                                f"with national {national_grocery_change:+.2f}% — possible series mapping issue"
                            ),
                            description=(
                                "Local grocery CPI % change vs national — both should move in the "
                                "same direction. Disagreement may indicate a series mapping error."
                            ),
                            source_url="https://www.bls.gov/cpi/",
                        ))

    # --- Gas price local vs national ---
    local_gas = gas_data.get("current") if gas_data else None
    national_gas_series = gas_data.get("nationalSeries") if gas_data else None
    if local_gas is not None and national_gas_series:
        latest_national_gas = _latest_entry(national_gas_series)
        national_gas_price = latest_national_gas.get("price") if latest_national_gas else None
        if national_gas_price is not None:
            diff = abs(local_gas - national_gas_price)
            if diff <= GAS_LOCAL_NATIONAL_TOLERANCE:
                results.append(CheckResult(
                    status=CheckStatus.PASS,
                    category="national",
                    check_name="local_vs_national_gas",
                    site_value=local_gas,
                    source_value=national_gas_price,
                    difference=round(diff, 3),
                    tolerance=GAS_LOCAL_NATIONAL_TOLERANCE,
                    unit="$/gal",
                    message=(
                        f"Local ${local_gas:.3f}/gal vs national ${national_gas_price:.3f}/gal "
                        f"(diff ${diff:.2f}/gal, within ${GAS_LOCAL_NATIONAL_TOLERANCE}/gal tolerance)"
                    ),
                    description=(
                        "Local gas price vs national average. "
                        "A difference > $2/gal is unusual and may indicate a regional data error."
                    ),
                    source_url="https://www.eia.gov/petroleum/gasdiesel/",
                ))
            else:
                results.append(CheckResult(
                    status=CheckStatus.FAIL,
                    category="national",
                    check_name="local_vs_national_gas",
                    site_value=local_gas,
                    source_value=national_gas_price,
                    difference=round(diff, 3),
                    tolerance=GAS_LOCAL_NATIONAL_TOLERANCE,
                    unit="$/gal",
                    message=(
                        f"Local ${local_gas:.3f}/gal vs national ${national_gas_price:.3f}/gal — "
                        f"diff ${diff:.2f}/gal exceeds ${GAS_LOCAL_NATIONAL_TOLERANCE}/gal tolerance"
                    ),
                    description=(
                        "Local gas price vs national average. "
                        "A difference > $2/gal is unusual and may indicate a regional data error."
                    ),
                    source_url="https://www.eia.gov/petroleum/gasdiesel/",
                ))

    return results


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_date(entry: dict) -> Optional[datetime]:
    """Try to parse a date from a series entry dict.

    Tries the 'date' key first (ISO 8601 string), then falls back to
    constructing a date from 'year'/'period' (BLS-style, e.g. M01..M12).

    Returns a timezone-aware datetime or None if parsing fails.
    """
    date_str = entry.get("date")
    if date_str:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(date_str[:len(fmt) + 2].rstrip("Z"), fmt.rstrip("Z%f"))
                return dt.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        # Handle YYYY-MM format (no day component) — used by nationalSeries CPI/unemployment
        if len(date_str) == 7 and date_str[4] == "-":
            try:
                dt = datetime.strptime(date_str, "%Y-%m")
                return dt.replace(tzinfo=timezone.utc)
            except ValueError:
                pass
        # Try ISO format with fromisoformat as last resort
        try:
            # Strip trailing Z if present and add +00:00
            normalized = date_str.rstrip("Z").split(".")[0]
            dt = datetime.fromisoformat(normalized).replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            pass

    # BLS-style year + period (e.g. year=2025, period="M01")
    year = entry.get("year")
    period = entry.get("period", "")
    if year and period and period.startswith("M"):
        try:
            month = int(period[1:])
            return datetime(int(year), month, 1, tzinfo=timezone.utc)
        except (ValueError, TypeError):
            pass

    return None


def _latest_entry(series: list[dict]) -> Optional[dict]:
    """Return the most recent entry in a series, or None if series is empty.

    Attaches a '_parsed_date' key to the returned dict for downstream use.
    Does not mutate the original list.
    """
    best_entry = None
    best_date = None

    for entry in series:
        dt = _parse_date(entry)
        if dt is not None and (best_date is None or dt > best_date):
            best_date = dt
            best_entry = entry

    if best_entry is None:
        return None

    # Return a shallow copy with the parsed date attached
    result = dict(best_entry)
    result["_parsed_date"] = best_date
    return result


def _sort_series_desc(series: list[dict]) -> list[dict]:
    """Return series sorted most-recent-first, skipping entries without parseable dates."""
    dated = []
    for entry in series:
        dt = _parse_date(entry)
        if dt is not None:
            dated.append((dt, entry))
    dated.sort(key=lambda x: x[0], reverse=True)
    return [e for _, e in dated]


def _find_jan2025_value(series: list[dict], key: str) -> Optional[float]:
    """Find the value for a given key in the entry closest to January 20, 2025.

    Looks for the entry with the closest date at or before Jan 20 2025.
    """
    target = datetime(2025, 1, 20, tzinfo=timezone.utc)
    best_entry = None
    best_delta = None

    for entry in series:
        dt = _parse_date(entry)
        if dt is None:
            continue
        # Only consider entries on or before the target date
        if dt <= target:
            delta = abs((target - dt).total_seconds())
            if best_delta is None or delta < best_delta:
                best_delta = delta
                best_entry = entry

    if best_entry is None:
        return None
    return best_entry.get(key)


def _freshness_check(
    latest_date: datetime,
    max_age_days: int,
    check_name: str,
    label: str,
    source_url: str,
) -> CheckResult:
    """Return a CheckResult verifying a date is within max_age_days of today."""
    now = datetime.now(timezone.utc)
    age_days = (now - latest_date).days
    if age_days <= max_age_days:
        return CheckResult(
            status=CheckStatus.PASS,
            category="national",
            check_name=check_name,
            site_value=age_days,
            message=f"Most recent {label} data is {age_days} days old (within {max_age_days}-day threshold)",
            description=f"Most recent {label} data point should be within {max_age_days} days.",
            source_url=source_url,
        )
    return CheckResult(
        status=CheckStatus.FAIL,
        category="national",
        check_name=check_name,
        site_value=age_days,
        message=(
            f"Most recent {label} data is {age_days} days old — "
            f"exceeds {max_age_days}-day threshold (last date: {latest_date.date()})"
        ),
        description=f"Most recent {label} data point should be within {max_age_days} days.",
        source_url=source_url,
    )


def _range_check(
    value: Optional[float],
    min_val: float,
    max_val: float,
    check_name: str,
    label: str,
    unit: str,
    source_url: str,
) -> CheckResult:
    """Return a CheckResult verifying a value is within [min_val, max_val]."""
    if value is None:
        return CheckResult(
            status=CheckStatus.SKIP,
            category="national",
            check_name=check_name,
            message=f"{label} value not present in API response",
            description=f"Sanity check: {label} should be between {min_val} and {max_val} {unit}.",
            source_url=source_url,
        )

    in_range = min_val <= value <= max_val
    return CheckResult(
        status=CheckStatus.PASS if in_range else CheckStatus.FAIL,
        category="national",
        check_name=check_name,
        site_value=value,
        message=(
            f"{label} {value} {unit} is {'within' if in_range else 'OUTSIDE'} "
            f"expected range [{min_val}, {max_val}] {unit}"
        ),
        description=f"Sanity check: {label} should be between {min_val} and {max_val} {unit}.",
        source_url=source_url,
    )
