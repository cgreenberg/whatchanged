"""Tests for validator modules."""

import pytest
from datetime import datetime, timezone, timedelta
from src.utils import CheckStatus
from src.validators.series_metro import verify_series_metro_mapping, _metro_names_match
from src.validators.freshness import verify_data_freshness
from src.validators.link_checker import verify_links, _is_source_link
from src.validators.baseline import verify_baselines, _find_jan_2025_in_series


class TestSeriesMetro:
    def test_matching_metro(self):
        results = verify_series_metro_mapping(
            site_data={
                "cpi": {"data": {
                    "metro": "San Francisco-Oakland-Hayward",
                    "seriesIds": {"groceries": "CUURS49ASAF11"},
                }},
            },
            bls_data={
                "CUURS49ASAF11": {
                    "area_name": "San Francisco-Oakland-Hayward, CA",
                    "series_name": "Food at home in San Francisco",
                    "data": [],
                },
            },
        )
        assert results[0].status == CheckStatus.PASS

    def test_mismatched_metro(self):
        results = verify_series_metro_mapping(
            site_data={
                "cpi": {"data": {
                    "metro": "San Francisco-Oakland-Hayward",
                    "seriesIds": {"groceries": "CUURS49ASAF11"},
                }},
            },
            bls_data={
                "CUURS49ASAF11": {
                    "area_name": "Los Angeles-Long Beach-Anaheim, CA",
                    "series_name": "",
                    "data": [],
                },
            },
        )
        assert results[0].status == CheckStatus.FAIL

    def test_skip_when_no_cpi(self):
        results = verify_series_metro_mapping(
            site_data={"cpi": {}},
            bls_data=None,
        )
        assert results[0].status == CheckStatus.SKIP


class TestMetroNameMatch:
    def test_exact_match(self):
        assert _metro_names_match("Chicago", "Chicago") is True

    def test_case_insensitive(self):
        assert _metro_names_match("CHICAGO", "chicago") is True

    def test_state_suffix_stripped(self):
        assert _metro_names_match(
            "San Francisco-Oakland-Hayward",
            "San Francisco-Oakland-Hayward, CA"
        ) is True

    def test_substring_match(self):
        assert _metro_names_match("San Francisco", "San Francisco-Oakland-Hayward") is True

    def test_no_match(self):
        assert _metro_names_match("San Francisco", "Los Angeles") is False

    def test_empty_strings(self):
        assert _metro_names_match("", "Chicago") is False
        assert _metro_names_match("Chicago", "") is False


class TestFreshness:
    def test_fresh_data(self):
        now = datetime.now(timezone.utc)
        results = verify_data_freshness({
            "gas": {"fetchedAt": now.isoformat()},
            "cpi": {"fetchedAt": now.isoformat()},
            "unemployment": {"fetchedAt": now.isoformat()},
        })
        assert all(r.status == CheckStatus.PASS for r in results)

    def test_stale_gas_data(self):
        old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        results = verify_data_freshness({
            "gas": {"fetchedAt": old},
            "cpi": {},
            "unemployment": {},
        })
        gas_result = [r for r in results if "gas" in r.check_name][0]
        assert gas_result.status == CheckStatus.WARN

    def test_missing_timestamp(self):
        results = verify_data_freshness({
            "gas": {},
            "cpi": {},
            "unemployment": {},
        })
        assert all(r.status == CheckStatus.SKIP for r in results)

    def test_z_suffix_timestamp(self):
        now = datetime.now(timezone.utc)
        ts = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        results = verify_data_freshness({
            "gas": {"fetchedAt": ts},
            "cpi": {},
            "unemployment": {},
        })
        gas_result = [r for r in results if "gas" in r.check_name][0]
        assert gas_result.status == CheckStatus.PASS


class TestLinkChecker:
    def test_is_source_link(self):
        assert _is_source_link("https://www.bls.gov/cpi/") is True
        assert _is_source_link("https://www.eia.gov/petroleum/") is True
        assert _is_source_link("https://example.com/") is False
        assert _is_source_link("/about") is False
        assert _is_source_link("") is False

    def test_skip_on_no_links(self):
        results = verify_links([])
        assert results[0].status == CheckStatus.SKIP

    def test_skip_on_no_source_links(self):
        results = verify_links([{"href": "https://example.com", "text": "Example"}])
        assert results[0].status == CheckStatus.SKIP


