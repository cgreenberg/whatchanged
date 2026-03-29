"""Geographically diverse zip code selection for audits."""

import json
import random
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

CONFIG_DIR = Path(__file__).parent.parent / "config"

# Mandatory edge-case zips always included first.
# Each covers a distinct failure mode: CT FIPS remapping, territory graceful
# degradation, PAD sub-district gas lookup, division CPI tiers, and more.
MANDATORY_ZIPS = [
    "10001",  # NYC — metro CPI (tier 1), PAD 1B gas
    "06510",  # New Haven CT — CT unemployment FIPS remapping, division CPI (tier 2)
    "46204",  # Indianapolis IN — East North Central division, Midwest PAD 2 gas
    "84101",  # SLC UT — Mountain division
    "25301",  # Charleston WV — South Atlantic division, PAD 1C gas
    "72201",  # Little Rock AR — West South Central division, Gulf Coast PAD 3 gas
    "99723",  # Barrow AK — no state EIA gas, PAD 5 fallback
    "00601",  # Adjuntas PR — territory, national CPI (tier 4), graceful degradation
    "90210",  # Beverly Hills CA — high income (tariff), metro CPI, city EIA gas
    "78701",  # Austin TX — West South Central division, state-level EIA gas
]


def load_zip_pools() -> dict:
    """Load zip code pools from config file."""
    pools_path = CONFIG_DIR / "zip_pools.json"
    with open(pools_path) as f:
        return json.load(f)


def select_audit_zips(n: int = 10) -> list[str]:
    """Select n zip codes for auditing, always leading with mandatory edge cases.

    The first min(n, 10) slots are filled with MANDATORY_ZIPS, which cover
    known failure modes (CT FIPS remapping, territory CPI, PAD sub-districts,
    division CPI tiers, high-income tariff scaling, etc.).

    If n > 10, remaining slots are filled with random picks from the
    geographic pools defined in config/zip_pools.json.

    The final list is shuffled so execution order is randomised.

    Args:
        n: Number of zip codes to select (default: 10)

    Returns:
        List of zip code strings
    """
    mandatory_count = min(n, len(MANDATORY_ZIPS))
    selected = list(MANDATORY_ZIPS[:mandatory_count])

    remaining_needed = n - len(selected)

    if remaining_needed > 0:
        pools = load_zip_pools()
        # Drop the legacy edge_cases pool — those are now baked into MANDATORY_ZIPS
        pools.pop("edge_cases", None)

        # Collect all pool zips, excluding any already selected
        selected_set = set(selected)
        overflow_zips = [
            z for pool in pools.values() for z in pool if z not in selected_set
        ]

        extra = random.sample(overflow_zips, min(remaining_needed, len(overflow_zips)))
        selected.extend(extra)

    random.shuffle(selected)
    return selected[:n]
