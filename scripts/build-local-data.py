#!/usr/bin/env python3
"""
build-local-data.py — builds the zip- and county-level "local pulse" datasets.

All inputs are free, keyless bulk files (see docs/LOCAL_DATA_SOURCES.md).
Download them into a raw dir first (scripts/fetch-local-data.sh), then:

    python3 scripts/build-local-data.py --raw ../raw --out public/data

Outputs
  public/data/zip/{zip3}.json   per-zip: Zillow home value + rent series,
                                Realtor.com listing snapshot, national percentile ranks
  public/data/counties.json     per-county metrics for the national map + paycheck card
  public/data/meta.json         as-of dates and source attributions

Methodology notes
  * Baseline is the Jan 2025 monthly value (matches the rest of the site).
  * ZHVI is published seasonally adjusted. ZORI and county LAUS unemployment are NOT,
    so we seasonally adjust them here with a classical decomposition (centered 12-mo
    moving average, per-calendar-month median ratio/difference over 2016-2024).
    Without this, Jan->summer comparisons are biased (rents peak in summer;
    unemployment peaks in Jan).
  * Paycheck vs prices: QCEW Q1-2026 vs Q1-2025 average weekly wage (all ownerships,
    all industries) against the local CPI-U all-items Q1 average over the same window.
"""
import argparse, json, os, re, zipfile, io
from collections import defaultdict
import numpy as np
import pandas as pd

BASE = "2025-01"
SERIES_START = "2016-01"

def month_cols(df):
    cols = [c for c in df.columns if re.match(r"\d{4}-\d{2}-\d{2}$", c)]
    return cols, [c[:7] for c in cols]

def seasonal_adjust(mat, months, additive=False, fit_end="2024-12"):
    """mat: (n_series, n_months) float array with NaNs. Returns SA matrix."""
    n, T = mat.shape
    # centered 2x12 moving average
    w = np.r_[0.5, np.ones(11), 0.5] / 12.0
    cma = np.full_like(mat, np.nan)
    for t in range(6, T - 6):
        win = mat[:, t - 6:t + 7]
        cma[:, t] = (win * w).sum(axis=1)  # NaN propagates if any missing
    ratio = (mat - cma) if additive else (mat / cma)
    cal = np.array([int(m[5:]) for m in months])
    fit = np.array([("2016-01" <= m <= fit_end) for m in months])
    factors = np.full((n, 12), 0.0 if additive else 1.0)
    for k in range(1, 13):
        sel = fit & (cal == k)
        if sel.any():
            factors[:, k - 1] = np.nanmedian(ratio[:, sel], axis=1)
    if additive:
        factors -= np.nanmean(factors, axis=1, keepdims=True)
    else:
        factors /= np.nanmean(factors, axis=1, keepdims=True)
    # series with too little history: no adjustment
    nhist = np.isfinite(ratio[:, fit]).sum(axis=1)
    factors[nhist < 36] = 0.0 if additive else 1.0
    factors = np.nan_to_num(factors, nan=0.0 if additive else 1.0)
    f = factors[:, cal - 1]
    return (mat - f) if additive else (mat / f)

def pct_rank(values):
    s = pd.Series(values)
    return (s.rank(pct=True) * 100).round(0)

def load_zillow(path, key_fn):
    df = pd.read_csv(path, dtype={"RegionName": str, "StateCodeFIPS": str, "MunicipalCodeFIPS": str})
    cols, months = month_cols(df)
    keep = [i for i, m in enumerate(months) if m >= SERIES_START]
    cols = [cols[i] for i in keep]; months = [months[i] for i in keep]
    keys = key_fn(df)
    return keys, df[cols].to_numpy(dtype=float), months

