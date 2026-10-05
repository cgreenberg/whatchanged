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
    decomposition, factors fit on 2016-2024). A series keeps its own factors if every calendar month has >= 2
    leak-free seasonal ratios (ratio months <= 2024-06); shorter series with >= 12 months before Jan 2025 use
    their state's pooled pattern; newer ones are dropped (never shown raw as if adjusted). Rent levels shown to users are
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
# A series keeps its OWN seasonal pattern when every calendar month has at least this many in-sample (leak-free,
# ratio months <= 2024-06) seasonal ratios; otherwise it takes its state's pooled pattern (pooled_adjust).
MIN_RATIOS_PER_MONTH = 2

# Sanity filters (see docs/LOCAL_DATA_SOURCES.md)
OUTLIER_Z = 5.0
OUTLIER_POOL_JOBS = 20000
MIN_GEO_COUNTIES = 3100
# Sanity range for a published rent % change since Jan 2025 (county and metro). The SAME range the site applies at
# runtime: it is emitted as meta.pctRange in county-rent.json / metro-rent.json and src/lib/rent.ts reads it from there.
RENT_HERO_MIN, RENT_HERO_MAX = -20.0, 50.0


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


def add_months(m, k):
    y, mo = int(m[:4]), int(m[5:]) - 1 + k
    return f"{y + mo // 12:04d}-{mo % 12 + 1:02d}"


def seasonal_adjust(mat, months, additive=False, fit_end="2024-12", return_factors=False):
    """mat: (n_series, n_months) float array with NaNs, months contiguous.
    Factors use only data through fit_end: a ratio month t needs the centered 13-month window t-6..t+6, so only
    ratio months <= fit_end - 6 (2024-06) are used and no 2025+ value ever enters a factor (the Jan 2025
    baseline never revises when Zillow publishes a new month).
    Returns (SA matrix, ok mask). Series with < MIN_RATIOS_PER_MONTH in-sample ratios for any calendar month
    come back as NaN rows
    (ok=False), so raw data can never be published under an "adjusted" label. With return_factors, also
    the (n_series, 12) calendar-month factors (valid where ok) for pooled_adjust."""
    assert months == month_range(months[0], months[-1]), "seasonal_adjust needs contiguous months"
    n, T = mat.shape
    w = np.r_[0.5, np.ones(11), 0.5] / 12.0  # centered 2x12 moving average
    cma = np.full_like(mat, np.nan)
    for t in range(6, T - 6):
        cma[:, t] = (mat[:, t - 6:t + 7] * w).sum(axis=1)  # NaN propagates if any missing
    ratio = (mat - cma) if additive else (mat / cma)
    cal = np.array([int(m[5:]) for m in months])
    ratio_end = add_months(fit_end, -6)  # full centered window ends <= fit_end
    fit = np.array([(SERIES_START <= m <= ratio_end) for m in months])
    factors = np.full((n, 12), 0.0 if additive else 1.0)
    for k in range(1, 13):
        sel = fit & (cal == k)
        if sel.any():
            factors[:, k - 1] = np.nanmedian(ratio[:, sel], axis=1)
    if additive:
        factors -= np.nanmean(factors, axis=1, keepdims=True)
    else:
        factors /= np.nanmean(factors, axis=1, keepdims=True)
    per_month = np.stack([np.isfinite(ratio[:, fit & (cal == k)]).sum(axis=1) for k in range(1, 13)], axis=1)
    ok = (per_month.min(axis=1) >= MIN_RATIOS_PER_MONTH) & np.isfinite(factors).all(axis=1)
    f = factors[:, cal - 1]
    sa = (mat - f) if additive else (mat / f)
    sa[~ok] = np.nan
    if return_factors:
        return sa, ok, factors
    return sa, ok


MIN_POOL_SERIES = 5  # a state's pooled seasonal pattern needs at least this many self-adjusted county series
POOL_MAX_START = "2024-01"  # pooled adjustment only for series with >= 12 months of data before the Jan 2025 baseline


def pool_factors(factors, ok, groups):
    """Typical (median) multiplicative seasonal factors per group (state FIPS) from series that have their
    own (ok) factors, normalized to average 1; '' = the U.S. pool (every ok series)."""
    out = {}
    def norm(f):
        return f / np.nanmean(f)
    out[""] = norm(np.nanmedian(factors[ok], axis=0))
    for g in sorted(set(groups)):
        sel = ok & (np.array(groups) == g)
        if sel.sum() >= MIN_POOL_SERIES:
            out[g] = norm(np.nanmedian(factors[sel], axis=0))
    return out


