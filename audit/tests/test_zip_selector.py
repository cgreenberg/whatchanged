"""Tests for zip code selector."""

import json
from unittest.mock import patch

from src.zip_selector import select_audit_zips, load_zip_pools


class TestLoadZipPools:
    def test_loads_valid_json(self):
        pools = load_zip_pools()
        assert isinstance(pools, dict)
        assert "northeast" in pools
        assert "west" in pools
        # All entries should be 5-digit strings
        for region, zips in pools.items():
            for z in zips:
                assert isinstance(z, str)
                assert len(z) == 5 or z in ("00601", "96801")  # PR and HI are valid


class TestSelectAuditZips:
    def test_returns_requested_count(self):
        zips = select_audit_zips(n=10)
        assert len(zips) == 10

    def test_returns_unique_zips(self):
        zips = select_audit_zips(n=10)
        assert len(zips) == len(set(zips))

    def test_all_are_strings(self):
        zips = select_audit_zips(n=5)
        assert all(isinstance(z, str) for z in zips)

    def test_small_n(self):
        zips = select_audit_zips(n=2, include_edge_cases=False)
        assert len(zips) == 2

    def test_includes_edge_case_when_enabled(self):
        # Run multiple times to account for randomness
        edge_cases = {"00601", "96801", "04101", "99723"}
        found_edge = False
        for _ in range(20):
            zips = select_audit_zips(n=10, include_edge_cases=True)
            if any(z in edge_cases for z in zips):
                found_edge = True
                break
        assert found_edge, "Edge cases should appear when enabled"
