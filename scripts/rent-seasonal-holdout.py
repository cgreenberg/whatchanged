#!/usr/bin/env python3
"""
rent-seasonal-holdout.py — holdout check of the county rent seasonal adjustment (scripts/build-local-data.py).

Seasonal factors are fit only on leak-free ratios (ratio months <= 2024-06). This measures how much seasonality is
LEFT in each adjusted county series after that: residual seasonality = the spread (max - min) across the 12 calendar
months of the average month-over-month % change of the adjusted series over Jan 2025 .. the latest month (fully
out of sample). A perfectly
adjusted series has the same expected change in every calendar month (spread -> noise only).

Compares, per county, by n = fewest leak-free ratios in any calendar month:
  raw       no adjustment
  own       the county's own factors only
  pooled    its state's pattern only (pools from series with >= 6 ratios per month; U.S. pool if the state has < 5)
  shrunk    own log factors shrunk toward the state pattern, w = n / (n + k)  (the shipped method, k = SHRINK_K)

    python3 scripts/rent-seasonal-holdout.py --raw ../raw [--k 8 12]
"""
import argparse, importlib.util, os, warnings
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("bld", os.path.join(HERE, "build-local-data.py"))
bld = importlib.util.module_from_spec(spec); spec.loader.exec_module(bld)

# Out of sample: the first month-over-month change counted is Dec 2024 -> Jan 2025; factors are fit on ratio months
# <= 2024-06, whose centred 2x12 moving averages reach Dec 2024 only at an end point (Dec 2024 enters one centred
# average with weight 1/24; no later month is used by any factor).
WINDOW_START = "2025-01"
BUCKETS = [("0-1", 0, 1), ("2", 2, 2), ("3", 3, 3), ("4-5", 4, 5), ("6-7", 6, 7), ("8", 8, 99)]


def residual_spread(sa, months):
    """(n_series,) spread across calendar months of the mean MoM % change from WINDOW_START on (NaN if incomplete)."""
    mom = (sa[:, 1:] / sa[:, :-1] - 1) * 100
    mm = months[1:]
    cal = np.array([int(m[5:]) for m in mm])
    win = np.array([m >= WINDOW_START for m in mm])
    ok = np.isfinite(mom[:, win]).all(axis=1)
    avg = np.stack([mom[:, win & (cal == k)].mean(axis=1) for k in range(1, 13)], axis=1)
    out = avg.max(axis=1) - avg.min(axis=1)
    out[~ok] = np.nan
    return out


def main():
    warnings.simplefilter("ignore", RuntimeWarning)
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--k", type=float, nargs="*", default=[bld.SHRINK_K])
    a = ap.parse_args()
    cfips = lambda d: (d.StateCodeFIPS.str.zfill(2) + d.MunicipalCodeFIPS.str.zfill(3)).tolist()
    ck, cr, crm, _ = bld.load_zillow(os.path.join(a.raw, "zori_county.csv"), cfips)
    groups = [f[:2] for f in ck]
    factors, n = bld.seasonal_factors(cr, crm)
    pools = bld.pool_factors(factors, n, groups)
    first_ok = crm.index(bld.POOL_MAX_START)
    published = np.isfinite(cr[:, :first_ok + 1]).any(axis=1) & np.isfinite(cr[:, -1]) & np.isfinite(cr[:, crm.index(bld.BASE)])
    pool_f = np.stack([pools[g if g in pools else ""] for g in groups])
    with np.errstate(all="ignore"):
        variants = {"raw": cr, "own": bld.apply_factors(cr, crm, factors), "pooled": bld.apply_factors(cr, crm, pool_f)}
        for k in a.k:
            f, _, _ = bld.shrunk_factors(factors, n, groups, pools, k)
            variants[f"shrunk k={k:g}"] = bld.apply_factors(cr, crm, f)
        spread = {name: residual_spread(sa, crm) for name, sa in variants.items()}
    base = published & np.isfinite(spread["raw"])
    print(f"Residual seasonality, {WINDOW_START}..{crm[-1]}: spread across calendar months of the mean MoM % change "
          f"(pp; mean / median). {base.sum()} published county series with a complete window. "
          f"{len(pools) - 1} state pools (+U.S.).")
    names = list(variants)
    shrunk0 = f"shrunk k={bld.SHRINK_K:g}" if f"shrunk k={bld.SHRINK_K:g}" in variants else names[3]
    print("| n | counties | " + " | ".join(names) + f" | shrunk ({shrunk0[7:]}) beats own |")
    print("|---|---|" + "---|" * len(names) + "---|")
    rows = BUCKETS + [("all n>=2", 2, 99)]
    for label, lo, hi in rows:
        sel = base & (n >= lo) & (n <= hi)
        if not sel.any():
            continue
        cells = []
        for nm in names:
            v = spread[nm][sel]
            v = v[np.isfinite(v)]
            cells.append(f"{v.mean():.2f} / {np.median(v):.2f}" if len(v) else "—")
        both = sel & np.isfinite(spread["own"]) & np.isfinite(spread[shrunk0])
        wins = f"{(spread[shrunk0][both] < spread['own'][both]).sum()}/{both.sum()}" if both.any() else "—"
        print(f"| {label} | {sel.sum()} | " + " | ".join(cells) + f" | {wins} |")


if __name__ == "__main__":
    main()