def pooled_adjust(mat, months, sa, ok, groups, pools):
    """Series too short to fit their own seasonal factors (ok=False) are adjusted with their state's pooled
    factors (else the U.S. pool), so a county or metro whose Zillow series only starts in 2022-2023 still gets
    an honest seasonally adjusted change. Series that start after POOL_MAX_START stay unpublished. Returns
    (SA matrix, pool label per row: None = own factors,
    state FIPS = that state's pool, '' = U.S. pool). Rows with no data stay NaN."""
    cal = np.array([int(m[5:]) for m in months]) - 1
    sa = sa.copy()
    labels = [None] * len(groups)
    first_ok = months.index(POOL_MAX_START) if POOL_MAX_START in months else 0
    for i, g in enumerate(groups):
        if ok[i] or not np.isfinite(mat[i]).any():
            continue
        if not np.isfinite(mat[i, :first_ok + 1]).any():  # too new (thin early Zillow coverage): not published
            continue
        key = g if g in pools else ""
        sa[i] = mat[i] / pools[key][cal]
        labels[i] = key
    return sa, labels


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


# ---------- Metro rent (Zillow metro ZORI) ----------
# Zillow's metros are OMB CBSAs from the March 2020 delineation (verified: every county Zillow assigns to a
# metro in its county files falls in exactly that 2020 CBSA; the 2023 delineation disagrees for 95 metros).
# Linking is by ID only, never by name: county FIPS -> CBSA code (OMB 2020 list 1) and CBSA code -> Zillow metro
# RegionID (Zillow's CountyCrossWalk_Zillow.csv). Zillow metros missing from that crosswalk are not used.
METRO_DELINEATION = "OMB CBSA delineation, March 2020 (list 1)"


def load_delineation_2020(path):
    d = pd.read_excel(path, header=2, dtype=str)
    d = d[d["CBSA Code"].notna() & d["FIPS State Code"].notna()]
    fips = (d["FIPS State Code"].str.zfill(2) + d["FIPS County Code"].str.zfill(3)).tolist()
    return dict(zip(fips, d["CBSA Code"])), dict(zip(d["CBSA Code"], d["CBSA Title"]))


def load_zillow_metro_links(path):
    """Zillow metro RegionID -> CBSA code from Zillow's own county crosswalk (IDs only). Fails on any 1:many link."""
    x = pd.read_csv(path, dtype=str, encoding="latin-1").dropna(subset=["CBSACode", "MetroRegionID_Zillow"])
    pairs = x[["MetroRegionID_Zillow", "CBSACode"]].drop_duplicates()
    assert pairs.MetroRegionID_Zillow.is_unique and pairs.CBSACode.is_unique, "Zillow crosswalk links are not 1:1"
    return dict(zip(pairs.MetroRegionID_Zillow, pairs.CBSACode))


