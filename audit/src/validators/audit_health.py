"""Surface the audit's own API failures as FAIL rather than silent SKIP.

When the audit's BLS or EIA calls return None, downstream cross-checks are
silently skipped — hiding the fact that the audit verified nothing. This
validator promotes those silent gaps to explicit FAIL results so they appear
in the report and alert the operator.
"""

import logging
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)


def _site_has_gas_data(site_data: dict) -> bool:
    """Return True if the site response contains non-null gas data."""
    return site_data.get("gas", {}).get("data") is not None


def _site_has_cpi_data(site_data: dict) -> bool:
    """Return True if the site response contains non-null CPI data."""
    return site_data.get("cpi", {}).get("data") is not None


def _site_has_unemployment_data(site_data: dict) -> bool:
    """Return True if the site response contains non-null unemployment data."""
    return site_data.get("unemployment", {}).get("data") is not None


def _site_has_bls_series(site_data: dict) -> bool:
    """Return True if the site has any BLS data (CPI or unemployment) to cross-check."""
    return _site_has_cpi_data(site_data) or _site_has_unemployment_data(site_data)


def verify_audit_health(
    site_data: dict,
    bls_data,
    eia_data,
    census_data=None,
) -> list[CheckResult]:
    """Check that the audit's own API calls succeeded.

    Args:
        site_data: Full API response from whatchanged.us.  If None or empty,
                   the audit could not reach the site at all.
        bls_data:  Response from the audit's BLS API call, or None on failure.
        eia_data:  Response from the audit's EIA API call, or None on failure.
        census_data: Response from the audit's Census API call (optional),
                     or None on failure.  Not currently cross-checked, so
                     always produces SKIP rather than FAIL.

    Returns:
        One CheckResult per health check performed.
    """
    results = []

    # ------------------------------------------------------------------
    # 1. Site API reachable
    # ------------------------------------------------------------------
    site_ok = bool(site_data)
    results.append(CheckResult(
        status=CheckStatus.PASS if site_ok else CheckStatus.FAIL,
        category="audit_health",
        check_name="site_api_reachable",
        site_value="present" if site_ok else None,
        message=(
            "whatchanged.us API returned data"
            if site_ok
            else "Audit could not reach whatchanged.us API"
        ),
        description=(
            "Verify the audit was able to fetch a response from the whatchanged.us "
            "/api/data/{zip} endpoint. A FAIL here means ALL downstream checks "
            "were skipped and the audit verified nothing."
        ),
    ))

    # If the site is unreachable we cannot evaluate BLS/EIA relevance, so
    # mark those as SKIP and return early.
    if not site_ok:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="audit_health",
            check_name="bls_api_reachable",
            message="Skipped — site API was unreachable",
            description="BLS reachability check skipped because site data was unavailable.",
        ))
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="audit_health",
            check_name="eia_api_reachable",
            message="Skipped — site API was unreachable",
            description="EIA reachability check skipped because site data was unavailable.",
        ))
        return results

    # ------------------------------------------------------------------
    # 2. BLS API reachable
    # ------------------------------------------------------------------
    needs_bls = _site_has_bls_series(site_data)

    if not needs_bls:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="audit_health",
            check_name="bls_api_reachable",
            message="Skipped — site has no BLS data to cross-check",
            description=(
                "BLS reachability check skipped because the site returned no CPI "
                "or unemployment data for this zip, so no BLS cross-check was needed."
            ),
        ))
    elif bls_data is None:
        results.append(CheckResult(
            status=CheckStatus.FAIL,
            category="audit_health",
            check_name="bls_api_reachable",
            message=(
                "Audit's BLS API call returned None — cross-check impossible. "
                "Check BLS_API_KEY env var."
            ),
            description=(
                "The audit attempted to call the BLS API to cross-check CPI and/or "
                "unemployment values but received no data. All BLS cross-checks were "
                "silently skipped. Verify that BLS_API_KEY is set and the BLS API is "
                "reachable."
            ),
        ))
    else:
        # Count how many series came back so the operator knows the call worked.
        series_count = 0
        if isinstance(bls_data, dict):
            series_list = bls_data.get("Results", {}).get("series", [])
            series_count = len(series_list)
        results.append(CheckResult(
            status=CheckStatus.PASS,
            category="audit_health",
            check_name="bls_api_reachable",
            source_value=series_count,
            message=f"BLS API returned data ({series_count} series)",
            description="Verify the audit's BLS API call succeeded so cross-checks are valid.",
        ))

    # ------------------------------------------------------------------
    # 3. EIA API reachable
    # ------------------------------------------------------------------
    needs_eia = _site_has_gas_data(site_data)

    if not needs_eia:
        results.append(CheckResult(
            status=CheckStatus.SKIP,
            category="audit_health",
            check_name="eia_api_reachable",
            message="Skipped — site has no gas data to cross-check",
            description=(
                "EIA reachability check skipped because the site returned no gas "
                "price data for this zip, so no EIA cross-check was needed."
            ),
        ))
    elif eia_data is None:
        results.append(CheckResult(
            status=CheckStatus.FAIL,
            category="audit_health",
            check_name="eia_api_reachable",
            message=(
                "Audit's EIA API call returned None — cross-check impossible. "
                "Check EIA_API_KEY env var."
            ),
            description=(
                "The audit attempted to call the EIA API to cross-check gas prices "
                "but received no data. All EIA gas cross-checks were silently skipped. "
                "Verify that EIA_API_KEY is set and the EIA API is reachable."
            ),
        ))
    else:
        # Count data points returned.
        data_count = 0
        if isinstance(eia_data, dict):
            data_count = len(eia_data.get("response", {}).get("data", []))
        results.append(CheckResult(
            status=CheckStatus.PASS,
            category="audit_health",
            check_name="eia_api_reachable",
            source_value=data_count,
            message=f"EIA API returned data ({data_count} records)",
            description="Verify the audit's EIA API call succeeded so cross-checks are valid.",
        ))

    return results
