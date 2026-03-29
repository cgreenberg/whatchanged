"""Verify chart time series data has sufficient historical depth for all toggle options."""

from __future__ import annotations

from src.utils import CheckResult, CheckStatus


MIN_10Y_YEAR = 2018        # 10Y from 2026 should reach at least 2018
MAX_ACCEPTABLE_YEAR = 2020  # Division-tier CPI series (introduced 2018) may start 2019–2020; WARN not FAIL


def verify_chart_depth(site_data: dict) -> list[CheckResult]:
    checks = []

    # Gas series — EIA city-level series may only have ~5 years of history;
    # PAD/state/national series go back 10+ years. Use three-tier logic.
    gas_data = site_data.get("gas", {}).get("data")
    if gas_data:
        gas_series = gas_data.get("series", [])
        if gas_series:
            earliest = _earliest_year(gas_series)
            if earliest is not None and earliest <= MIN_10Y_YEAR:
                status = CheckStatus.PASS
                note = "OK"
            elif earliest is not None and earliest <= MAX_ACCEPTABLE_YEAR:
                status = CheckStatus.WARN
                note = "limited history (EIA city-level series may have less data — expected)"
            else:
                status = CheckStatus.FAIL
                note = "TOO SHORT for 10Y — possible caching/fetch bug"
            checks.append(CheckResult(
                status=status,
                category="chart_depth",
                check_name="gas_10y_depth",
                site_value=str(earliest) if earliest else "no data",
                source_value=f"<= {MIN_10Y_YEAR} (PASS) or <= {MAX_ACCEPTABLE_YEAR} (WARN)",
                message=f"Gas series earliest year: {earliest} ({note})",
                description=f"Verify gas time series goes back to at least {MIN_10Y_YEAR} for the 10Y chart toggle.",
            ))
        else:
            checks.append(CheckResult(
                status=CheckStatus.SKIP,
                category="chart_depth",
                check_name="gas_10y_depth",
                message="No gas time series data in API response",
                description=f"Verify gas time series goes back to at least {MIN_10Y_YEAR}.",
            ))

    # CPI series (groceries, shelter, energy)
    cpi_data = site_data.get("cpi", {}).get("data")
    if cpi_data:
        for series_name in ["groceries", "shelter", "energy"]:
            series_key = f"{series_name}Series"
            series = cpi_data.get(series_key, [])
            if series:
                earliest = _earliest_year(series)
                # Division-tier CPI series were introduced in the 2018 BLS geographic
                # revision and may only go back to 2017–2020. Tiered thresholds:
                #   earliest <= MIN_10Y_YEAR (2018)  → PASS (full 10Y coverage)
                #   earliest 2019–MAX_ACCEPTABLE_YEAR (2020) → WARN (limited history,
                #       likely division-tier series; chart still renders correctly)
                #   earliest >= 2021                 → FAIL (too short, likely a bug)
                if earliest is None:
                    status = CheckStatus.FAIL
                    note = "no data"
                elif earliest <= MIN_10Y_YEAR:
                    status = CheckStatus.PASS
                    note = "OK"
                elif earliest <= MAX_ACCEPTABLE_YEAR:
                    status = CheckStatus.WARN
                    note = f"limited history (likely division-tier series introduced ~2018)"
                else:
                    status = CheckStatus.FAIL
                    note = "TOO SHORT for 10Y — possible caching/fetch bug"
                checks.append(CheckResult(
                    status=status,
                    category="chart_depth",
                    check_name=f"cpi_{series_name}_10y_depth",
                    site_value=str(earliest) if earliest else "no data",
                    source_value=f"<= {MIN_10Y_YEAR} (PASS) or <= {MAX_ACCEPTABLE_YEAR} (WARN)",
                    message=f"CPI {series_name} earliest year: {earliest} ({note})",
                    description=f"Verify CPI {series_name} time series goes back to at least {MIN_10Y_YEAR}.",
                ))
            else:
                checks.append(CheckResult(
                    status=CheckStatus.SKIP,
                    category="chart_depth",
                    check_name=f"cpi_{series_name}_10y_depth",
                    message=f"No CPI {series_name} series in API response",
                    description=f"Verify CPI {series_name} time series goes back to at least {MIN_10Y_YEAR}.",
                ))

    # Unemployment series
    # BLS LAUS county-level data only goes back ~6 years (to ~2020) — this is a
    # BLS limitation, not a bug. The 10Y chart toggle will show less data for
    # unemployment. Tiered thresholds:
    #   earliest <= MIN_10Y_YEAR (2018)  → PASS (full 10Y coverage)
    #   earliest 2019–MAX_ACCEPTABLE_YEAR (2020) → WARN (BLS LAUS limited history,
    #       expected for county-level data)
    #   earliest >= 2021                 → FAIL (too short, likely a bug)
    unemp_data = site_data.get("unemployment", {}).get("data")
    if unemp_data:
        unemp_series = unemp_data.get("series", [])
        if unemp_series:
            earliest = _earliest_year(unemp_series)
            if earliest is None:
                status = CheckStatus.FAIL
                note = "no data"
            elif earliest <= MIN_10Y_YEAR:
                status = CheckStatus.PASS
                note = "OK"
            elif earliest <= MAX_ACCEPTABLE_YEAR:
                status = CheckStatus.WARN
                note = "limited history (BLS LAUS county data — expected)"
            else:
                status = CheckStatus.FAIL
                note = "TOO SHORT for 10Y — possible caching/fetch bug"
            checks.append(CheckResult(
                status=status,
                category="chart_depth",
                check_name="unemployment_10y_depth",
                site_value=str(earliest) if earliest else "no data",
                source_value=f"<= {MIN_10Y_YEAR} (PASS) or <= {MAX_ACCEPTABLE_YEAR} (WARN)",
                message=f"Unemployment earliest year: {earliest} ({note})",
                description=f"Verify unemployment time series depth. BLS LAUS county data is limited to ~6 years.",
            ))

    return checks


def _earliest_year(series: list) -> int | None:
    years = []
    for item in series:
        if isinstance(item, dict):
            y = item.get("year")
            if y:
                try:
                    years.append(int(y))
                except (ValueError, TypeError):
                    pass
            d = item.get("date") or item.get("timestamp")
            if d and isinstance(d, str) and len(d) >= 4:
                try:
                    years.append(int(d[:4]))
                except (ValueError, TypeError):
                    pass
    return min(years) if years else None