def change_since(mat, months, base=BASE):
    bi = months.index(base)
    last = np.array([np.where(np.isfinite(r))[0][-1] if np.isfinite(r).any() else -1 for r in mat])
    cur = np.array([mat[i, j] if j >= 0 else np.nan for i, j in enumerate(last)])
    b = mat[:, bi]
    return b, cur, (cur / b - 1) * 100, last

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

    # ---------- Zillow zip ----------
    zk, zhvi, zm = load_zillow(R("zhvi_zip.csv"), lambda d: d.RegionName.str.zfill(5).tolist())
    hv_b, hv_c, hv_pct, hv_last = change_since(zhvi, zm)
    rk, zori, rm = load_zillow(R("zori_zip.csv"), lambda d: d.RegionName.str.zfill(5).tolist())
    zori_sa = seasonal_adjust(zori, rm)
    r_b, r_c, r_pct, r_last = change_since(zori_sa, rm)
    meta["sources"]["zhvi"] = {"latest": zm[-1], "label": "Zillow Home Value Index (ZHVI)", "url": "https://www.zillow.com/research/data/"}
    meta["sources"]["zori"] = {"latest": rm[-1], "label": "Zillow Observed Rent Index (ZORI), seasonally adjusted by whatchanged", "url": "https://www.zillow.com/research/data/"}

    hv_rank = pct_rank(np.where(np.isfinite(hv_pct), hv_pct, np.nan))
    r_rank = pct_rank(np.where(np.isfinite(r_pct), r_pct, np.nan))

    zips = defaultdict(dict)
    for i, z in enumerate(zk):
        if not np.isfinite(hv_pct[i]):
            continue
        s = zhvi[i]
        first = int(np.argmax(np.isfinite(s)))
        zips[z]["hv"] = {
            "start": zm[first],
            "s": [int(round(v, -2)) if np.isfinite(v) else None for v in s[first:hv_last[i] + 1]],
            "base": int(round(hv_b[i])), "cur": int(round(hv_c[i])),
            "pct": round(float(hv_pct[i]), 1), "rank": int(hv_rank[i]), "asOf": zm[hv_last[i]],
        }
    for i, z in enumerate(rk):
        if not np.isfinite(r_pct[i]):
            continue
        s = zori_sa[i]
        first = int(np.argmax(np.isfinite(s)))
        zips[z]["rent"] = {
            "start": rm[first],
            "s": [int(round(v)) if np.isfinite(v) else None for v in s[first:r_last[i] + 1]],
            "base": int(round(r_b[i])), "cur": int(round(r_c[i])),
            "pct": round(float(r_pct[i]), 1), "rank": int(r_rank[i]), "asOf": rm[r_last[i]],
        }

    # ---------- Realtor.com zip snapshot ----------
    rdc = pd.read_csv(R("rdc_zip.csv"), dtype={"postal_code": str})
    rdc["postal_code"] = rdc.postal_code.str.zfill(5)
    rdc_month = str(int(rdc.month_date_yyyymm.max()))
    meta["sources"]["realtor"] = {"latest": f"{rdc_month[:4]}-{rdc_month[4:]}", "label": "Realtor.com® Economic Research", "url": "https://www.realtor.com/research/data/"}
    for r in rdc.itertuples():
        if not np.isfinite(r.median_listing_price) or r.active_listing_count < 5:
            continue
        def f(x, nd=3):
            return None if not np.isfinite(x) else round(float(x), nd)
        zips[r.postal_code]["listings"] = {
            "price": int(r.median_listing_price), "priceYoY": f(r.median_listing_price_yy),
            "active": int(r.active_listing_count), "activeYoY": f(r.active_listing_count_yy),
            "dom": f(r.median_days_on_market, 0), "domYoY": f(r.median_days_on_market_yy),
            "reduced": f(r.price_reduced_share), "volatile": bool(r.quality_flag == 1),
        }

    shards = defaultdict(dict)
    for z, v in zips.items():
        shards[z[:3]][z] = v
    for k, v in shards.items():
        with open(os.path.join(a.out, "zip", f"{k}.json"), "w") as fh:
            json.dump(v, fh, separators=(",", ":"))
    print(f"zips: {len(zips)} in {len(shards)} shards")

    # ---------- County ----------
    counties = defaultdict(dict)
    ck, chv, cm = load_zillow(R("zhvi_county.csv"), lambda d: (d.StateCodeFIPS.str.zfill(2) + d.MunicipalCodeFIPS.str.zfill(3)).tolist())
    _, cur, pct, _ = change_since(chv, cm)
    timeline = {"months": [m for m in cm if m >= BASE], "hv": {}, "rent": {}}
    bi = cm.index(BASE)
    for i, f in enumerate(ck):
        row = (chv[i, bi:] / chv[i, bi] - 1) * 100
        if np.isfinite(row).all():
            timeline["hv"][f] = [round(float(v), 1) for v in row]
    for i, f in enumerate(ck):
        if np.isfinite(pct[i]):
            counties[f]["hv"] = round(float(pct[i]), 1); counties[f]["hvCur"] = int(round(cur[i], -2))
    ck, cr, crm = load_zillow(R("zori_county.csv"), lambda d: (d.StateCodeFIPS.str.zfill(2) + d.MunicipalCodeFIPS.str.zfill(3)).tolist())
    cr_sa = seasonal_adjust(cr, crm)
    _, cur, pct, _ = change_since(cr_sa, crm)
    bi = crm.index(BASE)
    for i, f in enumerate(ck):
        row = (cr_sa[i, bi:bi + len(timeline["months"])] / cr_sa[i, bi] - 1) * 100
        if len(row) == len(timeline["months"]) and np.isfinite(row).all():
            timeline["rent"][f] = [round(float(v), 1) for v in row]
    for i, f in enumerate(ck):
        if np.isfinite(pct[i]):
            counties[f]["rent"] = round(float(pct[i]), 1); counties[f]["rentCur"] = int(round(cur[i]))

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
    lm = list(piv.columns)
    ur_sa = seasonal_adjust(piv.to_numpy(), lm, additive=True)
    b, cur, _, last = change_since(ur_sa, lm)
    for i, f in enumerate(piv.index):
        if np.isfinite(b[i]) and np.isfinite(cur[i]):
            counties[f]["ur"] = round(float(cur[i] - b[i]), 1); counties[f]["urCur"] = round(float(cur[i]), 1)
    meta["sources"]["laus"] = {"latest": lm[-1], "label": "BLS LAUS, seasonally adjusted by whatchanged", "url": "https://www.bls.gov/lau/"}

    # QCEW Q1 wages YoY
    with zipfile.ZipFile(R("qcew_latest.zip")) as zf:
        name = zf.namelist()[0]
        q = pd.read_csv(zf.open(name), dtype=str, usecols=["area_fips", "year", "own_code", "industry_code", "agglvl_code", "qtr", "disclosure_code", "avg_wkly_wage", "month3_emplvl", "oty_avg_wkly_wage_pct_chg", "oty_month3_emplvl_pct_chg"])
    q = q[(q.agglvl_code == "70") & (q.own_code == "0") & (q.industry_code == "10")]
    qy, qq = int(q.year.max()) if "year" in q else None, q.qtr.max()
    q = q[q.qtr == qq]
    for r in q.itertuples():
        if r.disclosure_code == "N":
            continue
        counties[r.area_fips]["wage"] = float(r.oty_avg_wkly_wage_pct_chg)
        counties[r.area_fips]["wageCur"] = int(r.avg_wkly_wage)
        counties[r.area_fips]["jobs"] = float(r.oty_month3_emplvl_pct_chg)
        counties[r.area_fips]["emp"] = int(r.month3_emplvl)
    meta["sources"]["qcew"] = {"latest": f"{qy}-Q{qq}", "label": "BLS QCEW", "url": "https://www.bls.gov/cew/"}

    # Local CPI over the same window (Q1 2025 -> Q1 2026), all items
    cu = pd.read_csv(R("cu.data.0.Current"), sep="\t", dtype=str)
    cu.columns = [c.strip() for c in cu.columns]
    cu["series_id"] = cu.series_id.str.strip()
    qmonths = [f"M{3 * (int(qq) - 1) + k:02d}" for k in (1, 2, 3)]
    cu = cu[cu.series_id.str.match(r"CUUR\w{4}SA0$") & cu.period.isin(qmonths) & cu.year.isin([str(qy - 1), str(qy)])]
    cu["v"] = pd.to_numeric(cu.value.str.strip(), errors="coerce")
    q1 = cu.groupby([cu.series_id.str[4:8], "year"]).v.mean().unstack()
    cpi_yoy = ((q1[str(qy)] / q1[str(qy - 1)] - 1) * 100).dropna().round(1).to_dict()
    xwalk = json.load(open(os.path.join(a.repo, "src/lib/data/cbsa-cpi-crosswalk.json")))
    div = {}
    for line in open(os.path.join(a.repo, "src/lib/mappings/county-metro-cpi.ts")):
        m = re.match(r"\s+([A-Z]{2}): \{ code: '(\d{4})'", line)
        if m:
            div[m.group(1)] = m.group(2)
    fips_state = {v["countyFips"]: v["stateAbbr"] for v in zip_county.values()}
    for f, c in counties.items():
        area = xwalk.get(f) or div.get(fips_state.get(f, ""))
        if area and area in cpi_yoy:
            c["cpi"] = cpi_yoy[area]; c["cpiArea"] = area
            if "wage" in c:
                c["real"] = round(((1 + c["wage"] / 100) / (1 + c["cpi"] / 100) - 1) * 100, 1)

    # Building permits YTD (Jan-Aug) YoY, total units
    def permits(path):
        out = {}
        for line in open(path, encoding="latin-1"):
            p = line.split(",")
            if len(p) < 18 or not p[0].strip().isdigit():
                continue
            units = sum(int(p[i] or 0) for i in (7, 10, 13, 16))
            out[p[1] + p[2]] = units
        return out
    p26, p25 = permits(R("permits_cur.txt")), permits(R("permits_prev.txt"))
    bps_month = next(l[:6] for l in open(R("permits_cur.txt"), encoding="latin-1") if l[:6].isdigit())
    for f, u in p26.items():
        if f in p25 and p25[f] >= 25:
            counties[f]["permits"] = round((u / p25[f] - 1) * 100, 0)
            counties[f]["permitsCur"] = u
    meta["sources"]["permits"] = {"latest": f"{bps_month[:4]}-{bps_month[4:]} YTD", "label": "Census Building Permits Survey", "url": "https://www.census.gov/construction/bps/"}

    names = {}
    for v in zip_county.values():
        names[v["countyFips"]] = f'{v["countyName"]}, {v["stateAbbr"]}'
    # zip → county percentile ranks for county metrics
    for key in ["hv", "rent", "ur", "wage", "real", "permits"]:
        fl = [f for f, c in counties.items() if key in c]
        ranks = pct_rank([counties[f][key] for f in fl])
        for f, r in zip(fl, ranks):
            counties[f][key + "R"] = int(r)
    # representative zip per county (most populous Zillow zip) so map taps can load a zip
    order = {z: i for i, z in enumerate(zk)}  # Zillow files are sorted by SizeRank
    for z, v in zip_county.items():
        f = v["countyFips"]
        if f in counties and z in order:
            cur = counties[f].get("z")
            if cur is None or order[z] < order[cur]:
                counties[f]["z"] = z
    for f, c in counties.items():
        c["n"] = names.get(f, f)

    with open(os.path.join(a.out, "counties.json"), "w") as fh:
        json.dump(counties, fh, separators=(",", ":"))
    with open(os.path.join(a.out, "counties-timeline.json"), "w") as fh:
        json.dump(timeline, fh, separators=(",", ":"))
    meta["paycheckWindow"] = f"Q{qq} {qy} vs Q{qq} {qy - 1}"
    with open(os.path.join(a.out, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(f"counties: {len(counties)}; fields:",
          {k: sum(k in c for c in counties.values()) for k in ["hv", "rent", "ur", "wage", "cpi", "real", "permits"]})

if __name__ == "__main__":
    main()
