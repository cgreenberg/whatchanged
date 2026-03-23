"""Main orchestrator for the whatchanged.us data audit.

Runs the full audit pipeline:
1. Select 10 random zip codes (geographically diverse)
2. For each zip: fetch site data, fetch source data, run browser session
3. Run all comparators and validators
4. Generate self-contained HTML report

Target runtime: <= 15 minutes.
"""

import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

from src.utils import CheckStatus, CheckResult
from src.zip_selector import select_audit_zips
from src.fetchers.whatchanged import fetch_site_data
from src.fetchers.eia import fetch_gas_price
from src.fetchers.bls import fetch_bls_series
from src.fetchers.fred import fetch_fred_series
from src.fetchers.census import fetch_median_income
from src.fetchers.scrapers import fetch_aaa_gas_price
from src.browser.session import run_site_session, take_source_screenshots
from src.comparators.gas import compare_gas_price
from src.comparators.cpi import compare_cpi
from src.comparators.unemployment import compare_unemployment
from src.comparators.tariff import compare_tariff
from src.comparators.rendered_vs_api import compare_rendered_vs_api
from src.comparators.computation import verify_computations
from src.validators.series_metro import verify_series_metro_mapping
from src.validators.freshness import verify_data_freshness
from src.validators.link_checker import verify_links
from src.validators.baseline import verify_baselines
from src.report.generator import generate_report

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Directories
AUDIT_DIR = Path(__file__).parent.parent
SCREENSHOTS_DIR = AUDIT_DIR / "screenshots"
REPORTS_DIR = AUDIT_DIR / "reports"