def build_metro_rent(R, counties, county_rent, rent_pools, pool_name, abbr_to_fips, county_out_of_range=frozenset()):
    """Metro ZORI rows (same SA method, sanity range and Jan 2025 + latest requirement as counties) for the
    counties that have no county rent series. Returns (metros by CBSA code, county FIPS -> CBSA code, series by CBSA)."""
    c2cbsa, titles = load_delineation_2020(R("cbsa_list1_2020.xls"))
    links = load_zillow_metro_links(R("zillow_county_crosswalk.csv"))
    mk, mm, mmonths, mdf = load_zillow(R("zori_metro.csv"), lambda d: d.RegionID.astype(str).tolist())
    keep = [i for i, t in enumerate(mdf.RegionType.tolist()) if t == "msa"]
    mk = [mk[i] for i in keep]; mm = mm[keep]
    msa, mok, _ = seasonal_adjust(mm, mmonths, return_factors=True)
    cbsa_of = [links.get(k) for k in mk]
    # pooled seasonal pattern: the state of the metro's first principal city (e.g. "Bluefield, WV-VA" -> WV)
    groups = [abbr_to_fips.get((titles.get(c) or ", ").rsplit(", ", 1)[1][:2], "") if c else "" for c in cbsa_of]
    msa, mpool = pooled_adjust(mm, mmonths, msa, mok, groups, rent_pools)
    msa = np.round(msa, 2)  # shipped precision (rentMS reproduces pct exactly)
    _, _, pct = change_since(msa, mmonths)
    bi = mmonths.index(BASE)
    # Outlier flags against the same distribution as county rent (counties with >= 20k jobs, |robust z| > 5)
    pool_vals = np.array([c["rent"] for c in counties.values()
                          if "rent" in c and (c.get("emp") or 0) >= OUTLIER_POOL_JOBS and "approx" not in c], float)
    med = np.median(pool_vals); mad = np.median(np.abs(pool_vals - med)) * 1.4826 or 1.0
    metros, series, unlinked, out_of_range = {}, {}, 0, {}
    for i, cb in enumerate(cbsa_of):
        if not cb or cb not in titles:
            unlinked += 1
            continue
        if not (np.isfinite(pct[i]) and np.isfinite(mm[i, bi]) and np.isfinite(mm[i, -1])):
            continue
        if not RENT_HERO_MIN <= pct[i] <= RENT_HERO_MAX:
            out_of_range[cb] = round(float(pct[i]), 1)
            continue
        row = {"name": titles[cb], "pct": round(float(pct[i]), 1), "baseRent": int(round(mm[i, bi])),
               "curRent": int(round(mm[i, -1])), "asOf": mmonths[-1]}
        if mpool[i] is not None:
            row["saPool"] = pool_name(mpool[i])
        if abs(pct[i] - med) / mad > OUTLIER_Z:
            row["flagged"] = True
        metros[cb] = row
        series[cb] = compact_series(msa[i], mmonths, 2)
    # Only counties with NO Zillow county series (a county series out of the sanity range is not replaced by its metro)
    eligible = lambda f: f not in county_rent and f in counties and "rent" not in counties[f] and f not in county_out_of_range
    county_map = {f: cb for f, cb in sorted(c2cbsa.items()) if cb in metros and eligible(f)}
    # Counties that would have used a metro dropped for the sanity range (the trace names the true reason)
    oor_counties = {f: cb for f, cb in sorted(c2cbsa.items()) if cb in out_of_range and eligible(f)}
    used = {cb for cb in county_map.values()}
    print(f"metro rent: {len(mk)} Zillow metros, {unlinked} without an ID link to a 2020 CBSA; "
          f"{len(metros)} usable; {len(used)} used by {len(county_map)} counties without a county series")
    print(f"metro rent: {len(out_of_range)} linked metros outside the {RENT_HERO_MIN:+.0f}..{RENT_HERO_MAX:+.0f}% range "
          f"{dict(sorted(out_of_range.items()))}; {len(oor_counties)} counties would have used one")
    return {cb: metros[cb] for cb in sorted(used)}, county_map, series, mmonths[-1], sorted(out_of_range), oor_counties


# ---------- Alaska: DCRA Community Fuel Price Survey (gasoline) ----------
# Twice-yearly survey (January "Winter" and July "Summer") of ~100 rural communities, published by the Alaska
# Department of Commerce, Community, and Economic Development (DCCED), Division of Community and Regional Affairs,
# under CC BY 4.0. Read from DCRA's ArcGIS service (layer "Gas Prices, All Years"; regional averages layer "Regional
# Gas Prices"; community -> borough/region from DCRA's community database). Zips (outside the Anchorage CBSA, which
# BLS prices monthly) map to: the surveyed community with the zip's own USPS city name in the same borough ('c');
# else the nearest surveyed community in the same borough within AK_NEAREST_MAX_KM of the zip's ZCTA point ('n');
# else the DCRA region average ('r'). Only communities/regions with both the Jan 2025 survey and the latest
# survey are used (baseline and current from the same series).
AK_BASE_SURVEY = "2025-01"
AK_NEAREST_MAX_KM = 100
AK_SERIES_START = "2016-01"
AK_ANCHORAGE_CBSA = {"02020", "02170"}  # Anchorage Municipality, Mat-Su: BLS monthly metro gas price
AK_GAS_RANGE = (1.0, 20.0)  # $/gal sanity range for remote Alaska (delivered by barge/air; > $10 is real)


def _survey_month(year, season):
    return f"{int(year):04d}-{'01' if str(season).lower().startswith('w') else '07'}"


