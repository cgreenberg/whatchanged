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
  * Paycheck vs prices: QCEW trailing 4-quarter average weekly wage (all ownerships, all industries)
    vs the prior 4 quarters, against local CPI-U all-items averaged over the same 12 months.
    Single-quarter YoY is dominated by bonus timing (see docs/validation/report.md).
  * County LAUS uses 3-month averages (Dec 24–Feb 25 baseline; latest 3 months) to damp preliminary noise.
  * Connecticut legacy counties take values from their dominant planning region (same mapping as bls.ts).
  * Extras: EIA state residential electricity (SA), Indeed metro job postings (SA, CBSA→county),
    CMS marketplace avg premium after subsidy (HealthCare.gov states), Zillow city-level series.
"""
import argparse, glob, json, os, re, zipfile, io
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


# Connecticut replaced counties with planning regions (091xx) in 2022. BLS/Census/Indeed publish by planning
# region; Zillow and the site's zip crosswalk use legacy counties. Mirror src/lib/api/bls.ts: copy each legacy
# county's values from its dominant planning region (approximation, flagged with "approx").
CT_LEGACY_TO_REGION = {"09001": "09120", "09003": "09110", "09005": "09160", "09007": "09130",
                       "09009": "09170", "09011": "09180", "09013": "09150", "09015": "09150",
                       "02261": "02063"}  # AK: Valdez-Cordova (map shape) split into Chugach/Copper River in 2019
def copy_regions(counties, keys):
    for legacy, region in CT_LEGACY_TO_REGION.items():
        src = counties.get(region, {})
        hit = [k for k in keys if k in src]
        if hit:
            for k in hit:
                counties[legacy][k] = src[k]
            counties[legacy].setdefault("approx", [])
            counties[legacy]["approx"] = sorted(set(counties[legacy]["approx"]) | set(hit))

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

    # ---------- Zillow city (place) level, for city-name searches ----------
    cities = {}
    for fname, key in [("zhvi_city.csv", "hv"), ("zori_city.csv", "rent")]:
        if not os.path.exists(R(fname)):
            continue
        d = pd.read_csv(R(fname), dtype=str)
        cols, months = month_cols(d)
        mat = d[cols].apply(pd.to_numeric, errors="coerce").to_numpy()
        if key == "rent":
            mat = seasonal_adjust(mat, months)
        b, cur, pct, last = change_since(mat, months)
        for i, r in enumerate(d.itertuples()):
            if np.isfinite(pct[i]):
                k = f"{r.RegionName}, {r.State}"
                cities.setdefault(k, {"county": r.CountyName})[key] = {"pct": round(float(pct[i]), 1), "cur": int(round(cur[i], -2 if key == "hv" else 0)), "asOf": months[last[i]]}
    os.makedirs(os.path.join(a.out, "cities"), exist_ok=True)
    by_state = defaultdict(dict)
    for k, v in cities.items():
        by_state[k[-2:]][k] = v
    for st_, v in by_state.items():
        with open(os.path.join(a.out, "cities", f"{st_}.json"), "w") as fh:
            json.dump(v, fh, separators=(",", ":"))
    print(f"cities: {len(cities)} ({sum('rent' in c for c in cities.values())} with rent)")

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
    # County LAUS is noisy (model-based, latest month preliminary; Oct 2025 missing after the shutdown).
    # Use 3-month averages: Dec 2024–Feb 2025 as baseline, the latest 3 published months as current.
    bi_ = [lm.index(m_) for m_ in ("2024-12", "2025-01", "2025-02")]
    b = np.nanmean(ur_sa[:, bi_], axis=1)
    cur = np.array([np.nanmean(r[np.isfinite(r)][-3:]) if np.isfinite(r).sum() >= 3 else np.nan for r in ur_sa])
    for i, f in enumerate(piv.index):
        if np.isfinite(b[i]) and np.isfinite(cur[i]):
            counties[f]["ur"] = round(float(cur[i] - b[i]), 1); counties[f]["urCur"] = round(float(cur[i]), 1)
    meta["sources"]["laus"] = {"latest": lm[-1], "label": "BLS LAUS, seasonally adjusted by whatchanged; 3-month averages", "url": "https://www.bls.gov/lau/"}

    # QCEW: trailing 4-quarter average weekly wage vs the 4 quarters a year earlier.
    # Single-quarter YoY is dominated by bonus/stock-vest timing (validation: Q1-26 vs Q4-25 YoY r≈0.03
    # for counties with 20k+ jobs; e.g. Carver MN Q1-25 +40% then Q1-26 −22%), so we pool 4 quarters.
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
    for f in w_now.index:
        if np.isfinite(w_now.get(f, np.nan)) and np.isfinite(w_prev.get(f, np.nan)) and w_prev[f] > 0:
            counties[f]["wage"] = round(float((w_now[f] / w_prev[f] - 1) * 100), 1)
            counties[f]["wageCur"] = int(round(w_now[f]))
            counties[f]["jobs"] = round(float((emp_now[f] / emp_prev[f] - 1) * 100), 1)
            counties[f]["emp"] = int(last_q.emp_q.get(f, emp_now[f]) or 0)
    def qlabel(t):
        return f"Q{t % 4 + 1} {t // 4}"
    window_label = f"{qlabel(tmax - 3)}–{qlabel(tmax)} vs a year earlier"
    meta["sources"]["qcew"] = {"latest": f"{qy}-Q{qq}", "label": "BLS QCEW, trailing 4-quarter avg weekly wage", "url": "https://www.bls.gov/cew/"}

    copy_regions(counties, ["ur", "urCur", "wage", "wageCur", "jobs", "emp"])

    # Local CPI averaged over the same 12 months, all items
    cu = pd.read_csv(R("cu.data.0.Current"), sep="\t", dtype=str)
    cu.columns = [c.strip() for c in cu.columns]
    cu["series_id"] = cu.series_id.str.strip()
    cu = cu[cu.series_id.str.match(r"CUUR\w{4}SA0$") & cu.period.str.match(r"M(0[1-9]|1[0-2])")]
    cu["t"] = cu.year.astype(int) * 12 + cu.period.str[1:].astype(int) - 1
    cu["v"] = pd.to_numeric(cu.value.str.strip(), errors="coerce")
    m_end = qy * 12 + qq * 3 - 1
    def cpi_avg(e):
        return cu[(cu.t > e - 12) & (cu.t <= e)].groupby(cu.series_id.str[4:8]).v.mean()
    cpi_yoy = ((cpi_avg(m_end) / cpi_avg(m_end - 12) - 1) * 100).dropna().round(1).to_dict()
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
        if f in p25 and p25[f] >= 200 and not f.endswith("999"):  # small bases swing hundreds of %
            counties[f]["permits"] = round((u / p25[f] - 1) * 100, 0)
            counties[f]["permitsCur"] = u
    meta["sources"]["permits"] = {"latest": f"{bps_month[:4]}-{bps_month[4:]} YTD", "label": "Census Building Permits Survey", "url": "https://www.census.gov/construction/bps/"}

    # ---------- Electricity: state residential price (EIA), seasonally adjusted, since Jan 2025 ----------
    if os.path.exists(R("eia_elec_res.csv")):
        el = pd.read_csv(R("eia_elec_res.csv"), dtype={"stateid": str})
        el = el[el.stateid.str.len() == 2]
        ep = el.pivot_table(index="stateid", columns="period", values="price")
        em = list(ep.columns)
        esa = seasonal_adjust(ep.to_numpy(), em)
        b, cur, pct, last = change_since(esa, em)
        st_el = {s_: (round(float(pct[i]), 1), round(float(ep.iloc[i, last[i]]), 1)) for i, s_ in enumerate(ep.index) if np.isfinite(pct[i])}
        fips_state = {v["countyFips"]: v["stateAbbr"] for v in zip_county.values()}
        for f, c in counties.items():
            st_ = fips_state.get(f)
            if st_ in st_el:
                c["elec"], c["elecCur"] = st_el[st_]
        meta["sources"]["electricity"] = {"latest": em[-1], "label": "EIA residential electricity price (state), seasonally adjusted by whatchanged", "url": "https://www.eia.gov/electricity/data/browser/"}

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
        hit = 0
        for f, c in counties.items():
            k = cb.get(f)
            if k in chg.index:
                c["posts"] = round(float(chg[k]), 1); c["postsArea"] = names_cb.get(k); hit += 1
        meta["sources"]["indeed"] = {"latest": str(lastd.date()), "label": "Indeed Hiring Lab job postings index (metro, CC BY 4.0)", "url": "https://github.com/hiring-lab/job_postings_tracker",
                                     "metros_matched": int(len(set(cb.values()) & set(chg.index))), "metros_total": int(len(chg))}

    # ---------- ACA marketplace: avg monthly premium after subsidy, plan year Y-1 -> Y (HealthCare.gov states) ----------
    oeps = sorted(glob.glob(R("oep*_county.zip")))
    if len(oeps) >= 2:
        def oep(path):
            with zipfile.ZipFile(path) as zf:
                d = pd.read_csv(zf.open([n for n in zf.namelist() if n.endswith(".csv")][0]), encoding="latin-1", dtype=str)
            d = d[d.State_Abrvtn != "Total"]
            num = lambda col: pd.to_numeric(d[col].str.replace(r"[$,\s]", "", regex=True), errors="coerce")
            return pd.DataFrame({"net": num("Avg_Prm_Aftr_APTC").values, "gross": num("Avg_Prm").values, "n": num("Cnsmr").values},
                                index=d.County_FIPS_Cd.str.zfill(5).values)
        y0, y1 = oep(oeps[-2]), oep(oeps[-1])
        yr0, yr1 = re.search(r"(\d{4})", os.path.basename(oeps[-2])).group(1), re.search(r"(\d{4})", os.path.basename(oeps[-1])).group(1)
        for f in y1.index.intersection(y0.index):
            a0, a1 = y0.loc[f], y1.loc[f]
            if np.isfinite(a0.net) and np.isfinite(a1.net) and a0.n >= 100 and f in counties:
                counties[f]["aca"] = {"net0": int(a0.net), "net1": int(a1.net), "gross0": int(a0.gross), "gross1": int(a1.gross),
                                      "enroll0": int(a0.n), "enroll1": int(a1.n)}
                counties[f]["acaNet"] = round(float(a1.net - a0.net), 0)
        meta["sources"]["aca"] = {"latest": f"plan year {yr1} vs {yr0}", "label": "CMS Marketplace Open Enrollment county PUF (HealthCare.gov states only)", "url": "https://www.cms.gov/data-research/statistics-trends-reports/marketplace-products"}

    copy_regions(counties, ["permits", "permitsCur", "posts", "postsArea"])
    for f in [f for f in counties if f in set(CT_LEGACY_TO_REGION.values()) or f.endswith("000")]:
        del counties[f]  # planning-region / statewide rows have no map shape; values copied above

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
    meta["paycheckWindow"] = window_label
    with open(os.path.join(a.out, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(f"counties: {len(counties)}; fields:",
          {k: sum(k in c for c in counties.values()) for k in ["hv", "rent", "ur", "wage", "cpi", "real", "permits"]})

if __name__ == "__main__":
    main()
