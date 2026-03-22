"""Tests for shared utilities."""

import pytest
import requests
from unittest.mock import patch, MagicMock

from src.utils import (
    CheckStatus,
    CheckResult,
    retry_request,
    compare_values,
)


class TestCheckResult:
    def test_creates_with_required_fields(self):
        result = CheckResult(
            status=CheckStatus.PASS,
            category="gas",
            check_name="eia_price_match",
        )
        assert result.status == CheckStatus.PASS
        assert result.category == "gas"
        assert result.screenshots == []
        assert result.details == {}

    def test_creates_with_all_fields(self):
        result = CheckResult(
            status=CheckStatus.FAIL,
            category="cpi",
            check_name="grocery_index",
            site_value=339.865,
            source_value=340.100,
            difference=0.235,
            tolerance=0.01,
            unit="index points",
            message="Index value mismatch",
        )
        assert result.difference == 0.235
        assert result.tolerance == 0.01


class TestCompareValues:
    def test_pass_within_tolerance(self):
        result = compare_values(5.63, 5.60, tolerance=0.05, unit="$/gal")
        assert result["status"] == CheckStatus.PASS
        assert result["difference"] == 0.03

    def test_fail_outside_tolerance(self):
        result = compare_values(5.63, 5.40, tolerance=0.05, unit="$/gal")
        assert result["status"] == CheckStatus.FAIL
        assert result["difference"] == 0.23

    def test_exact_match(self):
        result = compare_values(3.5, 3.5, tolerance=0.0)
        assert result["status"] == CheckStatus.PASS
        assert result["difference"] == 0.0

    def test_skip_on_none_site_value(self):
        result = compare_values(None, 5.60, tolerance=0.05)
        assert result["status"] == CheckStatus.SKIP

    def test_skip_on_none_source_value(self):
        result = compare_values(5.63, None, tolerance=0.05)
        assert result["status"] == CheckStatus.SKIP

    def test_skip_on_both_none(self):
        result = compare_values(None, None, tolerance=0.05)
        assert result["status"] == CheckStatus.SKIP

    def test_zero_source_value_no_division_error(self):
        result = compare_values(0.5, 0.0, tolerance=1.0)
        assert result["status"] == CheckStatus.PASS
        assert result["pct_difference"] == float("inf")

    def test_both_zero(self):
        result = compare_values(0.0, 0.0, tolerance=0.0)
        assert result["status"] == CheckStatus.PASS
        assert result["pct_difference"] == 0.0

    def test_negative_values(self):
        result = compare_values(-0.3, -0.5, tolerance=0.3)
        assert result["status"] == CheckStatus.PASS
        assert result["difference"] == 0.2

    def test_pct_difference_calculated(self):
        result = compare_values(110.0, 100.0, tolerance=15.0)
        assert result["pct_difference"] == 10.0


class TestRetryRequest:
    @patch("src.utils.requests.request")
    def test_success_on_first_attempt(self, mock_request):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_request.return_value = mock_response

        response = retry_request("get", "https://example.com")
        assert response.status_code == 200
        assert mock_request.call_count == 1

    @patch("src.utils.time.sleep")
    @patch("src.utils.requests.request")
    def test_retries_on_failure_then_succeeds(self, mock_request, mock_sleep):
        mock_fail = MagicMock()
        mock_fail.raise_for_status.side_effect = requests.HTTPError("500")
        mock_success = MagicMock()
        mock_success.status_code = 200
        mock_success.raise_for_status.return_value = None

        mock_request.side_effect = [mock_fail, mock_success]

        response = retry_request("get", "https://example.com", retries=2, backoff=0.01)
        assert response.status_code == 200
        assert mock_request.call_count == 2
        mock_sleep.assert_called_once()

    @patch("src.utils.time.sleep")
    @patch("src.utils.requests.request")
    def test_raises_after_all_retries_exhausted(self, mock_request, mock_sleep):
        mock_request.side_effect = requests.ConnectionError("Connection refused")

        with pytest.raises(requests.ConnectionError):
            retry_request("get", "https://example.com", retries=2, backoff=0.01)

        assert mock_request.call_count == 2

    @patch("src.utils.requests.request")
    def test_passes_kwargs_to_request(self, mock_request):
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_request.return_value = mock_response

        retry_request(
            "post",
            "https://example.com",
            json={"key": "value"},
            headers={"Auth": "Bearer token"},
        )

        mock_request.assert_called_once_with(
            "post",
            "https://example.com",
            json={"key": "value"},
            headers={"Auth": "Bearer token"},
            timeout=30.0,
        )
