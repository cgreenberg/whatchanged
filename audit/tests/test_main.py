"""Tests for the main orchestrator."""

import pytest
from unittest.mock import patch, MagicMock
from src.main import audit_single_zip, run_audit
from src.utils import CheckStatus, CheckResult


class TestAuditSingleZip:
    @patch("src.main.verify_baselines")
    @patch("src.main.verify_links")
    @patch("src.main.verify_data_freshness")
    @patch("src.main.verify_series_metro_mapping")
    @patch("src.main.verify_computations")
    @patch("src.main.compare_rendered_vs_api")
    @patch("src.main.compare_tariff")
    @patch("src.main.compare_unemployment")
    @patch("src.main.compare_cpi")
    @patch("src.main.compare_gas_price")
    @patch("src.main.fetch_aaa_gas_price")
    @patch("src.main.fetch_median_income")
    @patch("src.main.fetch_fred_series")
    @patch("src.main.fetch_bls_series")
    @patch("src.main.fetch_gas_price")
    @patch("src.main.fetch_site_data")
    def test_returns_results_for_valid_zip(
        self, mock_site, mock_eia, mock_bls, mock_fred, mock_census,
        mock_aaa, mock_gas_cmp, mock_cpi_cmp, mock_unemp_cmp,
        mock_tariff_cmp, mock_render_cmp, mock_compute, mock_metro,
        mock_fresh, mock_links, mock_baseline,
    ):
        mock_site.return_value = {
            "zip": "98683",
            "location": {"cityName": "Vancouver", "stateAbbr": "WA"},
            "gas": {"data": {"current": 4.50, "region": "WA"}},
            "cpi": {"data": {"seriesIds": {"groceries": "CUUR0000SAF11"}, "groceriesCurrent": 330.0}},
            "unemployment": {"data": {"current": 3.5, "seriesId": "LAUCN530110000000003"}},
        }
        mock_eia.return_value = {"latest_price": 4.48}
        mock_bls.return_value = {}
        mock_fred.return_value = None
        mock_census.return_value = {"median_income": 75000}
        mock_aaa.return_value = None

        # All comparators/validators return lists of CheckResult
        pass_result = [CheckResult(status=CheckStatus.PASS, category="test", check_name="test")]
        mock_gas_cmp.return_value = pass_result
        mock_cpi_cmp.return_value = pass_result
        mock_unemp_cmp.return_value = pass_result
        mock_tariff_cmp.return_value = pass_result
        mock_render_cmp.return_value = pass_result
        mock_compute.return_value = pass_result
        mock_metro.return_value = pass_result
        mock_fresh.return_value = pass_result
        mock_links.return_value = pass_result
        mock_baseline.return_value = pass_result

        result = audit_single_zip("98683", "test-ts", run_browser=False)

        assert result is not None
        assert result["zip"] == "98683"
        assert len(result["checks"]) > 0

    @patch("src.main.fetch_site_data")
    def test_returns_skip_on_fetch_failure(self, mock_site):
        mock_site.return_value = None

        result = audit_single_zip("99999", "test-ts", run_browser=False)
        assert result is not None
        assert result["checks"][0].status == CheckStatus.SKIP

    @patch("src.main.verify_baselines")
    @patch("src.main.verify_data_freshness")
    @patch("src.main.verify_series_metro_mapping")
    @patch("src.main.verify_computations")
    @patch("src.main.compare_tariff")
    @patch("src.main.compare_unemployment")
    @patch("src.main.compare_cpi")
    @patch("src.main.compare_gas_price")
    @patch("src.main.fetch_aaa_gas_price")
    @patch("src.main.fetch_median_income")
    @patch("src.main.fetch_fred_series")
    @patch("src.main.fetch_bls_series")
    @patch("src.main.fetch_gas_price")
    @patch("src.main.fetch_site_data")
    def test_skips_browser_when_run_browser_false(
        self, mock_site, mock_eia, mock_bls, mock_fred, mock_census,
        mock_aaa, mock_gas_cmp, mock_cpi_cmp, mock_unemp_cmp,
        mock_tariff_cmp, mock_metro, mock_compute, mock_fresh, mock_baseline,
    ):
        """When run_browser=False, no screenshot paths are returned."""
        mock_site.return_value = {
            "zip": "10001",
            "location": {"cityName": "New York", "stateAbbr": "NY"},
            "gas": {},
            "cpi": {},
            "unemployment": {},
        }
        mock_eia.return_value = None
        mock_bls.return_value = None
        mock_fred.return_value = None
        mock_census.return_value = None
        mock_aaa.return_value = None

        empty = []
        mock_gas_cmp.return_value = empty
        mock_cpi_cmp.return_value = empty
        mock_unemp_cmp.return_value = empty
        mock_tariff_cmp.return_value = empty
        mock_compute.return_value = empty
        mock_metro.return_value = empty
        mock_fresh.return_value = empty
        mock_baseline.return_value = empty

        result = audit_single_zip("10001", "test-ts", run_browser=False)

        assert result is not None
        assert result["screenshot_paths"] == []

    @patch("src.main.verify_baselines")
    @patch("src.main.verify_data_freshness")
    @patch("src.main.verify_series_metro_mapping")
    @patch("src.main.verify_computations")
    @patch("src.main.compare_tariff")
    @patch("src.main.compare_unemployment")
    @patch("src.main.compare_cpi")
    @patch("src.main.compare_gas_price")
    @patch("src.main.fetch_aaa_gas_price")
    @patch("src.main.fetch_median_income")
    @patch("src.main.fetch_fred_series")
    @patch("src.main.fetch_bls_series")
    @patch("src.main.fetch_gas_price")
    @patch("src.main.fetch_site_data")
    def test_returns_location_from_site_data(
        self, mock_site, mock_eia, mock_bls, mock_fred, mock_census,
        mock_aaa, mock_gas_cmp, mock_cpi_cmp, mock_unemp_cmp,
        mock_tariff_cmp, mock_metro, mock_compute, mock_fresh, mock_baseline,
    ):
        """Location dict is propagated from site_data into the result."""
        mock_site.return_value = {
            "zip": "60601",
            "location": {"cityName": "Chicago", "stateAbbr": "IL", "countyName": "Cook County"},
            "gas": {},
            "cpi": {},
            "unemployment": {},
        }
        mock_eia.return_value = None
        mock_bls.return_value = None
        mock_fred.return_value = None
        mock_census.return_value = None
        mock_aaa.return_value = None

        for mock in [mock_gas_cmp, mock_cpi_cmp, mock_unemp_cmp, mock_tariff_cmp,
                     mock_compute, mock_metro, mock_fresh, mock_baseline]:
            mock.return_value = []

        result = audit_single_zip("60601", "test-ts", run_browser=False)

        assert result["location"]["cityName"] == "Chicago"
        assert result["location"]["stateAbbr"] == "IL"


