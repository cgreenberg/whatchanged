"""Tests for fetcher modules."""

import pytest
from unittest.mock import patch, MagicMock

from src.fetchers.whatchanged import fetch_site_data
from src.fetchers.eia import fetch_gas_price
from src.fetchers.bls import fetch_bls_series, get_latest_value, get_jan_2025_value
from src.fetchers.fred import fetch_fred_series
from src.fetchers.census import fetch_median_income
from src.fetchers.scrapers import fetch_aaa_gas_price


class TestWhatchangedFetcher:
    @patch("src.fetchers.whatchanged.retry_request")
    def test_returns_parsed_json(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "zip": "98683",
            "location": {"cityName": "Vancouver"},
            "gas": {"data": {"current": 4.50}},
        }
        mock_request.return_value = mock_resp

        result = fetch_site_data("98683")
        assert result["zip"] == "98683"
        assert result["gas"]["data"]["current"] == 4.50

    @patch("src.fetchers.whatchanged.retry_request")
    def test_returns_none_on_api_error(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"error": "Zip code not found"}
        mock_request.return_value = mock_resp

        result = fetch_site_data("99999")
        assert result is None

    @patch("src.fetchers.whatchanged.retry_request")
    def test_returns_none_on_network_error(self, mock_request):
        import requests
        mock_request.side_effect = requests.ConnectionError("timeout")

        result = fetch_site_data("98683")
        assert result is None


class TestEIAFetcher:
    @patch.dict("os.environ", {"EIA_API_KEY": "test-key"})
    @patch("src.fetchers.eia.retry_request")
    def test_returns_latest_price(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "response": {
                "data": [
                    {"period": "2026-03-17", "value": "4.389", "area-name": "San Francisco"},
                ]
            }
        }
        mock_request.return_value = mock_resp

        result = fetch_gas_price("SCA")
        assert result["latest_price"] == 4.389
        assert result["latest_period"] == "2026-03-17"

    @patch.dict("os.environ", {}, clear=True)
    def test_returns_none_without_api_key(self):
        result = fetch_gas_price("SCA")
        assert result is None

    @patch.dict("os.environ", {"EIA_API_KEY": "test-key"})
    @patch("src.fetchers.eia.retry_request")
    def test_returns_none_on_empty_data(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"response": {"data": []}}
        mock_request.return_value = mock_resp

        result = fetch_gas_price("SCA")
        assert result is None


class TestBLSFetcher:
    @patch.dict("os.environ", {"BLS_API_KEY": "test-key"})
    @patch("src.fetchers.bls.retry_request")
    def test_returns_series_data(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "status": "REQUEST_SUCCEEDED",
            "Results": {
                "series": [{
                    "seriesID": "CUURS49ASAF11",
                    "catalog": {
                        "series_title": "Food at home in San Francisco",
                        "area": "San Francisco-Oakland-Hayward, CA",
                        "item": "Food at home",
                    },
                    "data": [
                        {"year": "2026", "period": "M02", "value": "339.865", "periodName": "February"},
                        {"year": "2025", "period": "M01", "value": "328.687", "periodName": "January"},
                    ],
                }]
            }
        }
        mock_request.return_value = mock_resp

        result = fetch_bls_series(["CUURS49ASAF11"])
        assert "CUURS49ASAF11" in result
        series = result["CUURS49ASAF11"]
        assert series["area_name"] == "San Francisco-Oakland-Hayward, CA"
        assert len(series["data"]) == 2
        assert series["data"][0]["value"] == 339.865

    @patch.dict("os.environ", {}, clear=True)
    def test_returns_none_without_api_key(self):
        result = fetch_bls_series(["CUURS49ASAF11"])
        assert result is None

    def test_get_latest_value(self):
        data = [
            {"year": "2026", "period": "M02", "value": 339.865},
            {"year": "2025", "period": "M01", "value": 328.687},
        ]
        latest = get_latest_value(data)
        assert latest["value"] == 339.865

    def test_get_latest_value_empty(self):
        assert get_latest_value([]) is None

    def test_get_jan_2025_value(self):
        data = [
            {"year": "2026", "period": "M02", "value": 339.865},
            {"year": "2025", "period": "M01", "value": 328.687},
        ]
        baseline = get_jan_2025_value(data)
        assert baseline["value"] == 328.687

    def test_get_jan_2025_value_missing(self):
        data = [{"year": "2026", "period": "M02", "value": 339.865}]
        assert get_jan_2025_value(data) is None