def _semiannual(first, last):
    out, y, m = [], int(first[:4]), int(first[5:])
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y, 7) if m == 1 else (y + 1, 1)
    return out


def _haversine_km(a, b):
    import math
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def _gas_retailer(entity):
    """The gasoline retailer in a DCRA EntityName. Rows name one reporting retailer, sometimes with the heating-fuel /
    propane suppliers tagged by fuel: "Alaska Petroleum (HF)/University Chevron (Gas/P)" -> "University Chevron"."""
    if not isinstance(entity, str) or not entity.strip():
        return None
    parts = [p.strip() for p in re.split(r"\s*/\s*(?![^()]*\))", entity) if p.strip()]
    tagged = [(re.sub(r"\s*\(([^)]*)\)\s*$", "", p).strip(), (re.search(r"\(([^)]*)\)\s*$", p) or [None, ""])[1]) for p in parts]
    if len(tagged) == 1:
        return tagged[0][0]
    for name, tags in tagged:
        if any(t.strip().lower() in ("gas", "g") for t in re.split(r"[/,]", tags)):
            return name
    return None


def _retailer_fields(ent, latest):
    if not ent.get(latest):
        return {}
    out = {"stations": 1}
    cur, base = _gas_retailer(ent.get(latest)), _gas_retailer(ent.get(AK_BASE_SURVEY))
    if cur:
        out["retailer"] = cur
    if base and cur and re.sub(r"[^a-z]", "", base.lower()) != re.sub(r"[^a-z]", "", cur.lower()):
        out["baseRetailer"] = base
    return out


