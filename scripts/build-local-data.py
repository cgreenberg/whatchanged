#!/usr/bin/env python3
"""
build-local-data.py — builds the county-level price datasets the site reads (home values and rent).

All inputs are free bulk files (see docs/LOCAL_DATA_SOURCES.md).
Download them into a raw dir first (scripts/fetch-local-data.sh), then:

    python3 scripts/build-local-data.py --raw ../raw --out public/data

The build reads src/lib/data/zip-county.json, ct-planning-regions.json and county-geo.json from the repo
at build time, so rebuilding after those files change picks up the new mappings without re-downloading.

Outputs
  public/data/counties.json            per-county metrics for the national map
  public/data/county/{st}.json         per-state shards of the same records plus monthly Zillow series since 2016
                                       (hvS = ZHVI levels, rentS = ZORI levels seasonally adjusted here) for the Housing graph
  public/data/counties-timeline.json   per-county % change by month since Jan 2025 (map time-lapse)
  public/data/us-housing.json          U.S. ZHVI / seasonally adjusted ZORI series (Housing graph "Show national")
  public/data/meta.json                as-of dates and source attributions
  src/lib/data/county-rent.json        county rent for the Rent card / share card / OG image

Methodology notes (details in docs/LOCAL_DATA_SOURCES.md)
  * Baseline is the Jan 2025 monthly value (matches the rest of the site).
  * ZHVI is published seasonally adjusted by Zillow. ZORI is NOT, so we seasonally adjust it here (classical
    decomposition, factors fit on 2016-2024). A series is only published if it has >= 36 months of history to
    fit factors; shorter series are dropped (never shown raw as if adjusted). Rent levels shown to users are
    the observed (unadjusted) latest values.
  * Every series must reach the common latest month of its file; stale series are dropped.
  * Connecticut legacy counties take their jobs count from a planning region (same mapping as bls.ts);
    Valdez-Cordova AK (map shape) takes Chugach's. Flagged "approx".
  * Robust outliers (|z| > 5 vs counties with >= 20k jobs) are flagged per metric and excluded from
    the "biggest movers" lists, together with approximated counties. County jobs (BLS QCEW, latest
    quarter) are used only to pick which counties are large enough for those lists.
"""
import argparse, glob, json, os, re, sys, zipfile
from collections import defaultdict
import numpy as np
import pandas as pd

BASE = "2025-01"
SERIES_START = "2016-01"
MIN_SA_HISTORY = 36  # months of in-sample seasonal ratios needed before we adjust (or publish) a series

# Sanity filters (see docs/LOCAL_DATA_SOURCES.md)
OUTLIER_Z = 5.0
OUTLIER_POOL_JOBS = 20000
MIN_GEO_COUNTIES = 3100
RENT_HERO_MIN, RENT_HERO_MAX = -30.0, 60.0  # sanity range for src/lib/data/county-rent.json


def month_cols(df):
    cols = [c for c in df.columns if re.match(r"\d{4}-\d{2}-\d{2}$", c)]
    return cols, [c[:7] for c in cols]


def month_range(first, last):
    y, m = int(first[:4]), int(first[5:])
    out = []
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}"); m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def seasonal_adjust(mat, months, additive=False, fit_end="2024-12"):
    """mat: (n_series, n_months) float array with NaNs, months contiguous.
    Returns (SA matrix, ok mask). Series with < MIN_SA_HISTORY in-sample ratios come back as NaN rows
    (ok=False), so raw data can never be published under an "adjusted" label."""
    assert months == month_range(months[0], months[-1]), "seasonal_adjust needs contiguous months"
    n, T = mat.shape
    w = np.r_[0.5, np.ones(11), 0.5] / 12.0  # centered 2x12 moving average
    cma = np.full_like(mat, np.nan)
    for t in range(6, T - 6):
        cma[:, t] = (mat[:, t - 6:t + 7] * w).sum(axis=1)  # NaN propagates if any missing
    ratio = (mat - cma) if additive else (mat / cma)
    cal = np.array([int(m[5:]) for m in months])
    fit = np.array([(SERIES_START <= m <= fit_end) for m in months])
    factors = np.full((n, 12), 0.0 if additive else 1.0)
    for k in range(1, 13):
        sel = fit & (cal == k)
        if sel.any():
            factors[:, k - 1] = np.nanmedian(ratio[:, sel], axis=1)
    if additive:
        factors -= np.nanmean(factors, axis=1, keepdims=True)
    else:
        factors /= np.nanmean(factors, axis=1, keepdims=True)
    nhist = np.isfinite(ratio[:, fit]).sum(axis=1)
    ok = (nhist >= MIN_SA_HISTORY) & np.isfinite(factors).all(axis=1)
    f = factors[:, cal - 1]
    sa = (mat - f) if additive else (mat / f)
    sa[~ok] = np.nan
    return sa, ok


