"""Tests for comparator modules."""

import pytest
from src.utils import CheckStatus
from src.comparators.gas import compare_gas_price
from src.comparators.cpi import compare_cpi
from src.comparators.unemployment import compare_unemployment
from src.comparators.tariff import compare_tariff, YALE_TARIFF_RATE
from src.comparators.rendered_vs_api import compare_rendered_vs_api, _safe_get
from src.comparators.computation import verify_computations


class TestGasComparator:
    def test_pass_within_tolerance(self):
        results = compare_gas_price(
            site_gas={"current": 4.50, "region": "SCA"},
            eia_data={"latest_price": 4.48, "area_name": "California", "latest_period": "2026-03-17"},
            aaa_data=None,
        )
        eia_result = results[0]
        assert eia_result.status == CheckStatus.PASS
        assert eia_result.check_name == "eia_price_match"

    def test_fail_outside_tolerance(self):
        results = compare_gas_price(
            site_gas={"current": 4.50},
            eia_data={"latest_price": 4.20, "area_name": "California"},
            aaa_data=None,
        )
        assert results[0].status == CheckStatus.FAIL

    def test_skip_when_eia_unavailable(self):
        # No duoarea available — EIA check should SKIP, not fall back to national
        results = compare_gas_price(
            site_gas={"current": 4.50, "region": "SCA"},
            eia_data=None,
            aaa_data=None,
        )
        eia_result = results[0]
        assert eia_result.status == CheckStatus.SKIP
        assert eia_result.check_name == "eia_price_match"

    def test_aaa_downgraded_to_warn(self):
        results = compare_gas_price(
            site_gas={"current": 4.50},
            eia_data={"latest_price": 4.48, "area_name": "CA"},
            aaa_data={"regular_price": 4.10},
        )
        aaa_result = results[1]
        assert aaa_result.status == CheckStatus.WARN
        assert aaa_result.check_name == "aaa_cross_check"

    def test_aaa_skip_when_unavailable(self):
        results = compare_gas_price(
            site_gas={"current": 4.50},
            eia_data={"latest_price": 4.48, "area_name": "CA"},
            aaa_data=None,
        )
        assert results[1].status == CheckStatus.SKIP

    def test_skip_when_no_site_data(self):
        results = compare_gas_price(
            site_gas=None,
            eia_data={"latest_price": 4.48, "area_name": "CA"},
            aaa_data=None,
        )
        assert results[0].status == CheckStatus.SKIP

    def test_large_gap_fails(self):
        # Without national fallback logic, a large gap against exact series = FAIL
        results = compare_gas_price(
            site_gas={"current": 5.02},
            eia_data={"latest_price": 3.85, "area_name": "Pacific"},
            aaa_data=None,
            tolerance_eia=0.05,
        )
        assert results[0].status == CheckStatus.FAIL


class TestCPIComparator:
    def test_pass_matching_index(self):
        results = compare_cpi(
            site_cpi={
                "groceriesCurrent": 339.865,
                "groceriesBaseline": 328.687,
                "groceriesChange": 3.4,
                "shelterChange": 3.7,
                "seriesIds": {"groceries": "CUURS49ASAF11", "shelter": "CUURS49ASAH1"},
            },
            bls_data={
                "CUURS49ASAF11": {
                    "data": [{"year": "2026", "period": "M02", "value": 339.865}],
                    "area_name": "San Francisco",
                },
                "CUURS49ASAH1": {
                    "data": [{"year": "2026", "period": "M02", "value": 400.0}],
                    "area_name": "San Francisco",
                },
            },
        )
        # Should have grocery index match, grocery pct internal consistency, and shelter present
        statuses = [r.status for r in results]
        assert CheckStatus.PASS in statuses

    def test_skip_when_no_site_cpi(self):
        results = compare_cpi(site_cpi=None, bls_data=None)
        assert results[0].status == CheckStatus.SKIP

    def test_internal_pct_change_consistency(self):
        results = compare_cpi(
            site_cpi={
                "groceriesCurrent": 330.0,
                "groceriesBaseline": 300.0,
                "groceriesChange": 10.0,  # (330-300)/300*100 = 10.0 ✓
                "seriesIds": {"groceries": "CUUR0000SAF11"},
            },
            bls_data={
                "CUUR0000SAF11": {"data": [{"year": "2026", "period": "M02", "value": 330.0}], "area_name": "US"},
            },
        )
        pct_results = [r for r in results if r.check_name == "grocery_pct_change_internal"]
        assert len(pct_results) == 1
        assert pct_results[0].status == CheckStatus.PASS