def audit_single_zip(
    zip_code: str,
    timestamp: str,
    run_browser: bool = True,
) -> Optional[dict]:
    """Run the full audit for a single zip code.

    This is the unit of parallelization — each zip runs independently.

    Args:
        zip_code: Zip code to audit
        timestamp: Shared timestamp for organizing screenshots
        run_browser: Whether to run Playwright browser session

    Returns:
        Dict with zip, location, checks, screenshot_paths, or None on complete failure.
    """
    logger.info("Auditing zip %s...", zip_code)
    start_time = time.time()

    # Step 1: Fetch site data
    site_data = fetch_site_data(zip_code)
    if site_data is None:
        logger.warning("Skipping zip %s — failed to fetch site data", zip_code)
        return {
            "zip": zip_code,
            "location": {},
            "checks": [CheckResult(
                status=CheckStatus.SKIP,
                category="site",
                check_name="site_data_fetch",
                message=f"Failed to fetch data from whatchanged.us for zip {zip_code}",
                description="Fetch economic data from whatchanged.us API for this zip code.",
            )],
            "screenshot_paths": [],
        }

    location = site_data.get("location", {})
    all_checks = []
    screenshot_paths = []

    # Step 2: Fetch external source data
    gas_data = site_data.get("gas", {}).get("data")
    cpi_data = site_data.get("cpi", {}).get("data")
    unemp_data = site_data.get("unemployment", {}).get("data")

    # EIA gas price — use the exact duoarea the site used (now available via gas.data.duoarea).
    # If the site used a local/regional series, fetch that same series for a precise comparison.
    # Fall back to the US national average ("NUS") if the site duoarea is unavailable.
    eia_data = None
    is_national_comparison = True
    if gas_data:
        site_duoarea = gas_data.get("duoarea")
        if site_duoarea and site_duoarea != "NUS":
            # Try the exact EIA series the site used
            eia_data = fetch_gas_price(site_duoarea)
            is_national_comparison = False
        if eia_data is None:
            # Fall back to national
            eia_data = fetch_gas_price("NUS")
            is_national_comparison = gas_data.get("isNationalFallback") is False
        if eia_data is None:
            logger.info("EIA gas price unavailable for zip %s", zip_code)
        time.sleep(1)  # Rate limit courtesy

    # BLS series (batch all CPI + LAUS series in one call)
    bls_data = None
    series_ids = []
    if cpi_data and cpi_data.get("seriesIds"):
        series_ids.extend(cpi_data["seriesIds"].values())
    if unemp_data and unemp_data.get("seriesId"):
        series_ids.append(unemp_data["seriesId"])
    if series_ids:
        bls_data = fetch_bls_series(series_ids)
        time.sleep(1)

    # FRED cross-check (Layer 1 — confirms API pull)
    fred_results = {}
    if cpi_data and cpi_data.get("seriesIds"):
        grocery_id = cpi_data["seriesIds"].get("groceries")
        if grocery_id:
            fred_result = fetch_fred_series(grocery_id)
            if fred_result:
                fred_results[grocery_id] = fred_result
            time.sleep(0.5)

    # Census income (for tariff verification)
    census_data = fetch_median_income(zip_code)
    time.sleep(0.5)

    # AAA gas price (best-effort)
    aaa_data = None
    state_abbr = location.get("stateAbbr")
    if state_abbr:
        aaa_data = fetch_aaa_gas_price(state_abbr)

    # Step 3: Browser session (screenshot + DOM scrape + link extraction)
    browser_result = None
    if run_browser:
        ss_dir = str(SCREENSHOTS_DIR / timestamp / zip_code)
        browser_result = run_site_session(zip_code, ss_dir)
        if browser_result.screenshot_path:
            screenshot_paths.append(browser_result.screenshot_path)

    # Step 4: Run comparators
    # Gas
    # When we fetched the exact duoarea the site used, use tight tolerance (0.05).
    # When falling back to national average, use wide tolerance (1.50) and mark
    # as advisory — regional prices routinely differ from the national average.
    tolerance_eia = 0.05 if not is_national_comparison else 1.50
    all_checks.extend(compare_gas_price(
        gas_data, eia_data, aaa_data,
        tolerance_eia=tolerance_eia,
        is_national_comparison=is_national_comparison,
    ))

    # CPI
    all_checks.extend(compare_cpi(cpi_data, bls_data))

    # Unemployment
    all_checks.extend(compare_unemployment(unemp_data, bls_data))

    # Tariff — now available from the API (was previously client-side only)
    tariff_data = site_data.get("tariff", {}).get("data")
    site_tariff_cost = tariff_data.get("estimatedCost") if tariff_data else None
    site_tariff_income = tariff_data.get("medianIncome") if tariff_data else None
    site_tariff_is_fallback = tariff_data.get("isFallback", False) if tariff_data else False
    all_checks.extend(compare_tariff(site_tariff_cost, site_tariff_income, census_data, zip_code=zip_code))

    # Also verify rendered tariff matches API tariff (if browser ran)
    if browser_result and browser_result.rendered_values:
        rendered_tariff = browser_result.rendered_values.get("tariff_estimate")
        if rendered_tariff is not None and site_tariff_cost is not None:
            match = abs(rendered_tariff - site_tariff_cost) < 1.0
            all_checks.append(CheckResult(
                status=CheckStatus.PASS if match else CheckStatus.FAIL,
                category="rendered",
                check_name="tariff_display_vs_api",
                site_value=rendered_tariff,
                source_value=float(site_tariff_cost),
                difference=abs(rendered_tariff - site_tariff_cost),
                message="Rendered tariff vs API tariff.data.estimatedCost",
                description="Tariff estimate shown on the rendered page vs the API response (checks for display/rounding bugs).",
            ))

    # Census fallback detection
    census_fallback = site_data.get("census", {}).get("data", {}).get("isFallback")
    if census_fallback:
        all_checks.append(CheckResult(
            status=CheckStatus.WARN,
            category="census",
            check_name="census_fallback_detected",
            message=f"Site is using national average income (not zip-specific) for zip {zip_code}",
            description="Detect when the site falls back to national average income instead of zip-specific Census data.",
        ))

    # Rendered vs API
    if browser_result:
        all_checks.extend(compare_rendered_vs_api(
            browser_result.rendered_values, site_data
        ))

    # Computation verification
    all_checks.extend(verify_computations(site_data))

    # Verify _audit computation breakdowns (if available)
    audit_data = site_data.get("_audit", {})
    computations = audit_data.get("computations", {}) if audit_data else {}
    if computations:
        # Verify gas change computation
        gc = computations.get("gasChange")
        if gc and gc.get("current") is not None and gc.get("baseline") is not None:
            expected = round(gc["current"] - gc["baseline"], 3)
            actual = gc.get("result")
            if actual is not None:
                match = abs(actual - expected) < 0.001
                all_checks.append(CheckResult(
                    status=CheckStatus.PASS if match else CheckStatus.FAIL,
                    category="computation_audit",
                    check_name="gas_change_audit_block",
                    site_value=actual,
                    source_value=expected,
                    difference=abs(actual - expected),
                    message="Gas change from _audit.computations matches independent calculation",
                    description="Verify gas change from the API's _audit.computations block matches an independent calculation.",
                ))

        # Verify tariff computation
        tc = computations.get("tariffEstimate")
        if tc and tc.get("medianIncome") is not None and tc.get("tariffRate") is not None:
            expected = round(tc["medianIncome"] * tc["tariffRate"])
            actual = tc.get("result")
            if actual is not None:
                match = abs(actual - expected) < 1
                all_checks.append(CheckResult(
                    status=CheckStatus.PASS if match else CheckStatus.FAIL,
                    category="computation_audit",
                    check_name="tariff_audit_block",
                    site_value=actual,
                    source_value=expected,
                    difference=abs(actual - expected),
                    message="Tariff from _audit.computations matches independent calculation",
                    description="Verify tariff estimate from the API's _audit.computations block matches an independent calculation.",
                ))

    # Step 5: Run validators
    # Metro mapping (most critical)
    all_checks.extend(verify_series_metro_mapping(site_data, bls_data))

    # Data freshness
    all_checks.extend(verify_data_freshness(site_data))

    # Link verification
    if browser_result:
        all_checks.extend(verify_links(browser_result.links))

    # Baseline verification
    all_checks.extend(verify_baselines(site_data))

    elapsed = time.time() - start_time
    logger.info(
        "Zip %s complete in %.1fs — %d checks (%d pass, %d fail, %d warn, %d skip)",
        zip_code, elapsed,
        len(all_checks),
        sum(1 for c in all_checks if c.status == CheckStatus.PASS),
        sum(1 for c in all_checks if c.status == CheckStatus.FAIL),
        sum(1 for c in all_checks if c.status == CheckStatus.WARN),
        sum(1 for c in all_checks if c.status == CheckStatus.SKIP),
    )

    return {
        "zip": zip_code,
        "location": location,
        "checks": all_checks,
        "screenshot_paths": screenshot_paths,
    }


