"""Geographically diverse zip code selection for audits."""

import json
import random
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

CONFIG_DIR = Path(__file__).parent.parent / "config"


def load_zip_pools() -> dict:
    """Load zip code pools from config file."""
    pools_path = CONFIG_DIR / "zip_pools.json"
    with open(pools_path) as f:
        return json.load(f)


def select_audit_zips(n: int = 10, include_edge_cases: bool = True) -> list[str]:
    """Select n geographically diverse zip codes.

    Ensures at least one zip from each major region when n >= 5.
    Optionally includes 1-2 edge case zips for robustness testing.

    Args:
        n: Number of zip codes to select
        include_edge_cases: Whether to include edge case zips

    Returns:
        List of zip code strings
    """
    pools = load_zip_pools()

    # Separate edge cases from regular regions
    edge_cases = pools.pop("edge_cases", [])
    regions = list(pools.keys())

    selected = []

    # First pass: one from each region (if n allows).
    # The "rural" pool (Montana, Wyoming, Vermont, etc.) intentionally exercises
    # regional CPI paths (Tier 2 — state-level BLS regional series) because rural
    # counties are not covered by any CBSA metro CPI area.
    if n >= len(regions):
        for region in regions:
            zip_code = random.choice(pools[region])
            selected.append(zip_code)
            pools[region].remove(zip_code)

    # Fill remaining slots from all remaining zips
    remaining_zips = [z for pool in pools.values() for z in pool]
    remaining_needed = n - len(selected)

    if include_edge_cases and remaining_needed > 0:
        # Reserve 1 slot for an edge case
        edge_pick = random.choice(edge_cases) if edge_cases else None
        if edge_pick:
            remaining_needed -= 1

    if remaining_needed > 0:
        extra = random.sample(remaining_zips, min(remaining_needed, len(remaining_zips)))
        selected.extend(extra)

    if include_edge_cases and edge_pick:
        selected.append(edge_pick)

    random.shuffle(selected)
    return selected[:n]
