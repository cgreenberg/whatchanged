"""Detect blank/null data cards that would show 'Data unavailable' to users.

A null data field is a FAIL (not SKIP) because it means a real card on the
site will be empty.  Territories (PR, VI, GU) are exceptions — BLS does not
publish county-level unemployment or CPI data for them, so null values there
are expected and produce a WARN instead of FAIL.
"""

import logging
from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

# US territories where BLS county/metro data is not published.
# Unemployment and CPI null values are expected limitations, not bugs.
TERRITORY_ABBRS = {"PR", "VI", "GU", "AS", "MP"}


def _is_territory(site_data: dict) -> bool:
    """Return True if the zip belongs to a US territory."""
    state_abbr = site_data.get("location", {}).get("stateAbbr", "")
    return state_abbr.upper() in TERRITORY_ABBRS


def verify_completeness(site_data: dict) -> list[CheckResult]:
    """Check that each data card has non-null data so no card shows 'Data unavailable'.

    Args:
        site_data: Full API response from whatchanged.us (the ``/api/data/{zip}``
                   JSON blob passed through by the audit runner).

    Returns:
        One CheckResult per data field checked.
    """
    results = []
    is_territory = _is_territory(site_data)
    territory_note = " (territory — expected limitation)" if is_territory else ""

    # ------------------------------------------------------------------
    # 1. Gas data
    # ------------------------------------------------------------------
    gas_data = site_data.get("gas", {}).get("data")
    results.append(CheckResult(
        status=CheckStatus.PASS if gas_data is not None else CheckStatus.FAIL,
        category="completeness",
        check_name="gas_data_present",
        site_value=None if gas_data is None else "present",
        message=(
            "Gas data present"
            if gas_data is not None
            else "Gas data is null — card will show 'Data unavailable'"
        ),
        description="Verify gas price data is non-null so the Gas Prices card renders real numbers.",
    ))

    # ------------------------------------------------------------------
    # 2. CPI data (groceries + shelter + energy)
    # ------------------------------------------------------------------
    cpi_data = site_data.get("cpi", {}).get("data")
    if is_territory:
        cpi_status = CheckStatus.WARN if cpi_data is None else CheckStatus.PASS
        cpi_null_msg = f"CPI data is null{territory_note} — card will show 'Data unavailable'"
    else:
        cpi_status = CheckStatus.PASS if cpi_data is not None else CheckStatus.FAIL
        cpi_null_msg = "CPI data is null — card will show 'Data unavailable'"

    results.append(CheckResult(
        status=cpi_status,
        category="completeness",
        check_name="cpi_data_present",
        site_value=None if cpi_data is None else "present",
        message=(
            "CPI data present"
            if cpi_data is not None
            else cpi_null_msg
        ),
        description="Verify CPI data (groceries, shelter, energy) is non-null so those cards render.",
    ))

    # ------------------------------------------------------------------
    # 3. Unemployment data
    # ------------------------------------------------------------------
    unemployment_data = site_data.get("unemployment", {}).get("data")
    if is_territory:
        unemp_status = CheckStatus.WARN if unemployment_data is None else CheckStatus.PASS
        unemp_null_msg = f"Unemployment data is null{territory_note} — card will show 'Data unavailable'"
    else:
        unemp_status = CheckStatus.PASS if unemployment_data is not None else CheckStatus.FAIL
        unemp_null_msg = "Unemployment data is null — card will show 'Data unavailable'"

    results.append(CheckResult(
        status=unemp_status,
        category="completeness",
        check_name="unemployment_data_present",
        site_value=None if unemployment_data is None else "present",
        message=(
            "Unemployment data present"
            if unemployment_data is not None
            else unemp_null_msg
        ),
        description="Verify unemployment (BLS LAUS) data is non-null so the Unemployment chart renders.",
    ))

    # ------------------------------------------------------------------
    # 4. Federal funding cuts (field may not exist in all response versions)
    # ------------------------------------------------------------------
    if "federal" in site_data:
        federal_data = site_data.get("federal", {}).get("data")
        results.append(CheckResult(
            status=CheckStatus.PASS if federal_data is not None else CheckStatus.FAIL,
            category="completeness",
            check_name="federal_data_present",
            site_value=None if federal_data is None else "present",
            message=(
                "Federal funding data present"
                if federal_data is not None
                else "Federal funding data is null — card will show 'Data unavailable'"
            ),
            description="Verify USASpending federal cuts data is non-null so the Federal Funding card renders.",
        ))

    # ------------------------------------------------------------------
    # 5. Tariff estimate
    # ------------------------------------------------------------------
    tariff_data = site_data.get("tariff", {}).get("data")
    results.append(CheckResult(
        status=CheckStatus.PASS if tariff_data is not None else CheckStatus.FAIL,
        category="completeness",
        check_name="tariff_data_present",
        site_value=None if tariff_data is None else "present",
        message=(
            "Tariff data present"
            if tariff_data is not None
            else "Tariff data is null — card will show 'Data unavailable'"
        ),
        description=(
            "Verify tariff estimate data is non-null. "
            "This is derived from Census ACS income data (median_income × 0.0205) "
            "so null usually means the Census crosswalk is missing for this zip."
        ),
    ))

    # ------------------------------------------------------------------
    # 6. City name (WARN, not FAIL — some rural zips may have no city name)
    # ------------------------------------------------------------------
    location = site_data.get("location", {})
    city_name = location.get("cityName", "")
    has_city = bool(city_name and city_name.strip())

    results.append(CheckResult(
        status=CheckStatus.PASS if has_city else CheckStatus.WARN,
        category="completeness",
        check_name="city_name_present",
        site_value=city_name if has_city else None,
        message=(
            f"City name present: '{city_name}'"
            if has_city
            else "City name is empty or missing — location banner may show blank city"
        ),
        description=(
            "Verify a city name is available for the location banner. "
            "Missing city names produce a degraded but not broken UI."
        ),
    ))

    return results
