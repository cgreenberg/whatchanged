#!/usr/bin/env python3
"""
build-local-data.py — builds the zip- and county-level "local pulse" datasets.

All inputs are free bulk files (see docs/LOCAL_DATA_SOURCES.md).
Download them into a raw dir first (scripts/fetch-local-data.sh), then:

    python3 scripts/build-local-data.py --raw ../raw --out public/data

The build reads src/lib/data/zip-county.json and (when present) src/lib/data/county-geo.json from the repo
at build time, so rebuilding after those files change picks up the new mappings without re-downloading.

Outputs
  public/data/zip/{zip3}.json   per-zip: Zillow home value + rent series, Realtor.com listing snapshot
  public/data/counties.json     per-county metrics for the national map
  public/data/county/{st}.json  per-state shards of the same records plus monthly Zillow series since 2016
                                (hvS = ZHVI levels, rentS = ZORI levels seasonally adjusted here) for the Housing graph
  public/data/us-housing.json   U.S. ZHVI / seasonally adjusted ZORI series (Housing graph "Show national")
  public/data/cities/{ST}.json  Zillow city-level home value / rent, keyed by Zillow RegionID
  public/data/meta.json         as-of dates, per-metric time windows, source attributions

Methodology notes (details in docs/LOCAL_DATA_SOURCES.md)
  * Baseline is the Jan 2025 monthly value (matches the rest of the site).
  * ZHVI is published seasonally adjusted by Zillow. ZORI and county LAUS unemployment are NOT, so we
    seasonally adjust them here (classical decomposition, factors fit on 2016-2024). A series is only
    published if it has >= 36 months of history to fit factors; shorter series are dropped (never shown raw
    as if adjusted). Rent levels shown to users are the observed (unadjusted) latest values.
  * Every series must reach the common latest month of its file; stale series are dropped.
  * Paycheck vs prices: QCEW trailing 4-quarter average weekly wage vs the prior 4 quarters, against local
    CPI-U all-items averaged over the same 12 months. Only counties with >= 5,000 jobs and |change| <= 25%.
  * County LAUS uses 3-month averages (Dec 24-Feb 25 baseline; the 3 months before the latest, preliminary,
    month as current).
  * Connecticut legacy counties take BLS/Census/Indeed values from a planning region (same mapping as
    bls.ts); Valdez-Cordova AK (map shape) takes Chugach's values. Flagged "approx".
  * Robust outliers (|z| > 5 vs counties with >= 20k jobs) are flagged per metric and excluded from
    the "biggest movers" lists, together with approximated counties.
"""
import argparse, calendar, glob, json, os, re, sys, zipfile
from collections import defaultdict
import numpy as np
import pandas as pd

BASE = "2025-01"
SERIES_START = "2016-01"
MIN_SA_HISTORY = 36  # months of in-sample seasonal ratios needed before we adjust (or publish) a series

# Sanity filters (see docs/LOCAL_DATA_SOURCES.md)
WAGE_MIN_JOBS = 5000
WAGE_MAX_ABS = 25.0
LIST_MIN_ACTIVE = 20
LIST_MAX_ABS_YOY = 1.0  # Realtor.com YoY fields are fractions
OUTLIER_Z = 5.0
OUTLIER_POOL_JOBS = 20000
MIN_GEO_COUNTIES = 3100
RENT_HERO_MIN, RENT_HERO_MAX = -30.0, 60.0  # sanity range for src/lib/data/county-rent.json

# Known artifacts documented in docs/validation/FINDINGS.md, shown as footnotes in the UI.
NOTES = {
    "37021": {"ur": "The Jan 2025 baseline was inflated by Hurricane Helene job losses, so this drop overstates the improvement."},
}


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


def fmt_month(ym):
    return f"{calendar.month_abbr[int(ym[5:])]} {ym[:4]}"


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


def yoy_same_month(mat):
    """Fallback for unadjusted series too short to seasonally adjust: latest month vs the same month a year
    earlier (seasonality cancels). A different window from "since Jan 2025", so it is labeled separately."""
    return (mat[:, -1] / mat[:, -13] - 1) * 100