class TestRunAudit:
    @patch("src.main.generate_report")
    @patch("src.main.audit_single_zip")
    @patch("src.main.select_audit_zips")
    def test_runs_audit_and_generates_report(self, mock_select, mock_audit, mock_report):
        mock_select.return_value = ["98683", "10001"]
        mock_audit.return_value = {
            "zip": "98683",
            "location": {},
            "checks": [CheckResult(status=CheckStatus.PASS, category="test", check_name="test")],
            "screenshot_paths": [],
        }
        mock_report.return_value = "/tmp/audit_test.html"

        report_path = run_audit(num_zips=2, max_workers=1, run_browser=False)
        assert report_path == "/tmp/audit_test.html"
        assert mock_audit.call_count == 2

    @patch("src.main.generate_report")
    @patch("src.main.audit_single_zip")
    @patch("src.main.select_audit_zips")
    def test_handles_specific_zips(self, mock_select, mock_audit, mock_report):
        mock_audit.return_value = {
            "zip": "98683",
            "location": {},
            "checks": [],
            "screenshot_paths": [],
        }
        mock_report.return_value = "/tmp/audit_test.html"

        run_audit(specific_zips=["98683"], max_workers=1, run_browser=False)
        mock_select.assert_not_called()
        mock_audit.assert_called_once()

    @patch("src.main.generate_report")
    @patch("src.main.audit_single_zip")
    @patch("src.main.select_audit_zips")
    def test_handles_audit_exception(self, mock_select, mock_audit, mock_report):
        mock_select.return_value = ["98683"]
        mock_audit.side_effect = Exception("Unexpected error")
        mock_report.return_value = "/tmp/audit_test.html"

        # Should not raise — catches and logs
        report_path = run_audit(num_zips=1, max_workers=1, run_browser=False)
        assert report_path is not None

    @patch("src.main.generate_report")
    @patch("src.main.audit_single_zip")
    @patch("src.main.select_audit_zips")
    def test_results_sorted_by_zip(self, mock_select, mock_audit, mock_report):
        """Results should be sorted by zip code for consistent report ordering."""
        mock_select.return_value = ["90210", "10001", "60601"]
        mock_report.return_value = "/tmp/audit_test.html"

        def make_result(zc, *args, **kwargs):
            return {
                "zip": zc,
                "location": {},
                "checks": [],
                "screenshot_paths": [],
            }

        mock_audit.side_effect = make_result

        run_audit(num_zips=3, max_workers=1, run_browser=False)

        # Verify generate_report was called with sorted results
        call_args = mock_report.call_args
        zip_results_passed = call_args[0][0]
        zips = [r["zip"] for r in zip_results_passed]
        assert zips == sorted(zips)

    @patch("src.main.generate_report")
    @patch("src.main.audit_single_zip")
    @patch("src.main.select_audit_zips")
    def test_specific_zips_skips_select(self, mock_select, mock_audit, mock_report):
        """When specific_zips is provided, select_audit_zips should not be called."""
        mock_audit.return_value = {
            "zip": "78701",
            "location": {},
            "checks": [],
            "screenshot_paths": [],
        }
        mock_report.return_value = "/tmp/audit_test.html"

        run_audit(specific_zips=["78701", "04101"], max_workers=1, run_browser=False)

        mock_select.assert_not_called()
        assert mock_audit.call_count == 2

    @patch("src.main.generate_report")
    @patch("src.main.audit_single_zip")
    @patch("src.main.select_audit_zips")
    def test_parallel_execution(self, mock_select, mock_audit, mock_report):
        """With max_workers > 1, all zips should still be audited."""
        mock_select.return_value = ["98683", "10001", "60601"]
        mock_audit.return_value = {
            "zip": "98683",
            "location": {},
            "checks": [CheckResult(status=CheckStatus.PASS, category="test", check_name="test")],
            "screenshot_paths": [],
        }
        mock_report.return_value = "/tmp/audit_test.html"

        run_audit(num_zips=3, max_workers=3, run_browser=False)

        # All 3 zips should be audited
        assert mock_audit.call_count == 3