class TestUnemploymentComparator:
    def test_exact_match_passes(self):
        results = compare_unemployment(
            site_unemp={"current": 3.5, "seriesId": "LAUCN060810000000003", "countyFips": "06081"},
            bls_data={
                "LAUCN060810000000003": {
                    "data": [{"year": "2026", "period": "M01", "value": 3.5}],
                    "area_name": "San Mateo County",
                },
            },
        )
        assert results[0].status == CheckStatus.PASS

    def test_mismatch_fails(self):
        results = compare_unemployment(
            site_unemp={"current": 3.5, "seriesId": "LAUCN060810000000003"},
            bls_data={
                "LAUCN060810000000003": {
                    "data": [{"year": "2026", "period": "M01", "value": 4.0}],
                    "area_name": "San Mateo County",
                },
            },
        )
        assert results[0].status == CheckStatus.FAIL

    def test_skip_when_no_data(self):
        results = compare_unemployment(site_unemp=None, bls_data=None)
        assert results[0].status == CheckStatus.SKIP


class TestTariffComparator:
    def test_income_within_tolerance(self):
        results = compare_tariff(
            site_tariff_cost=1529.0,
            site_income=74580.0,
            census_data={"median_income": 76200.0, "year": "2023"},
        )
        income_result = [r for r in results if r.check_name == "income_vs_census"][0]
        assert income_result.status == CheckStatus.PASS

    def test_tariff_matches_yale_method(self):
        income = 74580.0
        expected = round(income * YALE_TARIFF_RATE)
        results = compare_tariff(
            site_tariff_cost=expected,
            site_income=None,
            census_data={"median_income": income, "year": "2023"},
        )
        tariff_result = [r for r in results if r.check_name == "tariff_vs_yale_method"][0]
        assert tariff_result.status == CheckStatus.PASS

    def test_skip_when_no_rendered_data(self):
        results = compare_tariff(
            site_tariff_cost=None,
            site_income=None,
            census_data=None,
        )
        assert all(r.status == CheckStatus.SKIP for r in results)


class TestRenderedVsAPI:
    def test_gas_price_rounding_match(self):
        results = compare_rendered_vs_api(
            rendered={"gas_price": 5.63},
            site_data={"gas": {"data": {"current": 5.628}}},
        )
        gas = [r for r in results if r.check_name == "gas_price_display"]
        assert len(gas) == 1
        assert gas[0].status == CheckStatus.PASS

    def test_gas_price_mismatch(self):
        results = compare_rendered_vs_api(
            rendered={"gas_price": 5.50},
            site_data={"gas": {"data": {"current": 5.628}}},
        )
        gas = [r for r in results if r.check_name == "gas_price_display"]
        assert gas[0].status == CheckStatus.FAIL

    def test_skip_on_missing_data(self):
        results = compare_rendered_vs_api(rendered={}, site_data={})
        assert results[0].status == CheckStatus.SKIP

    def test_safe_get(self):
        data = {"a": {"b": {"c": 42}}}
        assert _safe_get(data, "a", "b", "c") == 42
        assert _safe_get(data, "a", "x") is None
        assert _safe_get(data, "z") is None


class TestComputation:
    def test_gas_change_correct(self):
        results = verify_computations({
            "gas": {"data": {"current": 5.628, "baseline": 4.389, "change": 1.239, "series": [{}]}},
            "cpi": {"data": None},
            "unemployment": {"data": None},
        })
        gas = [r for r in results if r.check_name == "gas_change_recomputed"]
        assert len(gas) == 1
        assert gas[0].status == CheckStatus.PASS

    def test_gas_change_wrong(self):
        results = verify_computations({
            "gas": {"data": {"current": 5.628, "baseline": 4.389, "change": 2.0, "series": [{}]}},
        })
        gas = [r for r in results if r.check_name == "gas_change_recomputed"]
        assert gas[0].status == CheckStatus.FAIL

    def test_grocery_pct_correct(self):
        results = verify_computations({
            "gas": {"data": None},
            "cpi": {"data": {
                "groceriesCurrent": 339.865,
                "groceriesBaseline": 328.687,
                "groceriesChange": 3.4,
            }},
        })
        grocery = [r for r in results if r.check_name == "grocery_pct_recomputed"]
        assert len(grocery) == 1
        assert grocery[0].status == CheckStatus.PASS

    def test_unemployment_change_correct(self):
        results = verify_computations({
            "gas": {"data": None},
            "cpi": {"data": None},
            "unemployment": {"data": {"current": 3.5, "baseline": 3.8, "change": -0.3}},
        })
        unemp = [r for r in results if r.check_name == "unemployment_change_recomputed"]
        assert unemp[0].status == CheckStatus.PASS

    def test_skip_when_no_data(self):
        results = verify_computations({})
        assert results[0].status == CheckStatus.SKIP
