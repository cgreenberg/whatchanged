"""Tests for report generator."""

import os
import tempfile
import pytest

from src.utils import CheckStatus, CheckResult
from src.report.generator import (
    generate_report,
    _count_statuses,
    _compute_verdict,
    _extract_findings,
    _format_location,
    _encode_screenshot,
)


class TestCountStatuses:
    def test_counts_check_results(self):
        checks = [
            CheckResult(status=CheckStatus.PASS, category="gas", check_name="test1"),
            CheckResult(status=CheckStatus.PASS, category="gas", check_name="test2"),
            CheckResult(status=CheckStatus.FAIL, category="cpi", check_name="test3"),
            CheckResult(status=CheckStatus.WARN, category="cpi", check_name="test4"),
            CheckResult(status=CheckStatus.SKIP, category="unemp", check_name="test5"),
        ]
        counts = _count_statuses(checks)
        assert counts == {"pass": 2, "fail": 1, "warn": 1, "skip": 1}

    def test_counts_dicts(self):
        checks = [
            {"status": "PASS", "category": "gas"},
            {"status": "FAIL", "category": "cpi"},
        ]
        counts = _count_statuses(checks)
        assert counts["pass"] == 1
        assert counts["fail"] == 1

    def test_empty_list(self):
        counts = _count_statuses([])
        assert counts == {"pass": 0, "fail": 0, "warn": 0, "skip": 0}


class TestComputeVerdict:
    def test_all_pass(self):
        assert _compute_verdict({"pass": 5, "fail": 0, "warn": 0, "skip": 0}) == "PASS"

    def test_any_fail(self):
        assert _compute_verdict({"pass": 4, "fail": 1, "warn": 0, "skip": 0}) == "FAIL"

    def test_warn_no_fail(self):
        assert _compute_verdict({"pass": 4, "fail": 0, "warn": 1, "skip": 0}) == "PARTIAL"

    def test_skip_only(self):
        assert _compute_verdict({"pass": 0, "fail": 0, "warn": 0, "skip": 5}) == "PARTIAL"

    def test_no_checks(self):
        assert _compute_verdict({"pass": 0, "fail": 0, "warn": 0, "skip": 0}) == "PARTIAL"


class TestExtractFindings:
    def test_extracts_failures(self):
        checks = [
            CheckResult(status=CheckStatus.FAIL, category="gas", check_name="price", message="Price mismatch"),
            CheckResult(status=CheckStatus.PASS, category="cpi", check_name="index", message="OK"),
        ]
        findings = _extract_findings(checks, CheckStatus.FAIL)
        assert len(findings) == 1
        assert "Price mismatch" in findings[0]

    def test_no_findings(self):
        checks = [
            CheckResult(status=CheckStatus.PASS, category="gas", check_name="test", message="OK"),
        ]
        assert _extract_findings(checks, CheckStatus.FAIL) == []


class TestFormatLocation:
    def test_full_location(self):
        loc = {"cityName": "Vancouver", "stateAbbr": "WA", "countyName": "Clark County"}
        assert _format_location(loc) == "Vancouver, WA (Clark County)"

    def test_city_state_only(self):
        loc = {"cityName": "Portland", "stateAbbr": "OR"}
        assert _format_location(loc) == "Portland, OR"

    def test_empty_location(self):
        assert _format_location({}) == "Unknown Location"


class TestEncodeScreenshot:
    def test_encodes_existing_file(self):
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"\x89PNG fake image data")
            f.flush()
            result = _encode_screenshot(f.name)
            assert result is not None
            assert len(result) > 0
        os.unlink(f.name)

    def test_returns_none_for_missing_file(self):
        result = _encode_screenshot("/nonexistent/file.png")
        assert result is None


class TestGenerateReport:
    def test_generates_html_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            zip_results = [
                {
                    "zip": "98683",
                    "location": {"cityName": "Vancouver", "stateAbbr": "WA", "countyName": "Clark County"},
                    "checks": [
                        CheckResult(status=CheckStatus.PASS, category="gas", check_name="eia_match",
                                   site_value=4.50, source_value=4.48, difference=0.02),
                        CheckResult(status=CheckStatus.FAIL, category="cpi", check_name="metro_mismatch",
                                   site_value="SF", source_value="LA", message="Wrong metro"),
                    ],
                    "screenshot_paths": [],
                },
            ]

            filepath = generate_report(zip_results, timestamp="test-run", output_dir=tmpdir)
            assert os.path.exists(filepath)
            assert filepath.endswith(".html")

            with open(filepath) as f:
                html = f.read()

            assert "whatchanged.us" in html
            assert "98683" in html
            assert "Vancouver" in html
            assert "FAIL" in html
            assert "Wrong metro" in html

    def test_handles_empty_results(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            filepath = generate_report([], timestamp="empty", output_dir=tmpdir)
            assert os.path.exists(filepath)