def build_ak_gas(R, zip_county):
    pages = sorted(glob.glob(R("dcra_gas_*.json")))
    need = [R(f) for f in ("dcra_regional_gas.json", "dcra_communities.json", "dcra_boroughs.json", "dcra_community_points.json", "gaz_zcta.zip")]
    if not pages or not all(os.path.exists(f) for f in need):
        print("WARN: Alaska DCRA fuel survey files missing; keeping the existing src/lib/data/ak-gas.json")
        return None
    rows = []
    # Pages must be read in offset order, and the last one must be the end of the layer: if ArcGIS still reports
    # exceededTransferLimit, the download was truncated and communities would silently go missing.
    pages = sorted(pages, key=lambda p: int(re.search(r"dcra_gas_(\d+)\.json$", p).group(1)))
    for f in pages:
        rows += [dict(r["attributes"], geom=r.get("geometry")) for r in json.load(open(f))["features"]]
    if json.load(open(pages[-1])).get("exceededTransferLimit"):
        sys.exit(f"Alaska DCRA gas layer truncated: {os.path.basename(pages[-1])} still reports exceededTransferLimit")
    for f in need[:4]:
        if json.load(open(f)).get("exceededTransferLimit"):
            sys.exit(f"Alaska DCRA layer truncated: {os.path.basename(f)} reports exceededTransferLimit")
    obs, pts, ent = defaultdict(dict), {}, defaultdict(dict)
    seen = defaultdict(int)
    for r in rows:
        seen[(r["CommunityName"], r["ReportingYear"], r["ReportingSeason"])] += 1
    dup = [k for k, n in seen.items() if n > 1]
    assert not dup, f"DCRA layer has several rows per community and survey: {dup[:5]}"
    for r in rows:
        v = r.get("GasRetailGal")
        if isinstance(v, (int, float)) and AK_GAS_RANGE[0] <= v <= AK_GAS_RANGE[1]:
            obs[r["CommunityName"]][_survey_month(r["ReportingYear"], r["ReportingSeason"])] = round(float(v), 3)
            ent[r["CommunityName"]][_survey_month(r["ReportingYear"], r["ReportingSeason"])] = r.get("EntityName")
        if r.get("geom"):
            pts[r["CommunityName"]] = (r["geom"]["y"], r["geom"]["x"])
    latest = max(m for c in obs.values() for m in c)
    reg_obs = defaultdict(dict)
    for f in json.load(open(R("dcra_regional_gas.json")))["features"]:
        a_ = f["attributes"]
        if isinstance(a_.get("AvgGas"), (int, float)) and AK_GAS_RANGE[0] <= a_["AvgGas"] <= AK_GAS_RANGE[1]:
            reg_obs[a_["Region"]][_survey_month(a_["ReportingYear"], a_["Season"])] = round(float(a_["AvgGas"]), 3)
    # DCRA community database: borough (FIPS via DCRA's own borough layer) and DCRA region per community.
    # DCRA still codes Kusilvak Census Area as 02270 (Wade Hampton); Census renumbered it 02158 in 2015.
    bfips = {b["attributes"]["CommunityName"]: ("02158" if b["attributes"]["FIPS"] == "02270" else b["attributes"]["FIPS"])
             for b in json.load(open(R("dcra_boroughs.json")))["features"]}
    cdb = {}
    for f in json.load(open(R("dcra_communities.json")))["features"]:
        a_ = f["attributes"]
        cdb[a_["CommunityName"]] = (bfips.get(a_["BoroughCensusArea"]), (a_.get("DCRAAlaskaRegion") or "").replace(" Region", ""))
    cpts = {f["attributes"]["CommunityName"]: (f["attributes"]["y"], f["attributes"]["x"])
            for f in json.load(open(R("dcra_community_points.json")))["features"] if f["attributes"].get("x") is not None}
    usable = {c: v for c, v in obs.items() if AK_BASE_SURVEY in v and latest in v and c in cdb and cdb[c][0]}
    regions_ok = {r: v for r, v in reg_obs.items() if AK_BASE_SURVEY in v and latest in v}
    with zipfile.ZipFile(R("gaz_zcta.zip")) as zf:
        lines = zf.read(zf.namelist()[0]).decode("utf-8").splitlines()
    hdr = [h.strip() for h in lines[0].split("\t")]
    zi, la, lo = hdr.index("GEOID"), hdr.index("INTPTLAT"), hdr.index("INTPTLONG")
    zpt = {}
    for line in lines[1:]:
        p = line.split("\t")
        if p[zi].startswith("99"):
            zpt[p[zi]] = (float(p[la]), float(p[lo].strip()))
    norm = lambda t: re.sub(r"[^a-z]", "", (t or "").lower())
    by_name = {norm(c): c for c in usable}
    cdb_by = {(norm(c), b): c for c, (b, _) in cdb.items()}
    borough_region = defaultdict(lambda: defaultdict(int))
    for c, (b, rg) in cdb.items():
        if b and rg:
            borough_region[b][rg] += 1
    zips, kinds = {}, defaultdict(int)
    for z, v in sorted(zip_county.items()):
        f = v["countyFips"]
        if v["stateAbbr"] != "AK" or f in AK_ANCHORAGE_CBSA:
            continue
        city = norm(v.get("cityName"))
        c = by_name.get(city)
        if c and cdb[c][0] == f:
            zips[z] = {"k": "c", "c": c}; kinds["community"] += 1
            continue
        here = zpt.get(z) or cpts.get(cdb_by.get((city, f)))
        cand = sorted((_haversine_km(here, pts[c]), c) for c in usable if cdb[c][0] == f and c in pts) if here else []
        if cand and cand[0][0] <= AK_NEAREST_MAX_KM:
            zips[z] = {"k": "n", "c": cand[0][1], "km": int(round(cand[0][0]))}; kinds["nearest"] += 1
            continue
        own = cdb.get(cdb_by.get((city, f)), (None, ""))[1]
        rg = own if own in regions_ok else max(borough_region[f].items(), key=lambda t: t[1])[0] if borough_region[f] else None
        if rg in regions_ok:
            zips[z] = {"k": "r", "r": rg}; kinds["region"] += 1
        else:
            kinds["none"] += 1
    used_c = sorted({z["c"] for z in zips.values() if "c" in z})
    used_r = sorted({z["r"] for z in zips.values() if "r" in z})
    months = _semiannual(AK_SERIES_START, latest)
    series = lambda o: [o.get(m) for m in months]
    out = {"meta": {"source": "Alaska DCRA Community Fuel Price Survey (gasoline, retail $/gal)",
                    "publisher": "Alaska Department of Commerce, Community, and Economic Development, Division of Community and Regional Affairs",
                    "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                    "url": "https://gis.data.alaska.gov/maps/DCCED::gas-prices-all-years",
                    "frequency": "twice yearly (January and July surveys)", "baseSurvey": AK_BASE_SURVEY, "latestSurvey": latest,
                    "start": AK_SERIES_START, "step": "6 months",
                    "changes": "whatchanged maps each zip to a surveyed community or region average; prices are as published",
                    "stations": "each community figure is one retailer's reported price per survey (communities[].stations = 1, "
                                "retailer = the latest survey's gasoline retailer; baseRetailer when the Jan 2025 survey's differs)"},
           # Each survey row is ONE reported retail gas price from one retailer: stations = 1 (the latest survey's
           # reporting retailer named in `retailer`; `baseRetailer` when the Jan 2025 survey's differs)
           "communities": {c: {"b": cdb[c][0], "r": cdb[c][1], "v": series(usable[c]), **_retailer_fields(ent[c], latest)} for c in used_c},
           "regions": {r: {"v": series(regions_ok[r])} for r in used_r},
           "zips": zips}
    print(f"ak-gas.json: {len(usable)} usable communities (of {len(obs)}), latest survey {latest}; zips {dict(kinds)}")
    return out


