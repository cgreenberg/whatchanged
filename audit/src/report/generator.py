"""Generate self-contained HTML audit report from audit results."""

import base64
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader

from src.utils import CheckStatus, CheckResult

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).parent
REPORTS_DIR = Path(__file__).parent.parent.parent / "reports"


def generate_report(
    zip_results: list[dict],
    timestamp: Optional[str] = None,
    output_dir: Optional[str] = None,
) -> str:
    """Generate a self-contained HTML audit report.

    Args:
        zip_results: List of per-zip audit results, each containing:
            - zip: str
            - location: dict with cityName, stateName, countyName
            - checks: list of CheckResult
            - screenshot_paths: list of file paths to embed
        timestamp: ISO timestamp for the report (defaults to now)
        output_dir: Directory to save the report (defaults to audit/reports/)

    Returns:
        Path to the generated HTML report file.
    """
    if timestamp is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%S")

    if output_dir is None:
        output_dir = str(REPORTS_DIR)

    os.makedirs(output_dir, exist_ok=True)

    # Compute summary statistics
    all_checks = []
    for zr in zip_results:
        all_checks.extend(zr.get("checks", []))

    counts = _count_statuses(all_checks)
    overall_verdict = _compute_verdict(counts)
    critical_findings = _extract_findings(all_checks, CheckStatus.FAIL)
    advisory_findings = _extract_findings(all_checks, CheckStatus.WARN)

    # Prepare template data
    template_zip_results = []
    for zr in zip_results:
        location = zr.get("location", {})
        location_name = _format_location(location)

        # Convert CheckResult objects to template-friendly dicts
        checks_for_template = []
        for check in zr.get("checks", []):
            if isinstance(check, CheckResult):
                checks_for_template.append({
                    "check_name": check.check_name,
                    "category": check.category,
                    "status": check.status.value,
                    "site_value": check.site_value,
                    "source_value": check.source_value,
                    "difference": check.difference,
                    "tolerance": check.tolerance,
                    "unit": check.unit,
                    "message": check.message,
                    "description": check.description,
                    "source_url": check.source_url,
                })
            else:
                checks_for_template.append(check)

        # Embed screenshots as base64
        screenshots = []
        for ss_path in zr.get("screenshot_paths", []):
            ss_data = _encode_screenshot(ss_path)
            if ss_data:
                label = Path(ss_path).stem.replace("_", " ").title()
                screenshots.append({"data": ss_data, "label": label})

        # Compute per-zip verdict
        zip_checks = zr.get("checks", [])
        zip_counts = _count_statuses(zip_checks)
        zip_verdict = _compute_verdict(zip_counts)

        template_zip_results.append({
            "zip": zr.get("zip", ""),
            "location_name": location_name,
            "verdict": zip_verdict,
            "checks": checks_for_template,
            "screenshots": screenshots,
        })

    # Render template
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=True,
    )
    template = env.get_template("template.html")

    report_date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    html = template.render(
        report_date=report_date,
        zip_count=len(zip_results),
        overall_verdict=overall_verdict,
        counts=counts,
        critical_findings=critical_findings,
        advisory_findings=advisory_findings,
        zip_results=template_zip_results,
    )

    # Save report
    filename = f"audit_{timestamp}.html"
    filepath = os.path.join(output_dir, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(html)

    logger.info("Report saved to %s", filepath)
    return filepath


def _count_statuses(checks: list) -> dict:
    """Count checks by status."""
    counts = {"pass": 0, "fail": 0, "warn": 0, "skip": 0}
    for check in checks:
        if isinstance(check, CheckResult):
            status = check.status
        elif isinstance(check, dict):
            status_val = check.get("status", "")
            try:
                status = CheckStatus(status_val) if isinstance(status_val, str) else status_val
            except ValueError:
                continue
        else:
            continue

        if status == CheckStatus.PASS:
            counts["pass"] += 1
        elif status == CheckStatus.FAIL:
            counts["fail"] += 1
        elif status == CheckStatus.WARN:
            counts["warn"] += 1
        elif status == CheckStatus.SKIP:
            counts["skip"] += 1

    return counts


def _compute_verdict(counts: dict) -> str:
    """Determine overall verdict from status counts."""
    if counts["fail"] > 0:
        return "FAIL"
    if counts["warn"] > 0 or counts["skip"] > 0:
        return "PARTIAL"
    if counts["pass"] > 0:
        return "PASS"
    return "PARTIAL"


def _extract_findings(checks: list, status: CheckStatus) -> list[str]:
    """Extract human-readable findings for a given status."""
    findings = []
    for check in checks:
        if isinstance(check, CheckResult):
            if check.status == status and check.message:
                findings.append(f"[{check.category}/{check.check_name}] {check.message}")
        elif isinstance(check, dict):
            check_status = check.get("status", "")
            if check_status == status.value and check.get("message"):
                findings.append(f"[{check.get('category', '')}/{check.get('check_name', '')}] {check['message']}")
    return findings


def _format_location(location: dict) -> str:
    """Format location dict into a readable string."""
    city = location.get("cityName", "")
    state = location.get("stateAbbr", "") or location.get("stateName", "")
    county = location.get("countyName", "")

    parts = []
    if city:
        parts.append(city)
    if state:
        parts.append(state)

    name = ", ".join(parts) if parts else "Unknown Location"

    if county:
        name += f" ({county})"

    return name


def _encode_screenshot(filepath: str) -> Optional[str]:
    """Read a screenshot file and return base64-encoded string."""
    try:
        if not os.path.exists(filepath):
            logger.warning("Screenshot not found: %s", filepath)
            return None
        with open(filepath, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")
    except Exception as e:
        logger.warning("Failed to encode screenshot %s: %s", filepath, e)
        return None