def load_zillow(path, key_fn):
    df = pd.read_csv(path, dtype={"RegionID": str, "RegionName": str, "StateCodeFIPS": str, "MunicipalCodeFIPS": str})
    cols, months = month_cols(df)
    keep = [i for i, m in enumerate(months) if m >= SERIES_START]
    cols = [cols[i] for i in keep]; months = [months[i] for i in keep]
    assert months == month_range(months[0], months[-1]), f"{path}: months not contiguous"
    return key_fn(df), df[cols].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float), months, df


def change_since(mat, months, base=BASE):
    """Change from the base month to the file's common latest month. Series that don't reach the
    latest month (stale) get NaN, so every published value shares one as-of date."""
    b = mat[:, months.index(base)]
    cur = mat[:, -1]
    return b, cur, (cur / b - 1) * 100


def robust_flags(counties, key, pool):
    vals = {f: c[key] for f, c in counties.items() if key in c}
    pv = np.array([vals[f] for f in pool if f in vals], float)
    if len(pv) < 20:
        return []
    med = np.median(pv); mad = np.median(np.abs(pv - med)) * 1.4826 or 1.0
    return [f for f, v in vals.items() if abs(v - med) / mad > OUTLIER_Z]


def compact_series(row, months, digits):
    """{start: YYYY-MM, v: [...]} from the first finite month to the end; interior gaps become null."""
    ok = np.isfinite(row)
    first = int(np.argmax(ok))
    rnd = (lambda x: int(round(float(x)))) if digits == 0 else (lambda x: round(float(x), digits))
    return {"start": months[first], "v": [rnd(x) if np.isfinite(x) else None for x in row[first:]]}


def us_row(path, sa):
    """United States row of a Zillow metro file as a compact series (ZORI seasonally adjusted here)."""
    k, mat, months, _ = load_zillow(path, lambda d: d.RegionType.tolist())
    i = k.index("country")
    if sa:
        adj, ok = seasonal_adjust(mat[i:i + 1], months)
        assert ok[0], "US ZORI too short to seasonally adjust"
        return compact_series(adj[0], months, 2)
    return compact_series(mat[i], months, 0)


# Connecticut replaced counties with planning regions (091xx) in 2022. BLS/Census/Indeed publish by planning
# region; Zillow and the site's zip crosswalk use legacy counties. Mirror src/lib/api/bls.ts: copy each legacy
# county's values from its dominant planning region (src/lib/data/ct-planning-regions.json byCounty; approximation,
# flagged with "approx"). county-geo.json's lausFips overrides when present.
REGION_NAMES = {"09110": "Capitol Planning Region", "09120": "Greater Bridgeport Planning Region",
                "09130": "Lower Connecticut River Valley Planning Region", "09140": "Naugatuck Valley Planning Region",
                "09150": "Northeastern Connecticut Planning Region", "09160": "Northwest Hills Planning Region",
                "09170": "South Central Connecticut Planning Region", "09180": "Southeastern Connecticut Planning Region",
                "09190": "Western Connecticut Planning Region", "02063": "Chugach Census Area"}


def copy_regions(counties, copy_from, keys):
    """Fill keys missing on a legacy county from its source region."""
    for legacy, region in copy_from.items():
        src = counties.get(region, {})
        hit = [k for k in keys if k in src and k not in counties[legacy]]
        if hit:
            for k in hit:
                counties[legacy][k] = src[k]
            counties[legacy]["approx"] = sorted(set(counties[legacy].get("approx", [])) | set(hit))
            counties[legacy]["approxFrom"] = REGION_NAMES.get(region, region)