class TestBaseline:
    def test_gas_baseline_matches(self):
        results = verify_baselines({
            "gas": {"data": {
                "baseline": 4.389,
                "series": [
                    {"date": "2025-01-20", "price": 4.389},
                    {"date": "2026-03-17", "price": 5.628},
                ],
            }},
            "cpi": {},
            "unemployment": {},
        })
        gas = [r for r in results if r.check_name == "gas_baseline"]
        assert len(gas) == 1
        assert gas[0].status == CheckStatus.PASS

    def test_gas_baseline_tolerance_field_present(self):
        results = verify_baselines({
            "gas": {"data": {
                "baseline": 4.389,
                "series": [{"date": "2025-01-20", "price": 4.389}],
            }},
        })
        gas = [r for r in results if r.check_name == "gas_baseline"]
        assert len(gas) == 1
        assert gas[0].tolerance == 0.10

    def test_gas_baseline_passes_within_widened_tolerance(self):
        # A small difference like 0.03 (< 0.05) should PASS, not FAIL.
        results = verify_baselines({
            "gas": {"data": {
                "baseline": 4.389,
                "series": [{"date": "2025-01-20", "price": 4.36}],  # diff = 0.029
            }},
        })
        gas = [r for r in results if r.check_name == "gas_baseline"]
        assert gas[0].status == CheckStatus.PASS

    def test_gas_baseline_mismatch(self):
        results = verify_baselines({
            "gas": {"data": {
                "baseline": 4.00,
                "series": [
                    {"date": "2025-01-20", "price": 4.389},
                ],
            }},
        })
        gas = [r for r in results if r.check_name == "gas_baseline"]
        assert gas[0].status == CheckStatus.FAIL

    def test_unemployment_baseline(self):
        results = verify_baselines({
            "gas": {},
            "unemployment": {"data": {
                "baseline": 3.8,
                "series": [
                    {"date": "2025-01-01", "rate": 3.8},
                    {"date": "2026-01-01", "rate": 3.5},
                ],
            }},
        })
        unemp = [r for r in results if r.check_name == "unemployment_baseline"]
        assert unemp[0].status == CheckStatus.PASS

    def test_skip_when_no_data(self):
        results = verify_baselines({})
        assert results[0].status == CheckStatus.SKIP


class TestFindJan2025:
    def test_finds_exact_date(self):
        series = [
            {"date": "2025-01-20", "value": 4.389},
            {"date": "2025-02-20", "value": 4.500},
        ]
        assert _find_jan_2025_in_series(series) == 4.389

    def test_finds_month_prefix(self):
        series = [{"date": "2025-01", "value": 328.687}]
        assert _find_jan_2025_in_series(series) == 328.687

    def test_returns_none_when_missing(self):
        series = [{"date": "2024-12-01", "value": 300.0}]
        assert _find_jan_2025_in_series(series) is None

    def test_custom_keys(self):
        series = [{"date": "2025-01-15", "price": 4.389}]
        assert _find_jan_2025_in_series(series, value_key="price") == 4.389

    def test_prefers_jan_20_in_weekly_gas_series(self):
        # Weekly gas data has multiple Jan 2025 entries; Jan 20 must win.
        series = [
            {"date": "2025-01-06", "price": 3.114},
            {"date": "2025-01-13", "price": 3.150},
            {"date": "2025-01-20", "price": 3.213},
            {"date": "2025-01-27", "price": 3.190},
        ]
        assert _find_jan_2025_in_series(series, value_key="price") == 3.213

    def test_picks_closest_when_no_exact_jan_20(self):
        # No Jan 20 entry — Jan 13 (7 days away) is closer than Jan 27 (7 days away
        # from Jan 20); both are equidistant so either is acceptable, but the
        # function must not return the first entry blindly.
        series = [
            {"date": "2025-01-06", "price": 3.114},   # 14 days away
            {"date": "2025-01-13", "price": 3.150},   # 7 days away
            {"date": "2025-01-27", "price": 3.190},   # 7 days away
        ]
        result = _find_jan_2025_in_series(series, value_key="price")
        # Must NOT return the first entry (3.114 is 14 days away)
        assert result in (3.150, 3.190)