def robust_flags(counties, key, pool):
    vals = {f: c[key] for f, c in counties.items() if key in c}
    pv = np.array([vals[f] for f in pool if f in vals], float)
    if len(pv) < 20:
        return []
    med = np.median(pv); mad = np.median(np.abs(pv - med)) * 1.4826 or 1.0
    return [f for f, v in vals.items() if abs(v - med) / mad > OUTLIER_Z]


def last_consecutive(months, n):
    """Latest n calendar-consecutive YYYY-MM months in `months` (sorted). Never bridges a gap
    (e.g. the missing Oct 2025 LAUS month), so a "3-month average" is always 3 adjacent months."""
    for end in range(len(months) - 1, n - 2, -1):
        w = months[end - n + 1:end + 1]
        if all(month_range(w[k], w[k + 1])[1:] == [w[k + 1]] for k in range(n - 1)):
            return w
    raise SystemExit(f"no {n} consecutive published months in {months[-12:]}")


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


def to_int(x):
    x = x.strip()
    return int(x) if x.isdigit() else 0


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
    os.makedirs(os.path.join(a.out, "zip"), exist_ok=True)
    meta = {"baseline": BASE, "sources": {}}

    zip_county = json.load(open(os.path.join(a.repo, "src/lib/data/zip-county.json")))
    geo = load_county_geo(a.repo)
    print("county geo:", f"county-geo.json ({len(geo)} counties)")

    # County names + state for every FIPS (Census 2020 reference file; covers VA independent cities and CT legacy counties)
    names, fips_state = {}, {}
    for line in open(R("county_names.txt"), encoding="latin-1"):
        p = line.rstrip("\n").split("|")
        if len(p) >= 5 and p[1].isdigit():
            f = p[1] + p[2]
            names[f] = f"{p[4]}, {p[0]}"; fips_state[f] = p[0]
    st_by_fips2 = {f[:2]: s for f, s in fips_state.items()}
    for v in zip_county.values():
        names.setdefault(v["countyFips"], f'{v["countyName"]}, {v["stateAbbr"]}')
        fips_state.setdefault(v["countyFips"], v["stateAbbr"])
    names["02261"] = "Valdez-Cordova Census Area, AK"; fips_state["02261"] = "AK"
    for f, g in geo.items():
        if g.get("state"):
            fips_state[f] = g["state"]
    state_of = lambda f: fips_state.get(f) or st_by_fips2.get(f[:2], "")

    ctp = json.load(open(os.path.join(a.repo, "src/lib/data/ct-planning-regions.json")))
    copy_from = dict(ctp["byCounty"])
    for f, g in geo.items():
        lf = g.get("lausFips")
        if f.startswith("09") and lf and lf != f:
            copy_from[f] = lf
    copy_from["02261"] = "02063"  # AK: Valdez-Cordova (map shape) split into Chugach/Copper River in 2019

    # ---------- Zillow zip ----------
    zk, zhvi, zm, _ = load_zillow(R("zhvi_zip.csv"), lambda d: d.RegionName.str.zfill(5).tolist())
    hv_b, hv_c, hv_pct = change_since(zhvi, zm)
    rk, zori, rm, _ = load_zillow(R("zori_zip.csv"), lambda d: d.RegionName.str.zfill(5).tolist())
    zori_sa, zori_ok = seasonal_adjust(zori, rm)
    r_b, r_c, r_pct = change_since(zori_sa, rm)
    meta["sources"]["zhvi"] = {"latest": zm[-1], "short": "Zillow ZHVI", "adjustment": "seasonally adjusted by Zillow",
                               "label": "Zillow Home Value Index (ZHVI)", "url": "https://www.zillow.com/research/data/"}
    meta["sources"]["zori"] = {"latest": rm[-1], "short": "Zillow ZORI", "adjustment": "seasonally adjusted by whatchanged",
                               "label": "Zillow Observed Rent Index (ZORI), asking rents on new leases", "url": "https://www.zillow.com/research/data/"}

    zips = defaultdict(dict)
    for i, z in enumerate(zk):
        if not (np.isfinite(hv_b[i]) and np.isfinite(hv_c[i]) and hv_b[i] > 0):
            continue
        s = zhvi[i]; first = int(np.argmax(np.isfinite(s)))
        base, cur = int(round(hv_b[i])), int(round(hv_c[i]))
        zips[z]["hv"] = {
            "start": zm[first],
            "s": [int(round(v, -2)) if np.isfinite(v) else None for v in s[first:]],
            "base": base, "cur": cur, "pct": round((cur / base - 1) * 100, 1), "asOf": zm[-1],
        }
    r_yoy = yoy_same_month(zori)
    rent_n = {"sa": 0, "yoy": 0, "dropped": 0}
    for i, z in enumerate(rk):
        if not np.isfinite(zori[i, -1]):
            rent_n["dropped"] += 1; continue
        if zori_ok[i] and np.isfinite(r_pct[i]):
            s = zori_sa[i]; first = int(np.argmax(np.isfinite(s)))
            zips[z]["rent"] = {
                "basis": "sa", "start": rm[first],
                "s": [int(round(v)) if np.isfinite(v) else None for v in s[first:]],  # SA, for the trend line only
                "pct": round(float(r_pct[i]), 1),
                "cur": int(round(zori[i, -1])),  # observed (not adjusted) latest asking rent
                "asOf": rm[-1],
            }
            rent_n["sa"] += 1
        elif np.isfinite(r_yoy[i]):
            zips[z]["rent"] = {"basis": "yoy", "pct": round(float(r_yoy[i]), 1), "cur": int(round(zori[i, -1])), "asOf": rm[-1]}
            rent_n["yoy"] += 1
        else:
            rent_n["dropped"] += 1
    print(f"zip rent: {rent_n}")

    # ---------- Realtor.com zip snapshot ----------
    rdc = pd.read_csv(R("rdc_zip.csv"), dtype={"postal_code": str})
    rdc["ym"] = pd.to_numeric(rdc.month_date_yyyymm, errors="coerce")
    rdc = rdc[rdc.ym.notna()]
    rdc["postal_code"] = rdc.postal_code.str.zfill(5)
    rdc_month = str(int(rdc.ym.max()))
    rdc = rdc[rdc.ym == int(rdc_month)]
    meta["sources"]["realtor"] = {"latest": f"{rdc_month[:4]}-{rdc_month[4:]}", "short": "Realtor.com", "adjustment": "not seasonally adjusted",
                                  "label": "Realtor.com® Economic Research", "url": "https://www.realtor.com/research/data/"}
    def num(x):
        v = pd.to_numeric(x, errors="coerce")
        return float(v) if v is not None and np.isfinite(v) else None
    kept = dropped = 0
    for r in rdc.itertuples():
        price, active = num(r.median_listing_price), num(r.active_listing_count)
        if price is None or active is None or active < LIST_MIN_ACTIVE:
            continue
        yoys = [num(r.median_listing_price_yy), num(r.active_listing_count_yy), num(r.median_days_on_market_yy)]
        reduced = num(r.price_reduced_share)
        if any(y is not None and abs(y) > LIST_MAX_ABS_YOY for y in yoys) or (reduced is not None and not 0 <= reduced <= 1):
            dropped += 1; continue
        dom = num(r.median_days_on_market)
        rd = lambda x, nd=3: None if x is None else round(x, nd)
        zips[r.postal_code]["listings"] = {
            "price": int(price), "priceYoY": rd(yoys[0]), "active": int(active), "activeYoY": rd(yoys[1]),
            "dom": None if dom is None else int(round(dom)), "domYoY": rd(yoys[2]),
            "reduced": rd(reduced), "volatile": bool(r.quality_flag == 1),
        }
        kept += 1
    print(f"listings: kept {kept}, dropped {dropped} out-of-range")

    # ---------- Zillow city (place) level, keyed by RegionID ----------
    # The frontend only uses a city when its Zillow county equals the zip's county. Two RegionIDs with the
    # same name + county + state are ambiguous and both dropped.
    cities = {}
    for fname, key in [("zhvi_city.csv", "hv"), ("zori_city.csv", "rent")]:
        ks, mat, months, d = load_zillow(R(fname), lambda d: d.RegionID.tolist())
        basis = np.full(len(ks), "sa", dtype=object)
        if key == "rent":
            sa, _ = seasonal_adjust(mat, months)
            _, _, pct = change_since(sa, months)
            yoy = yoy_same_month(mat)
            fb = ~np.isfinite(pct) & np.isfinite(yoy)
            pct = np.where(fb, yoy, pct); basis[fb] = "yoy"
        else:
            _, _, pct = change_since(mat, months)
        for i, rid in enumerate(ks):
            if np.isfinite(pct[i]) and np.isfinite(mat[i, -1]):
                c = cities.setdefault(rid, {"n": d.RegionName.iloc[i], "county": d.CountyName.iloc[i], "st": d.State.iloc[i]})
                c[key] = {"pct": round(float(pct[i]), 1), "cur": int(round(mat[i, -1], -2 if key == "hv" else 0)), "asOf": months[-1]}
                if key == "rent":
                    c[key]["basis"] = basis[i]
    seen = defaultdict(list)
    for rid, c in cities.items():
        seen[(c["n"], c["county"], c["st"])].append(rid)
    ambiguous = [rid for rids in seen.values() if len(rids) > 1 for rid in rids]
    for rid in ambiguous:
        del cities[rid]
    os.makedirs(os.path.join(a.out, "cities"), exist_ok=True)
    for old in glob.glob(os.path.join(a.out, "cities", "*.json")):
        os.remove(old)
    by_state = defaultdict(dict)
    for rid, c in cities.items():
        by_state[c["st"]][rid] = {k: v for k, v in c.items() if k != "st"}
    for st_, v in by_state.items():
        with open(os.path.join(a.out, "cities", f"{st_}.json"), "w") as fh:
            json.dump(v, fh, separators=(",", ":"), sort_keys=True)
    print(f"cities: {len(cities)} ({sum('rent' in c for c in cities.values())} with rent); {len(ambiguous)} ambiguous dropped")

    for old in glob.glob(os.path.join(a.out, "zip", "*.json")):
        os.remove(old)
    shards = defaultdict(dict)
    for z, v in zips.items():
        shards[z[:3]][z] = v
    for k, v in shards.items():
        with open(os.path.join(a.out, "zip", f"{k}.json"), "w") as fh:
            json.dump(v, fh, separators=(",", ":"), sort_keys=True)
    print(f"zips: {len(zips)} in {len(shards)} shards")

    # ---------- County ----------
    counties = defaultdict(dict)
    cfips = lambda d: (d.StateCodeFIPS.str.zfill(2) + d.MunicipalCodeFIPS.str.zfill(3)).tolist()
    ck, chv, cm, _ = load_zillow(R("zhvi_county.csv"), cfips)
    _, cur, pct = change_since(chv, cm)
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
    cr_yoy = yoy_same_month(cr)
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
        elif np.isfinite(cr_yoy[i]) and np.isfinite(cr[i, -1]):
            # too short to adjust: same-month YoY for the local card only (the map shows "since Jan 2025" only)
            counties[f]["rentYoY"] = round(float(cr_yoy[i]), 1); counties[f]["rentCur"] = int(round(cr[i, -1]))

    # LAUS county unemployment rate (NSA -> SA here)
    la = pd.read_csv(R("la.county"), sep="\t", dtype=str)
    la.columns = [c.strip() for c in la.columns]
    la["series_id"] = la.series_id.str.strip()
    la = la[la.series_id.str.endswith("03") & la.period.str.match(r"M(0[1-9]|1[0-2])")]
    la = la[la.year.astype(int) >= 2015]
    la["fips"] = la.series_id.str[5:10]
    la["m"] = la.year + "-" + la.period.str[1:]
    la["v"] = pd.to_numeric(la.value.str.strip(), errors="coerce")
    piv = la.pivot_table(index="fips", columns="m", values="v")
    lm = month_range(min(piv.columns), max(piv.columns))
    piv = piv.reindex(columns=lm)  # months missing for everyone (Oct 2025 shutdown) become NaN columns
    ur_sa, _ = seasonal_adjust(piv.to_numpy(), lm, additive=True)
    # County LAUS is model-based and the latest month is preliminary (Aug 2026 showed implausible drops in Ohio).
    # Baseline: Dec 2024–Feb 2025 average. Current: the 3 published months before the latest (preliminary) month.
    published = [m for i, m in enumerate(lm) if np.isfinite(piv.iloc[:, i]).mean() > 0.5]
    base_m = ["2024-12", "2025-01", "2025-02"]; cur_m = last_consecutive(published[:-1], 3)
    b = ur_sa[:, [lm.index(m) for m in base_m]]; c3 = ur_sa[:, [lm.index(m) for m in cur_m]]
    b_ok, c_ok = np.isfinite(b).all(axis=1), np.isfinite(c3).all(axis=1)
    b, c3 = b.mean(axis=1), c3.mean(axis=1)
    for i, f in enumerate(piv.index):
        if b_ok[i] and c_ok[i] and 0 <= b[i] <= 25 and 0 <= c3[i] <= 25:
            bb, cc = round(float(b[i]), 1), round(float(c3[i]), 1)
            counties[f]["urBase"] = bb; counties[f]["urCur"] = cc; counties[f]["ur"] = round(cc - bb, 1)
    meta["sources"]["laus"] = {
        "latest": cur_m[-1], "preliminaryExcluded": published[-1],
        "baseWindow": f"{fmt_month(base_m[0])}–{fmt_month(base_m[-1])}", "curWindow": f"{fmt_month(cur_m[0])}–{fmt_month(cur_m[-1])}",
        "window": f"3-month average, {fmt_month(cur_m[0])}–{fmt_month(cur_m[-1])} vs {fmt_month(base_m[0])}–{fmt_month(base_m[-1])}",
        "short": "BLS LAUS", "adjustment": "seasonally adjusted by whatchanged",
        "label": "BLS Local Area Unemployment Statistics", "url": "https://www.bls.gov/lau/"}

    # QCEW: trailing 4-quarter average weekly wage vs the 4 quarters a year earlier.
    frames = []
    for f in sorted(glob.glob(R("qcew_*.zip"))):
        with zipfile.ZipFile(f) as zf:
            q = pd.read_csv(zf.open(zf.namelist()[0]), dtype=str, usecols=["area_fips", "year", "qtr", "own_code", "industry_code", "agglvl_code", "disclosure_code", "total_qtrly_wages", "month1_emplvl", "month2_emplvl", "month3_emplvl"])
        frames.append(q[(q.agglvl_code == "70") & (q.own_code == "0") & (q.industry_code == "10") & ~q.area_fips.str.endswith("999")])
    q = pd.concat(frames).drop_duplicates(["area_fips", "year", "qtr"])
    q["t"] = q.year.astype(int) * 4 + q.qtr.astype(int) - 1
    for c_ in ["total_qtrly_wages", "month1_emplvl", "month2_emplvl", "month3_emplvl"]:
        q[c_] = pd.to_numeric(q[c_], errors="coerce")
    q["emp_q"] = q[["month1_emplvl", "month2_emplvl", "month3_emplvl"]].mean(axis=1)
    q.loc[q.disclosure_code == "N", ["total_qtrly_wages", "emp_q"]] = np.nan
    tmax = int(q.t.max())
    qy, qq = tmax // 4, tmax % 4 + 1
    def window(t_end):
        w = q[(q.t > t_end - 4) & (q.t <= t_end)].groupby("area_fips")
        n = w.t.nunique(); wages = w.total_qtrly_wages.sum(min_count=4); empw = w.emp_q.sum(min_count=4)
        return (wages / (empw * 13)).where(n == 4), w.emp_q.mean()
    w_now, emp_now = window(tmax)
    w_prev, emp_prev = window(tmax - 4)
    last_q = q[q.t == tmax].set_index("area_fips")
    wage_drop = 0
    for f in w_now.index:
        emp_last = last_q.emp_q.get(f, np.nan)
        if np.isfinite(emp_last):
            counties[f]["emp"] = int(emp_last)
        if not (np.isfinite(w_now.get(f, np.nan)) and np.isfinite(w_prev.get(f, np.nan)) and w_prev[f] > 0):
            continue
        chg = (w_now[f] / w_prev[f] - 1) * 100
        if not (np.isfinite(emp_now[f]) and emp_now[f] >= WAGE_MIN_JOBS and abs(chg) <= WAGE_MAX_ABS):
            wage_drop += 1; continue
        counties[f]["wage"] = round(float(chg), 1)
        counties[f]["wageCur"] = int(round(w_now[f]))
        counties[f]["jobs"] = round(float((emp_now[f] / emp_prev[f] - 1) * 100), 1)
    qlabel = lambda t: f"Q{t % 4 + 1} {t // 4}"
    window_label = f"12-month averages, {qlabel(tmax - 3)}–{qlabel(tmax)} vs a year earlier"
    meta["sources"]["qcew"] = {"latest": f"{qy}-Q{qq}", "window": window_label, "short": "BLS QCEW + CPI",
                               "adjustment": "not seasonally adjusted (12-month averages)",
                               "label": "BLS QCEW average weekly wage vs CPI-U all items", "url": "https://www.bls.gov/cew/"}
    print(f"wages: {sum('wage' in c for c in counties.values())} published, {wage_drop} dropped (<{WAGE_MIN_JOBS} jobs or |chg|>{WAGE_MAX_ABS}%)")

    copy_regions(counties, copy_from, ["ur", "urBase", "urCur", "wage", "wageCur", "jobs", "emp"])

    # Local CPI averaged over the same 12 months, all items
    cu = pd.read_csv(R("cu.data.0.Current"), sep="\t", dtype=str)
    cu.columns = [c.strip() for c in cu.columns]
    cu["series_id"] = cu.series_id.str.strip()
    cu = cu[cu.series_id.str.match(r"CUUR\w{4}SA0$") & cu.period.str.match(r"M(0[1-9]|1[0-2])")]
    cu["t"] = cu.year.astype(int) * 12 + cu.period.str[1:].astype(int) - 1
    cu["v"] = pd.to_numeric(cu.value.str.strip(), errors="coerce")
    m_end = qy * 12 + qq * 3 - 1
    def cpi_avg(e):
        w = cu[(cu.t > e - 12) & (cu.t <= e)].groupby(cu.series_id.str[4:8])
        return w.v.mean().where(w.v.count() >= 6)  # bimonthly metros publish 6 of 12 months
    cpi_yoy = ((cpi_avg(m_end) / cpi_avg(m_end - 12) - 1) * 100).dropna().round(1).to_dict()
    cpi_of = lambda f: (geo.get(f, {}).get("cpiArea"), geo.get(f, {}).get("cpiName"))
    for f, c in counties.items():
        area, area_nm = cpi_of(f)
        if area and area in cpi_yoy:
            c["cpi"] = cpi_yoy[area]; c["cpiArea"] = area; c["cpiName"] = area_nm or area
            if "wage" in c:
                real = round(((1 + c["wage"] / 100) / (1 + c["cpi"] / 100) - 1) * 100, 1)
                if abs(real) <= WAGE_MAX_ABS:
                    c["real"] = real

    # Building permits YTD YoY, total units
    def permits(path):
        out = {}
        for line in open(path, encoding="latin-1"):
            p = line.split(",")
            if len(p) < 18 or not p[0].strip().isdigit():
                continue
            out[p[1].strip().zfill(2) + p[2].strip().zfill(3)] = sum(to_int(p[i]) for i in (7, 10, 13, 16))
        return out
    p_cur, p_prev = permits(R("permits_cur.txt")), permits(R("permits_prev.txt"))
    bps_month = next(l[:6] for l in open(R("permits_cur.txt"), encoding="latin-1") if l[:6].isdigit())
    for f, u in p_cur.items():
        if f in p_prev and p_prev[f] >= 200 and not f.endswith("999"):  # small bases swing hundreds of %
            counties[f]["permits"] = round((u / p_prev[f] - 1) * 100, 0)
            counties[f]["permitsCur"] = u
    by_, bm_ = int(bps_month[:4]), int(bps_month[4:])
    span = (lambda y: f"Jan–{calendar.month_abbr[bm_]} {y}") if bm_ > 1 else (lambda y: f"Jan {y}")
    meta["sources"]["permits"] = {"latest": f"{bps_month[:4]}-{bps_month[4:]}", "window": f"{span(by_)} vs {span(by_ - 1)}",
                                  "short": "Census BPS", "adjustment": "not seasonally adjusted (same months both years)",
                                  "label": "Census Building Permits Survey, year to date", "url": "https://www.census.gov/construction/bps/"}

    # ---------- Electricity: state residential price (EIA), seasonally adjusted change since Jan 2025 ----------
    # Only the % change is published (from SA prices); no level, so level and change can't disagree.
    if os.path.exists(R("eia_elec_res.csv")):
        el = pd.read_csv(R("eia_elec_res.csv"), dtype={"stateid": str})
        el = el[el.stateid.str.len() == 2]
        ep = el.pivot_table(index="stateid", columns="period", values="price")
        em = month_range(min(ep.columns), max(ep.columns)); ep = ep.reindex(columns=em)
        esa, _ = seasonal_adjust(ep.to_numpy(), em)
        _, _, pct = change_since(esa, em)
        st_el = {s_: round(float(pct[i]), 1) for i, s_ in enumerate(ep.index) if np.isfinite(pct[i])}
        for f, c in counties.items():
            if state_of(f) in st_el:
                c["elec"] = st_el[state_of(f)]
        meta["sources"]["electricity"] = {"latest": em[-1], "short": "EIA", "adjustment": "seasonally adjusted by whatchanged",
                                          "label": "EIA residential electricity price (state)", "url": "https://www.eia.gov/electricity/data/browser/"}

    # ---------- Job postings: Indeed Hiring Lab (metro, SA), since Jan 2025 ----------
    if os.path.exists(R("indeed_metro.csv")) and os.path.exists(R("cbsa_list1_2023.xlsx")):
        ind = pd.read_csv(R("indeed_metro.csv"), dtype={"cbsa_code": str})
        ind["date"] = pd.to_datetime(ind.date)
        base = ind[(ind.date >= "2025-01-06") & (ind.date <= "2025-02-02")].groupby("cbsa_code").indeed_job_postings_index.mean()
        lastd = ind.date.max()
        now = ind[ind.date > lastd - pd.Timedelta(days=28)].groupby("cbsa_code").indeed_job_postings_index.mean()
        chg = ((now / base - 1) * 100).dropna()
        dl = pd.read_excel(R("cbsa_list1_2023.xlsx"), header=2, dtype=str).dropna(subset=["FIPS County Code"])
        dl["fips"] = dl["FIPS State Code"].str.zfill(2) + dl["FIPS County Code"].str.zfill(3)
        cb = dict(zip(dl.fips, dl["CBSA Code"]))
        names_cb = dict(zip(ind.cbsa_code, ind.metro))
        # Indeed uses an older CBSA vintage for a few metros; re-key those by principal city + state
        key = lambda t: re.split(r"[-,]", t)[0].strip() + "|" + t.split(",")[-1].strip()[:2]
        by_title = {key(t): c_ for t, c_ in zip(dl["CBSA Title"], dl["CBSA Code"])}
        valid = set(dl["CBSA Code"])
        remap = {k: by_title.get(key(names_cb[k])) for k in chg.index if k not in valid}
        for old, new in remap.items():
            if new and new not in chg.index:
                chg[new] = chg[old]; names_cb[new] = names_cb[old]
        for f, c in counties.items():
            k = cb.get(f)
            if k in chg.index:
                c["posts"] = round(float(chg[k]), 1); c["postsArea"] = names_cb.get(k)
        meta["sources"]["indeed"] = {"latest": str(lastd.date()), "short": "Indeed Hiring Lab", "adjustment": "seasonally adjusted by Indeed",
                                     "label": "Indeed Hiring Lab job postings index (metro, CC BY 4.0)", "url": "https://github.com/hiring-lab/job_postings_tracker",
                                     "metros_matched": int(len(set(cb.values()) & set(chg.index))), "metros_total": int(len(chg))}

    # ---------- ACA marketplace: avg monthly premium after subsidy, plan year Y-1 -> Y (HealthCare.gov states) ----------
    oeps = sorted(glob.glob(R("oep*_county.zip")))
    if len(oeps) >= 2:
        def oep(path):
            with zipfile.ZipFile(path) as zf:
                d = pd.read_csv(zf.open([n for n in zf.namelist() if n.endswith(".csv")][0]), encoding="latin-1", dtype=str)
            d = d[d.State_Abrvtn != "Total"]
            num_ = lambda col: pd.to_numeric(d[col].str.replace(r"[$,\s]", "", regex=True), errors="coerce")
            return pd.DataFrame({"net": num_("Avg_Prm_Aftr_APTC").values, "gross": num_("Avg_Prm").values, "n": num_("Cnsmr").values},
                                index=d.County_FIPS_Cd.str.zfill(5).values)
        y0, y1 = oep(oeps[-2]), oep(oeps[-1])
        yr0, yr1 = re.search(r"(\d{4})", os.path.basename(oeps[-2])).group(1), re.search(r"(\d{4})", os.path.basename(oeps[-1])).group(1)
        for f in y1.index.intersection(y0.index):
            a0, a1 = y0.loc[f], y1.loc[f]
            # every field must be a real number (int() on NaN raises); suppressed CMS cells come through as NaN
            vals = [a0.net, a1.net, a0.gross, a1.gross, a0.n, a1.n]
            if all(np.isfinite(v) for v in vals) and a0.n >= 100 and f in counties:
                counties[f]["aca"] = {"net0": int(a0.net), "net1": int(a1.net), "gross0": int(a0.gross), "gross1": int(a1.gross),
                                      "enroll0": int(a0.n), "enroll1": int(a1.n)}
                counties[f]["acaNet"] = round(float(a1.net - a0.net), 0)
        meta["sources"]["aca"] = {"latest": f"plan year {yr1} vs {yr0}", "short": "CMS Marketplace", "adjustment": "",
                                  "label": "CMS Marketplace Open Enrollment county PUF (HealthCare.gov states only)", "url": "https://www.cms.gov/data-research/statistics-trends-reports/marketplace-products"}

    copy_regions(counties, copy_from, ["cpi", "cpiArea", "cpiName", "real", "permits", "permitsCur", "posts", "postsArea", "elec"])
    # Drop rows with no map shape and no zip pointing at them: CT planning regions (values copied to legacy
    # counties above) and statewide/unknown rows. Chugach (02063) and Copper River (02066) stay: the zip
    # crosswalk points at them.
    for f in [f for f in counties if re.fullmatch(r"091[1-9]0", f) or f.endswith("000") or f.endswith("999")]:
        del counties[f]

    # Outlier flags per metric (excluded from movers lists) + documented notes
    pool = [f for f, c in counties.items() if (c.get("emp") or 0) >= OUTLIER_POOL_JOBS and "approx" not in c]
    for key in ["hv", "rent", "ur", "wage", "real", "permits"]:
        for f in robust_flags(counties, key, pool):
            counties[f].setdefault("flags", []).append(key)
    for f, note in NOTES.items():
        if f in counties:
            counties[f]["note"] = note

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
    meta["paycheckWindow"] = window_label
    with open(os.path.join(a.out, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(f"counties: {len(counties)}; fields:",
          {k: sum(k in c for c in counties.values()) for k in ["hv", "rent", "rentYoY", "ur", "wage", "cpi", "real", "permits", "approx", "flags"]})


if __name__ == "__main__":
    main()