def load_county_geo(repo):
    """county FIPS -> {state, cpiArea, cpiName, lausFips, ...} from src/lib/data/county-geo.json (shared with
    the live site). Fails loudly if the file is missing or looks wrong."""
    p = os.path.join(repo, "src/lib/data/county-geo.json")
    if not os.path.exists(p):
        sys.exit(f"{p} is missing; refusing to build (run the county-geo build first)")
    geo = json.load(open(p))
    if not isinstance(geo, dict) or len(geo) < MIN_GEO_COUNTIES:
        sys.exit(f"county-geo.json has {len(geo) if isinstance(geo, dict) else 'no'} counties (< {MIN_GEO_COUNTIES}); refusing to build")
    return geo


def main():
    np.seterr(all="ignore")
    import warnings; warnings.filterwarnings("ignore")
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", default="public/data")
    ap.add_argument("--repo", default=".")
    a = ap.parse_args()
    R = lambda f: os.path.join(a.raw, f)
    os.makedirs(a.out, exist_ok=True)
    meta = {"baseline": BASE, "sources": {}}

    zip_county = json.load(open(os.path.join(a.repo, "src/lib/data/zip-county.json")))
    geo = load_county_geo(a.repo)
    print("county geo:", f"county-geo.json ({len(geo)} counties)")

    # County names + state for every FIPS (Census 2020 reference file; covers VA independent cities and CT legacy counties)
    names = {}
    for line in open(R("county_names.txt"), encoding="latin-1"):
        p = line.rstrip("\n").split("|")
        if len(p) >= 5 and p[1].isdigit():
            f = p[1] + p[2]
            names[f] = f"{p[4]}, {p[0]}"
    for v in zip_county.values():
        names.setdefault(v["countyFips"], f'{v["countyName"]}, {v["stateAbbr"]}')
    names["02261"] = "Valdez-Cordova Census Area, AK"

    ctp = json.load(open(os.path.join(a.repo, "src/lib/data/ct-planning-regions.json")))
    copy_from = dict(ctp["byCounty"])
    for f, g in geo.items():
        lf = g.get("lausFips")
        if f.startswith("09") and lf and lf != f:
            copy_from[f] = lf
    copy_from["02261"] = "02063"  # AK: Valdez-Cordova (map shape) split into Chugach/Copper River in 2019

    # Zillow's zip file is sorted by SizeRank: its zip order picks each county's representative (most populous) zip.
    zk = pd.read_csv(R("zhvi_zip.csv"), usecols=["RegionName"], dtype=str).RegionName.str.zfill(5).tolist()

    # ---------- County ----------
    counties = defaultdict(dict)
    cfips = lambda d: (d.StateCodeFIPS.str.zfill(2) + d.MunicipalCodeFIPS.str.zfill(3)).tolist()
    ck, chv, cm, _ = load_zillow(R("zhvi_county.csv"), cfips)
    _, cur, pct = change_since(chv, cm)
    meta["sources"]["zhvi"] = {"latest": cm[-1], "short": "Zillow ZHVI", "adjustment": "seasonally adjusted by Zillow",
                               "label": "Zillow Home Value Index (ZHVI)", "url": "https://www.zillow.com/research/data/"}
    timeline = {"months": [m for m in cm if m >= BASE], "hv": {}, "rent": {}}
    bi = cm.index(BASE)
    for i, f in enumerate(ck):
        row = (chv[i, bi:] / chv[i, bi] - 1) * 100
        if np.isfinite(row).all():
            timeline["hv"][f] = [round(float(v), 1) for v in row]
        if np.isfinite(pct[i]):
            counties[f]["hv"] = round(float(pct[i]), 1); counties[f]["hvCur"] = int(round(cur[i], -2))
            # Monthly ZHVI levels since SERIES_START for the Housing graph (Zillow-adjusted; 1 decimal so the graph reproduces `hv`)
            counties[f]["hvS"] = compact_series(chv[i], cm, 1)
    ck, cr, crm, _ = load_zillow(R("zori_county.csv"), cfips)
    cr_sa, _ = seasonal_adjust(cr, crm)
    _, _, pct = change_since(cr_sa, crm)
    meta["sources"]["zori"] = {"latest": crm[-1], "short": "Zillow ZORI", "adjustment": "seasonally adjusted by whatchanged",
                               "label": "Zillow Observed Rent Index (ZORI), asking rents on new leases", "url": "https://www.zillow.com/research/data/"}
    county_rent = {}
    bi = crm.index(BASE)
    # Rent rows use ZORI's OWN month index (ZORI and ZHVI can end in different months).
    # When they differ, the rows are aligned to timeline["rentMonths"] instead of "months".
    rent_months = [m for m in crm if m >= BASE]
    if rent_months != timeline["months"]:
        timeline["rentMonths"] = rent_months
    for i, f in enumerate(ck):
        row = (cr_sa[i, bi:] / cr_sa[i, bi] - 1) * 100
        if len(row) == len(rent_months) and np.isfinite(row).all():
            timeline["rent"][f] = [round(float(v), 1) for v in row]
        if np.isfinite(pct[i]) and np.isfinite(cr[i, -1]):
            counties[f]["rent"] = round(float(pct[i]), 1); counties[f]["rentCur"] = int(round(cr[i, -1]))  # observed level
            # Seasonally adjusted ZORI levels since SERIES_START for the Housing graph (2 decimals so the
            # graph's latest % change reproduces `rent` exactly)
            counties[f]["rentS"] = compact_series(cr_sa[i], crm, 2)
            if RENT_HERO_MIN <= pct[i] <= RENT_HERO_MAX and np.isfinite(cr[i, bi]):
                county_rent[f] = {"pct": round(float(pct[i]), 1), "baseRent": int(round(cr[i, bi])),
                                  "curRent": int(round(cr[i, -1])), "asOf": crm[-1]}

    # QCEW (latest quarter only): county jobs. Used for ONE thing: the "biggest movers" lists only rank counties with
    # >= 75,000 jobs, and the outlier pool is counties with >= 20,000 jobs. Not displayed.
    qpath = max(glob.glob(R("qcew_*.zip")))  # newest year's file holds the latest quarter
    with zipfile.ZipFile(qpath) as zf:
        q = pd.read_csv(zf.open(zf.namelist()[0]), dtype=str, usecols=["area_fips", "year", "qtr", "own_code", "industry_code", "agglvl_code", "disclosure_code", "month1_emplvl", "month2_emplvl", "month3_emplvl"])
    q = q[(q.agglvl_code == "70") & (q.own_code == "0") & (q.industry_code == "10") & ~q.area_fips.str.endswith("999")]
    q["t"] = q.year.astype(int) * 4 + q.qtr.astype(int) - 1
    q = q[q.t == q.t.max()].drop_duplicates("area_fips")
    for c_ in ["month1_emplvl", "month2_emplvl", "month3_emplvl"]:
        q[c_] = pd.to_numeric(q[c_], errors="coerce")
    q["emp_q"] = q[["month1_emplvl", "month2_emplvl", "month3_emplvl"]].mean(axis=1)
    q.loc[q.disclosure_code == "N", "emp_q"] = np.nan
    for f, e in zip(q.area_fips, q.emp_q):
        if np.isfinite(e):
            counties[f]["emp"] = int(e)
    copy_regions(counties, copy_from, ["emp"])

    # Drop rows with no map shape and no zip pointing at them: CT planning regions (values copied to legacy
    # counties above) and statewide/unknown rows. Chugach (02063) and Copper River (02066) stay: the zip
    # crosswalk points at them.
    for f in [f for f in counties if re.fullmatch(r"091[1-9]0", f) or f.endswith("000") or f.endswith("999")]:
        del counties[f]

    # Outlier flags per metric (excluded from movers lists) + documented notes
    pool = [f for f, c in counties.items() if (c.get("emp") or 0) >= OUTLIER_POOL_JOBS and "approx" not in c]
    for key in ["hv", "rent"]:
        for f in robust_flags(counties, key, pool):
            counties[f].setdefault("flags", []).append(key)

    # representative zip per county (most populous Zillow zip) so map taps can load a zip
    order = {z: i for i, z in enumerate(zk)}  # Zillow files are sorted by SizeRank
    for z, v in zip_county.items():
        f = v["countyFips"]
        if f in counties and z in order:
            cur_ = counties[f].get("z")
            if cur_ is None or order[z] < order[cur_]:
                counties[f]["z"] = z
    # Counties with no Zillow zip still get a crosswalk zip, so every map tap can load the place
    for z in sorted(zip_county):
        f = zip_county[z]["countyFips"]
        if f in counties and "z" not in counties[f]:
            counties[f]["z"] = z
    for legacy, src in copy_from.items():
        if legacy in counties and "z" not in counties[legacy] and "z" in counties.get(src, {}):
            counties[legacy]["z"] = counties[src]["z"]
    unnamed = []
    for f, c in counties.items():
        c["n"] = names.get(f) or REGION_NAMES.get(f)
        if not c["n"]:
            unnamed.append(f)
    for f in unnamed:
        del counties[f]
    print(f"dropped {len(unnamed)} counties with no known name: {unnamed[:20]}")

    SERIES_KEYS = ("hvS", "rentS")  # monthly series ship only in the per-state shards (the map file stays small)
    with open(os.path.join(a.out, "counties.json"), "w") as fh:
        json.dump({f: {k: v for k, v in c.items() if k not in SERIES_KEYS} for f, c in counties.items()}, fh,
                  separators=(",", ":"), sort_keys=True)
    # Per-state shards for the zip lookup (the map keeps the full file)
    os.makedirs(os.path.join(a.out, "county"), exist_ok=True)
    for old in glob.glob(os.path.join(a.out, "county", "*.json")):
        os.remove(old)
    by_st = defaultdict(dict)
    for f, c in counties.items():
        by_st[f[:2]][f] = c
    for st_, v in by_st.items():
        with open(os.path.join(a.out, "county", f"{st_}.json"), "w") as fh:
            json.dump(v, fh, separators=(",", ":"), sort_keys=True)

    # Server-importable county rent for the site's housing hero card. pct is the SA change since Jan 2025;
    # baseRent/curRent are OBSERVED (not adjusted) typical asking rents for Jan 2025 and the latest month.
    # A monthly dollar change consistent with pct is curRent - curRent / (1 + pct/100); curRent - baseRent
    # is the raw observed difference and includes seasonality.
    cr_out = {}
    for f, v in county_rent.items():
        if f in counties:
            cr_out[f] = dict(v, name=counties[f]["n"])
            # Outlier flag / documented note for the rent figure, so the server-rendered share card and OG
            # image can carry the same "unusual value" caveat as the page.
            if "rent" in counties[f].get("flags", []):
                cr_out[f]["flagged"] = True
            if (counties[f].get("note") or {}).get("rent"):
                cr_out[f]["note"] = counties[f]["note"]["rent"]
    with open(os.path.join(a.repo, "src/lib/data/county-rent.json"), "w") as fh:
        json.dump({"meta": {"source": "Zillow Observed Rent Index (ZORI)", "adjustment": "seasonally adjusted by whatchanged",
                            "baseMonth": BASE, "asOf": crm[-1],
                            "levels": "baseRent/curRent are observed (not seasonally adjusted) typical asking rents, $/mo",
                            "dollarChange": "monthly change consistent with pct = curRent - curRent / (1 + pct/100)"},
                   "counties": dict(sorted(cr_out.items()))}, fh, separators=(",", ":"))
    zc_cov = sum(1 for v in zip_county.values() if v["countyFips"] in cr_out)
    print(f"county-rent.json: {len(cr_out)} counties, covers {zc_cov}/{len(zip_county)} crosswalk zips ({zc_cov / len(zip_county):.1%})")

    with open(os.path.join(a.out, "counties-timeline.json"), "w") as fh:
        json.dump(timeline, fh, separators=(",", ":"))
    # U.S. comparison lines for the Housing graph (same series definitions as the county rows)
    with open(os.path.join(a.out, "us-housing.json"), "w") as fh:
        json.dump({"hvS": us_row(R("zhvi_metro.csv"), False), "rentS": us_row(R("zori_metro.csv"), True)}, fh,
                  separators=(",", ":"))
    with open(os.path.join(a.out, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(f"counties: {len(counties)}; fields:",
          {k: sum(k in c for c in counties.values()) for k in ["hv", "rent", "emp", "approx", "flags"]})


if __name__ == "__main__":
    main()