# ---------- Puerto Rico: DACO monthly average retail gasoline ----------
# Departamento de Asuntos del Consumidor (DACO) monthly island-wide average consumer prices (cents/gal), published
# as an xlsx linked from https://www.daco.pr.gov/recursos. Column A = month (Excel date), column C = regular.
PR_SERIES_START = "2016-01"
PR_GAS_URL = ("https://docs.pr.gov/files/DACO/Gasolina/Precios%20Promedio%20Mensual%20al%20Consumidor/"
              "Precios-Promedios-de-Gasolina-y-Diesel%20(1).xlsx")


def build_pr_gas(R):
    path = R("daco_gas.xlsx")
    if not os.path.exists(path):
        print("WARN: DACO Puerto Rico gas workbook missing; keeping the existing src/lib/data/pr-gas.json")
        return None
    import datetime, openpyxl
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    hdr_ok, vals = False, {}
    for row in ws.iter_rows(values_only=True):
        if not row:
            continue
        if not hdr_ok:
            hdr_ok = isinstance(row[0], str) and row[0].strip().lower().startswith("fecha") and \
                isinstance(row[2], str) and row[2].strip().lower() == "regular"
            continue
        d, reg = row[0], row[2]
        if isinstance(d, (datetime.datetime, datetime.date)) and isinstance(reg, (int, float)) and 100 <= reg <= 1000:
            vals[f"{d.year:04d}-{d.month:02d}"] = round(reg / 100.0, 4)  # cents -> $/gal
    assert hdr_ok, "DACO workbook layout changed (expected 'Fecha … Regular' header with Regular in column C)"
    latest = max(vals)
    assert BASE in vals, "DACO workbook has no January 2025 value"
    months = month_range(PR_SERIES_START, latest)
    out = {"meta": {"source": "DACO monthly average retail price, regular gasoline (Puerto Rico, island-wide)",
                    "publisher": "Departamento de Asuntos del Consumidor (DACO), Puerto Rico",
                    "url": PR_GAS_URL, "page": "https://www.daco.pr.gov/recursos", "unit": "$/gal (published in cents per gallon)",
                    "baseMonth": BASE, "asOf": latest, "start": PR_SERIES_START},
           "v": [vals.get(m) for m in months]}
    missing = [m for m in months if m not in vals]
    print(f"pr-gas.json: {len(vals)} months through {latest}; Jan 2025 ${vals[BASE]:.3f} -> ${vals[latest]:.3f}; missing since {PR_SERIES_START}: {missing}")
    return out


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
    # Why a county with a current ZORI row may still go unpublished (the trace and the metro stand-in name the reason):
    #   "too new"     = its first value comes after POOL_MAX_START (too short to adjust or measure since Jan 2025);
    #   "no baseline" = it reaches back past POOL_MAX_START but has no Jan 2025 value (e.g. Burnet County TX 48053).
    # Rows unpublished for any other reason fall back to the generic "no usable series" wording.
    _first_ok = crm.index(POOL_MAX_START)
    _bi = crm.index(BASE)
    _current = lambda i: np.isfinite(cr[i]).any() and np.isfinite(cr[i, -1])
    _early = lambda i: np.isfinite(cr[i, :_first_ok + 1]).any()
    zori_rows = {f for i, f in enumerate(ck) if _current(i) and not _early(i)}
    zori_nobase = {f for i, f in enumerate(ck) if _current(i) and _early(i) and not np.isfinite(cr[i, _bi])}
    # Rows Zillow publishes but that stop before the file's latest month (e.g. New Kent VA: one month, Jul 2026):
    # {fips: {"n": months with a value, "last": last month with a value}} so the card can say "isn't current".
    zori_stale = {f: {"n": int(np.isfinite(cr[i]).sum()), "last": crm[int(np.flatnonzero(np.isfinite(cr[i]))[-1])]}
                  for i, f in enumerate(ck) if np.isfinite(cr[i]).any() and not np.isfinite(cr[i, -1])}
    cr_sa, cr_ok, cr_factors = seasonal_adjust(cr, crm, return_factors=True)
    # Short series (Zillow coverage that starts in 2022-2023, e.g. Androscoggin ME) get their state's typical
    # seasonal pattern instead of being dropped; labeled wherever they are shown (rentSaPool / saPool).
    rent_pools = pool_factors(cr_factors, cr_ok, [f[:2] for f in ck])
    cr_sa, cr_pool = pooled_adjust(cr, crm, cr_sa, cr_ok, [f[:2] for f in ck], rent_pools)
    cr_sa = np.round(cr_sa, 2)  # the shipped series' precision, so the Rent tab reproduces the card's % exactly
    _, _, pct = change_since(cr_sa, crm)
    state_names = {v["countyFips"][:2]: v["stateName"] for v in zip_county.values()}
    pool_name = lambda key: f"{state_names.get(key, key)} counties" if key else "U.S. counties"
    meta["sources"]["zori"] = {"latest": crm[-1], "short": "Zillow ZORI", "adjustment": "seasonally adjusted by whatchanged",
                               "label": "Zillow Observed Rent Index (ZORI), asking rents on new leases", "url": "https://www.zillow.com/research/data/"}
    county_rent = {}
    bi = crm.index(BASE)
    # Rent rows use ZORI's OWN month index (ZORI and ZHVI can end in different months).
    # When they differ, the rows are aligned to timeline["rentMonths"] instead of "months".
    rent_months = [m for m in crm if m >= BASE]
    if rent_months != timeline["months"]:
        timeline["rentMonths"] = rent_months
    # A county series whose % change is outside [RENT_HERO_MIN, RENT_HERO_MAX] is not published ANYWHERE (card, map,
    # time-lapse, Housing graph): it is listed in county-rent.json "outOfRange" so the trace can say why, and it is
    # not replaced by its metro (the county's own data is what looks implausible).
    rent_out_of_range = set()
    for i, f in enumerate(ck):
        if np.isfinite(pct[i]) and np.isfinite(cr[i, -1]) and np.isfinite(cr[i, bi]) and not RENT_HERO_MIN <= pct[i] <= RENT_HERO_MAX:
            rent_out_of_range.add(f)
            continue
        row = (cr_sa[i, bi:] / cr_sa[i, bi] - 1) * 100
        if len(row) == len(rent_months) and np.isfinite(row).all():
            timeline["rent"][f] = [round(float(v), 1) for v in row]
        if np.isfinite(pct[i]) and np.isfinite(cr[i, -1]):
            counties[f]["rent"] = round(float(pct[i]), 1); counties[f]["rentCur"] = int(round(cr[i, -1]))  # observed level
            # Seasonally adjusted ZORI levels since SERIES_START for the Housing graph (2 decimals so the
            # graph's latest % change reproduces `rent` exactly)
            counties[f]["rentS"] = compact_series(cr_sa[i], crm, 2)
            if cr_pool[i] is not None:
                counties[f]["rentSaPool"] = pool_name(cr_pool[i])
            if np.isfinite(cr[i, bi]):
                county_rent[f] = {"pct": round(float(pct[i]), 1), "baseRent": int(round(cr[i, bi])),
                                  "curRent": int(round(cr[i, -1])), "asOf": crm[-1],
                                  **({"saPool": pool_name(cr_pool[i])} if cr_pool[i] is not None else {})}

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

    # Metro rent for counties with no county rent series (Rent card's next rung; the Housing graph's Rent tab)
    abbr_to_fips = {v["stateAbbr"]: v["countyFips"][:2] for v in zip_county.values()}
    metro_rows, metro_counties, metro_series, metro_asof, metro_oor, metro_oor_counties = build_metro_rent(
        R, counties, county_rent, rent_pools, pool_name, abbr_to_fips, rent_out_of_range)
    for f, cb in metro_counties.items():
        m = metro_rows[cb]
        counties[f]["rentM"] = {k: v for k, v in {"n": m["name"], "cbsa": cb, "rent": m["pct"], "cur": m["curRent"],
                                                   "flag": m.get("flagged"), "saPool": m.get("saPool")}.items() if v is not None}
        counties[f]["rentMS"] = metro_series[cb]
    meta["sources"]["zoriMetro"] = {"latest": metro_asof, "short": "Zillow ZORI (metro)", "adjustment": "seasonally adjusted by whatchanged",
                                    "label": "Zillow Observed Rent Index (ZORI), metro", "geography": METRO_DELINEATION,
                                    "url": "https://www.zillow.com/research/data/"}

    # monthly series (and the metro fallback) ship only in the per-state shards (the map file stays small)
    SERIES_KEYS = ("hvS", "rentS", "rentM", "rentMS")
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
                            "baseMonth": BASE, "asOf": crm[-1], "pctRange": [RENT_HERO_MIN, RENT_HERO_MAX],
                            "levels": "baseRent/curRent are observed (not seasonally adjusted) typical asking rents, $/mo",
                            "dollarChange": "monthly change consistent with pct = curRent - curRent / (1 + pct/100)"},
                   "counties": dict(sorted(cr_out.items())),
                   # Counties Zillow publishes a ZORI row for, but whose series is too new to measure since Jan 2025
                   # (needs data from POOL_MAX_START): the trace and the metro stand-in say so instead of "no series".
                   "tooNew": sorted(f for f in zori_rows if f in counties and f not in cr_out and "rent" not in counties[f]),
                   # Counties whose ZORI row reaches back past POOL_MAX_START but has no Jan 2025 value to measure from
                   "noBaseline": sorted(f for f in zori_nobase if f in counties and f not in cr_out and "rent" not in counties[f]),
                   # Counties whose ZORI row stops before the file's latest month (not current): months + last month
                   "notCurrent": {f: v for f, v in sorted(zori_stale.items()) if f in counties and f not in cr_out and "rent" not in counties[f]},
                   # Counties whose own series measures since Jan 2025 but lands outside meta.pctRange: not shown anywhere
                   "outOfRange": sorted(f for f in rent_out_of_range if f in counties)},
                  fh, separators=(",", ":"))
    zc_cov = sum(1 for v in zip_county.values() if v["countyFips"] in cr_out)
    print(f"county-rent.json: {len(cr_out)} counties, covers {zc_cov}/{len(zip_county)} crosswalk zips ({zc_cov / len(zip_county):.1%})")
    # Server-importable metro rent: same fields as county rows; `counties` maps county FIPS -> CBSA code for counties
    # with no county row (OMB March 2020 delineation, the vintage Zillow's metros use).
    with open(os.path.join(a.repo, "src/lib/data/metro-rent.json"), "w") as fh:
        json.dump({"meta": {"source": "Zillow Observed Rent Index (ZORI), metro", "adjustment": "seasonally adjusted by whatchanged",
                            "baseMonth": BASE, "asOf": metro_asof, "geography": METRO_DELINEATION, "pctRange": [RENT_HERO_MIN, RENT_HERO_MAX],
                            "levels": "baseRent/curRent are observed (not seasonally adjusted) typical asking rents, $/mo"},
                   "metros": metro_rows, "counties": metro_counties,
                   # Linked metros measured since Jan 2025 but outside meta.pctRange (not used), and the counties
                   # without a county row that would otherwise have used one (county FIPS -> CBSA)
                   "outOfRange": metro_oor, "outOfRangeCounties": metro_oor_counties}, fh, separators=(",", ":"))
    m_cov = defaultdict(int)
    for v in zip_county.values():
        if v["countyFips"] not in cr_out and v["countyFips"] in metro_counties:
            m_cov[v["stateAbbr"]] += 1
    print(f"metro-rent.json: {len(metro_rows)} metros for {len(metro_counties)} counties; covers {sum(m_cov.values())} more zips:",
          dict(sorted(m_cov.items(), key=lambda t: -t[1])))

    # Static gas series for places EIA/BLS don't price: Alaska communities (DCRA) and Puerto Rico (DACO)
    for name, built in (("ak-gas.json", build_ak_gas(R, zip_county)), ("pr-gas.json", build_pr_gas(R))):
        if built is not None:
            with open(os.path.join(a.repo, "src/lib/data", name), "w") as fh:
                json.dump(built, fh, separators=(",", ":"))

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
