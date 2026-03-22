"""Tests for browser session module."""

import os
import pytest
from unittest.mock import patch, MagicMock, PropertyMock
from src.browser.session import (
    BrowserResult,
    SourceScreenshot,
    run_site_session,
    _scrape_rendered_values,
    _extract_links,
)


class TestBrowserResult:
    def test_default_values(self):
        result = BrowserResult(zip_code="98683")
        assert result.zip_code == "98683"
        assert result.screenshot_path is None
        assert result.rendered_values == {}
        assert result.links == []
        assert result.error is None


class TestSourceScreenshot:
    def test_default_success(self):
        ss = SourceScreenshot(url="https://example.com", path="/tmp/test.png")
        assert ss.success is True
        assert ss.error is None

    def test_failure(self):
        ss = SourceScreenshot(url="https://example.com", path="", success=False, error="Timeout")
        assert not ss.success


class TestScrapeRenderedValues:
    def test_extracts_gas_price(self):
        mock_page = MagicMock()
        mock_body = MagicMock()
        mock_body.inner_text.return_value = "Gas: $4.59/gal as of March 2026"
        mock_page.query_selector.return_value = mock_body
        mock_page.query_selector_all.return_value = []

        result = _scrape_rendered_values(mock_page)
        assert result["gas_price"] == 4.59

    def test_extracts_tariff_estimate(self):
        mock_page = MagicMock()
        mock_body = MagicMock()
        mock_body.inner_text.return_value = "Tariff impact: ~$1,529/yr based on local income"
        mock_page.query_selector.return_value = mock_body
        mock_page.query_selector_all.return_value = []

        result = _scrape_rendered_values(mock_page)
        assert result["tariff_estimate"] == 1529.0

    def test_extracts_grocery_pct(self):
        mock_page = MagicMock()
        mock_body = MagicMock()
        mock_body.inner_text.return_value = "Grocery Prices\n+3.4% since Jan 2025"
        mock_page.query_selector.return_value = mock_body
        mock_page.query_selector_all.return_value = []

        result = _scrape_rendered_values(mock_page)
        assert result["grocery_pct_change"] == 3.4

    def test_extracts_shelter_pct(self):
        mock_page = MagicMock()
        mock_body = MagicMock()
        mock_body.inner_text.return_value = "Housing Costs\nShelter +3.7% since Jan 2025"
        mock_page.query_selector.return_value = mock_body
        mock_page.query_selector_all.return_value = []

        result = _scrape_rendered_values(mock_page)
        assert result["shelter_pct_change"] == 3.7

    def test_handles_missing_data(self):
        mock_page = MagicMock()
        mock_body = MagicMock()
        mock_body.inner_text.return_value = "No data available"
        mock_page.query_selector.return_value = mock_body
        mock_page.query_selector_all.return_value = []

        result = _scrape_rendered_values(mock_page)
        assert "gas_price" not in result
        assert "tariff_estimate" not in result

    def test_handles_no_body(self):
        mock_page = MagicMock()
        mock_page.query_selector.return_value = None

        result = _scrape_rendered_values(mock_page)
        assert result == {}


class TestExtractLinks:
    def test_extracts_http_links(self):
        mock_page = MagicMock()
        mock_anchor1 = MagicMock()
        mock_anchor1.get_attribute.return_value = "https://www.bls.gov/cpi/"
        mock_anchor1.inner_text.return_value = "BLS CPI"

        mock_anchor2 = MagicMock()
        mock_anchor2.get_attribute.return_value = "https://www.eia.gov/"
        mock_anchor2.inner_text.return_value = "EIA"

        mock_page.query_selector_all.return_value = [mock_anchor1, mock_anchor2]

        links = _extract_links(mock_page)
        assert len(links) == 2
        assert links[0]["href"] == "https://www.bls.gov/cpi/"
        assert links[0]["text"] == "BLS CPI"

    def test_skips_relative_links(self):
        mock_page = MagicMock()
        mock_anchor = MagicMock()
        mock_anchor.get_attribute.return_value = "/about"
        mock_anchor.inner_text.return_value = "About"
        mock_page.query_selector_all.return_value = [mock_anchor]

        links = _extract_links(mock_page)
        assert len(links) == 0

    def test_handles_empty_page(self):
        mock_page = MagicMock()
        mock_page.query_selector_all.return_value = []

        links = _extract_links(mock_page)
        assert links == []


class TestRunSiteSession:
    def test_returns_error_when_playwright_import_fails(self):
        """Test behavior when playwright fails to connect."""
        # Patch the lazy import inside the function
        import sys
        import types

        # Create a fake playwright module that raises on sync_playwright
        fake_pw_module = types.ModuleType("playwright.sync_api")

        def bad_sync_playwright():
            raise Exception("Browser launch failed")

        fake_pw_module.sync_playwright = bad_sync_playwright

        with patch.dict(sys.modules, {"playwright.sync_api": fake_pw_module}):
            result = run_site_session("98683", "/tmp/test_screenshots")
        assert result.error is not None
        assert result.zip_code == "98683"

    def test_returns_result_structure(self):
        """Verify BrowserResult has expected shape even on failure."""
        result = BrowserResult(zip_code="10001")
        assert hasattr(result, "screenshot_path")
        assert hasattr(result, "rendered_values")
        assert hasattr(result, "links")
        assert hasattr(result, "full_text")