class TestFREDFetcher:
    @patch.dict("os.environ", {"FRED_API_KEY": "test-key"})
    @patch("src.fetchers.fred.retry_request")
    def test_returns_latest_value(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "observations": [
                {"date": "2026-02-01", "value": "339.865"},
                {"date": "2026-01-01", "value": "338.100"},
            ]
        }
        mock_request.return_value = mock_resp

        # Use a national series ID (0000 area code) — FRED carries these
        result = fetch_fred_series("CUUR0000SA0")
        assert result["latest_value"] == 339.865
        assert result["latest_date"] == "2026-02-01"

    @patch.dict("os.environ", {"FRED_API_KEY": "test-key"})
    @patch("src.fetchers.fred.retry_request")
    def test_filters_missing_values(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "observations": [
                {"date": "2026-02-01", "value": "."},
                {"date": "2026-01-01", "value": "338.100"},
            ]
        }
        mock_request.return_value = mock_resp

        # Use a national series ID (0000 area code) — FRED carries these
        result = fetch_fred_series("CUUR0000SA0")
        assert result["latest_value"] == 338.100

    @patch.dict("os.environ", {}, clear=True)
    def test_returns_none_without_api_key(self):
        # National series — gets past the regional guard, then fails on missing key
        result = fetch_fred_series("CUUR0000SA0")
        assert result is None

    def test_skips_regional_bls_cpi_series(self):
        """Regional BLS CPI series are not available on FRED — should return None without calling the API."""
        # This should short-circuit before any HTTP call
        result = fetch_fred_series("CUURS49DSAF11")
        assert result is None

    def test_skips_regional_bls_cpi_series_various(self):
        """Verify the regional guard covers multiple area code patterns."""
        regional_ids = ["CUURS49ASAF11", "CUURX400SA0L1", "CUUSA422SA0"]
        for series_id in regional_ids:
            result = fetch_fred_series(series_id)
            assert result is None, f"Expected None for regional series {series_id}"


class TestCensusFetcher:
    @patch.dict("os.environ", {"CENSUS_API_KEY": "test-key"})
    @patch("src.fetchers.census.retry_request")
    def test_returns_median_income(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.json.return_value = [
            ["B19013_001E", "zip code tabulation area"],
            ["74580", "94080"],
        ]
        mock_request.return_value = mock_resp

        result = fetch_median_income("94080")
        assert result["median_income"] == 74580.0
        assert result["zip"] == "94080"

    @patch.dict("os.environ", {"CENSUS_API_KEY": "test-key"})
    @patch("src.fetchers.census.retry_request")
    def test_returns_none_for_no_data(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.json.return_value = [
            ["B19013_001E", "zip code tabulation area"],
            ["-666666666", "00601"],
        ]
        mock_request.return_value = mock_resp

        result = fetch_median_income("00601")
        assert result is None


class TestAAAScaper:
    @patch("src.fetchers.scrapers.retry_request")
    def test_extracts_price_from_html(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.text = '<div class="price">Regular: $4.59</div>'
        mock_request.return_value = mock_resp

        result = fetch_aaa_gas_price("CA")
        assert result is not None
        assert result["regular_price"] == 4.59

    @patch("src.fetchers.scrapers.retry_request")
    def test_returns_none_on_captcha(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.text = '<div>Please complete CAPTCHA</div>'
        mock_request.return_value = mock_resp

        result = fetch_aaa_gas_price("CA")
        assert result is None

    @patch("src.fetchers.scrapers.retry_request")
    def test_returns_none_on_network_error(self, mock_request):
        mock_request.side_effect = Exception("Connection refused")

        result = fetch_aaa_gas_price("CA")
        assert result is None

    @patch("src.fetchers.scrapers.retry_request")
    def test_rejects_unreasonable_price(self, mock_request):
        mock_resp = MagicMock()
        mock_resp.text = '<div>Regular: $99.99</div>'
        mock_request.return_value = mock_resp

        result = fetch_aaa_gas_price("CA")
        assert result is None