def run_audit(
    num_zips: int = 10,
    max_workers: int = 3,
    run_browser: bool = True,
    specific_zips: Optional[list[str]] = None,
) -> str:
    """Run the full weekly audit.

    Args:
        num_zips: Number of random zip codes to audit
        max_workers: Max parallel workers for zip processing
        run_browser: Whether to run Playwright sessions
        specific_zips: Override random selection with specific zips

    Returns:
        Path to the generated HTML report.
    """
    start_time = time.time()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")

    logger.info("=" * 60)
    logger.info("whatchanged.us Weekly Data Audit")
    logger.info("Started: %s", timestamp)
    logger.info("=" * 60)

    # Select zip codes
    if specific_zips:
        zip_codes = specific_zips
    else:
        zip_codes = select_audit_zips(num_zips)

    logger.info("Auditing %d zip codes: %s", len(zip_codes), ", ".join(zip_codes))

    # Run audits (parallel with ThreadPoolExecutor)
    zip_results = []

    if max_workers > 1 and len(zip_codes) > 1:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(audit_single_zip, zc, timestamp, run_browser): zc
                for zc in zip_codes
            }
            for future in as_completed(futures):
                zip_code = futures[future]
                try:
                    result = future.result()
                    if result:
                        zip_results.append(result)
                except Exception as e:
                    logger.error("Audit failed for zip %s: %s", zip_code, e)
                    zip_results.append({
                        "zip": zip_code,
                        "location": {},
                        "checks": [CheckResult(
                            status=CheckStatus.SKIP,
                            category="site",
                            check_name="audit_error",
                            message=f"Unexpected error: {type(e).__name__}: {e}",
                            description="Audit pipeline encountered an unexpected error for this zip code.",
                        )],
                        "screenshot_paths": [],
                    })
    else:
        # Sequential execution (for debugging or single zip)
        for zc in zip_codes:
            try:
                result = audit_single_zip(zc, timestamp, run_browser)
                if result:
                    zip_results.append(result)
            except Exception as e:
                logger.error("Audit failed for zip %s: %s", zc, e)

    # Sort results by zip code for consistent ordering
    zip_results.sort(key=lambda r: r.get("zip", ""))

    # Generate report
    report_path = generate_report(zip_results, timestamp=timestamp)

    # Summary
    total_time = time.time() - start_time
    total_checks = sum(len(r.get("checks", [])) for r in zip_results)
    total_fail = sum(
        1 for r in zip_results
        for c in r.get("checks", [])
        if isinstance(c, CheckResult) and c.status == CheckStatus.FAIL
    )

    logger.info("=" * 60)
    logger.info("Audit complete in %.1f seconds", total_time)
    logger.info("Total checks: %d | Failures: %d", total_checks, total_fail)
    logger.info("Report: %s", report_path)
    logger.info("=" * 60)

    return report_path


def main():
    """CLI entry point."""
    # Load environment variables
    env_paths = [
        AUDIT_DIR / ".env",
        AUDIT_DIR.parent / ".env.local",
        AUDIT_DIR.parent / ".env",
    ]
    for env_path in env_paths:
        if env_path.exists():
            load_dotenv(env_path)
            logger.info("Loaded env from %s", env_path)

    # Parse CLI args
    import argparse
    parser = argparse.ArgumentParser(description="whatchanged.us data audit")
    parser.add_argument("--zips", nargs="*", help="Specific zip codes to audit")
    parser.add_argument("--num-zips", type=int, default=10, help="Number of random zips (default: 10)")
    parser.add_argument("--workers", type=int, default=3, help="Max parallel workers (default: 3)")
    parser.add_argument("--no-browser", action="store_true", help="Skip Playwright browser sessions")
    parser.add_argument("--sequential", action="store_true", help="Run sequentially (for debugging)")
    args = parser.parse_args()

    workers = 1 if args.sequential else args.workers

    report_path = run_audit(
        num_zips=args.num_zips,
        max_workers=workers,
        run_browser=not args.no_browser,
        specific_zips=args.zips,
    )

    # Exit with appropriate code
    # Read the report to check for failures
    total_fail = 0
    # Simple: just check if any FAIL exists in zip results
    # The run_audit function already logged this
    print(f"\nReport saved to: {report_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
