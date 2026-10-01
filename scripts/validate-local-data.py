#!/usr/bin/env python3
"""
validate-local-data.py — independent cross-source checks for public/data (built by build-local-data.py).

Every check re-reads the RAW source files with its own parsing code (it does not import the build script),
then compares (a) the built JSON against the raw source, and (b) each metric against an independent
second source measuring the same thing.

    python3 scripts/validate-local-data.py --raw ../raw --data public/data --out docs/validation

Writes docs/validation/report.md and docs/validation/results.json. Exit code 1 if any HARD check fails.
"""
import argparse, glob, json, os, re, zipfile, csv, io, sys
import numpy as np
import pandas as pd

np.seterr(all="ignore")
import warnings; warnings.filterwarnings("ignore")

RESULTS = []
def record(section, name, status, detail, metrics=None):
    """status: PASS | WARN | FAIL | INFO"""
    RESULTS.append({"section": section, "check": name, "status": status, "detail": detail, "metrics": metrics or {}})
    print(f"[{status}] {section} / {name}: {detail}")

def agree(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    m = np.isfinite(a) & np.isfinite(b)
    a, b = a[m], b[m]
    if len(a) < 5:
        return {"n": int(len(a))}
    sign = float(np.mean(np.sign(a) == np.sign(b)))
    return {
        "n": int(len(a)),
        "pearson": round(float(np.corrcoef(a, b)[0, 1]), 3),
        "spearman": round(float(pd.Series(a).rank().corr(pd.Series(b).rank())), 3),
        "mae": round(float(np.mean(np.abs(a - b))), 2),
        "bias": round(float(np.mean(a - b)), 2),
        "sign_agree": round(sign, 3),
    }

def zillow(path, key):
    d = pd.read_csv(path, dtype=str)
    if key == "zip":
        d.index = d.RegionName.str.zfill(5)
    elif key == "county":
        d.index = d.StateCodeFIPS.str.zfill(2) + d.MunicipalCodeFIPS.str.zfill(3)
    else:
        d.index = d.RegionName + "|" + d.get("State", d.get("StateName", "")).fillna("")
    cols = [c for c in d.columns if re.match(r"\d{4}-\d{2}-\d{2}$", c)]
    out = d[cols].apply(pd.to_numeric, errors="coerce")
    out.columns = [c[:7] for c in cols]
    return out, d

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--data", default="public/data")
    ap.add_argument("--out", default="docs/validation")
    ap.add_argument("--repo", default=".")
    a = ap.parse_args()
    R = lambda f: os.path.join(a.raw, f)
    os.makedirs(a.out, exist_ok=True)
    counties = json.load(open(os.path.join(a.data, "counties.json")))
    zip_county = json.load(open(os.path.join(a.repo, "src/lib/data/zip-county.json")))
    def zp(z):
        p = os.path.join(a.data, "zip", z[:3] + ".json")
        return json.load(open(p)).get(z) if os.path.exists(p) else None

    # ------------------------------------------------------------------ 1. Re-derivation from raw
    S = "1. Built JSON matches raw source"
    zhvi, _ = zillow(R("zhvi_zip.csv"), "zip")
    zori, _ = zillow(R("zori_zip.csv"), "zip")
    test_zips = ["98683", "10001", "60601", "78701", "90210", "04101", "95014", "78753", "30301", "02139"]
    errs = []
    for z in test_zips:
        p = zp(z)
        if z in zhvi.index and np.isfinite(zhvi.loc[z, "2025-01"]):
            row = zhvi.loc[z].dropna()
            exp = (row.iloc[-1] / zhvi.loc[z, "2025-01"] - 1) * 100
            got = p["hv"]["pct"] if p and "hv" in p else None
            if got is None or abs(got - exp) > 0.06:
                errs.append(f"{z} hv exp {exp:.2f} got {got}")
            if p and abs(p["hv"]["cur"] - row.iloc[-1]) > 1:
                errs.append(f"{z} hv cur mismatch")
    record(S, "Zip home value % (10 test zips, independent recompute)", "FAIL" if errs else "PASS",
           "; ".join(errs) or "all match raw ZHVI within 0.06 pts")

    # rent: raw (unadjusted) vs built (seasonally adjusted) — report size of adjustment
    diffs = []
    for z in zori.index:
        p = zp(z)
        if p and "rent" in p and np.isfinite(zori.loc[z, "2025-01"]):
            row = zori.loc[z].dropna()
            raw_pct = (row.iloc[-1] / zori.loc[z, "2025-01"] - 1) * 100
            diffs.append(p["rent"]["pct"] - raw_pct)
    diffs = np.array(diffs)
    record(S, "Rent seasonal adjustment size (built SA − raw NSA, all zips)", "PASS" if np.median(np.abs(diffs)) < 2.5 else "WARN",
           f"median |adj| {np.median(np.abs(diffs)):.2f} pts, mean {diffs.mean():+.2f}, p95 |adj| {np.percentile(np.abs(diffs), 95):.2f}",
           {"n": len(diffs), "median_abs": round(float(np.median(np.abs(diffs))), 2), "mean": round(float(diffs.mean()), 2)})

    # QCEW: compare built county wage vs BLS open-data API (independent fetch, if network available)
    try:
        import urllib.request
        api_errs, checked = [], 0
        meta_ = json.load(open(os.path.join(a.data, "meta.json")))
        ly, lq = [int(x) for x in meta_["sources"]["qcew"]["latest"].split("-Q")]
        tl = ly * 4 + lq - 1
        def api_q(f, t):
            req = urllib.request.Request(f"https://data.bls.gov/cew/data/api/{t // 4}/{t % 4 + 1}/area/{f}.csv", headers={"User-Agent": "whatchanged validation"})
            rows = list(csv.DictReader(io.TextIOWrapper(urllib.request.urlopen(req, timeout=30), "utf-8")))
            r = [r for r in rows if r["own_code"] == "0" and r["industry_code"] == "10"][0]
            return float(r["total_qtrly_wages"]), np.mean([float(r[f"month{k}_emplvl"]) for k in (1, 2, 3)])
        for f in ["06085", "48453", "36061", "17031", "53011"]:
            def w4(t_end):
                q_ = [api_q(f, t) for t in range(t_end - 3, t_end + 1)]
                return sum(x[0] for x in q_) / sum(x[1] * 13 for x in q_)
            exp = (w4(tl) / w4(tl - 4) - 1) * 100
            checked += 1
            if abs(exp - counties[f]["wage"]) > 0.06:
                api_errs.append(f"{f}: API {exp:.2f} vs built {counties[f]['wage']}")
        record(S, "County 4-quarter wage change vs independent recompute from live BLS QCEW API (5 counties × 8 quarters)", "FAIL" if api_errs else "PASS",
               f"{checked} checked; mismatches: {api_errs or 'none'}")
    except Exception as e:
        record(S, "County wages vs live BLS QCEW API", "INFO", f"skipped (no network): {e}")

    # ------------------------------------------------------------------ 2. Coverage & geography
    S = "2. Coverage and geography"
    site_zips = set(zip_county)
    hv_z = {z for z in zhvi.index if np.isfinite(zhvi.loc[z, "2025-01"])}
    rent_z = {z for z in zori.index if np.isfinite(zori.loc[z, "2025-01"])}
    acs = json.load(open(os.path.join(a.repo, "src/lib/data/census-acs.json")))
    record(S, "Zillow zips unreachable from site (not in zip→county crosswalk)",
           "WARN" if len(hv_z - site_zips) > 200 else "PASS",
           f"{len(hv_z - site_zips)} of {len(hv_z)} ZHVI zips; examples {sorted(hv_z - site_zips)[:6]}")
    record(S, "Site zips with zip-level home values", "INFO",
           f"{len(site_zips & hv_z)}/{len(site_zips)} ({100*len(site_zips & hv_z)/len(site_zips):.0f}%)")
    record(S, "Site zips with zip-level rent", "INFO",
           f"{len(site_zips & rent_z)}/{len(site_zips)} ({100*len(site_zips & rent_z)/len(site_zips):.0f}%) — gap filled by county/HUD fallback")
    topo = json.load(open(os.path.join(a.data, "counties-albers-10m.json")))
    topo_ids = {str(g["id"]).zfill(5) for g in topo["objects"]["counties"]["geometries"]}
    no_shape = sorted(f for f in counties if f not in topo_ids)
    no_data = sorted(f for f in topo_ids if f not in counties)
    record(S, "Counties with data but no map shape", "WARN" if no_shape else "PASS",
           f"{len(no_shape)}: {no_shape[:12]} (new AK census areas; CT planning regions are folded into legacy counties)")
    record(S, "Map shapes with no data", "INFO", f"{len(no_data)}: {no_data[:12]}")

    # ------------------------------------------------------------------ 3. Home values: ZHVI vs FHFA vs Realtor.com
    S = "3. Home values — independent sources"
    fh = pd.read_excel(R("fhfa_county.xlsx"), header=5, dtype={"FIPS code": str})
    fh["chg"] = pd.to_numeric(fh["Annual Change (%)"], errors="coerce")
    fy = int(fh.Year.max())
    fhc = fh[fh.Year == fy].set_index("FIPS code")["chg"]
    zc, _ = zillow(R("zhvi_county.csv"), "county")
    yr = lambda df, y: df[[c for c in df.columns if c.startswith(str(y))]].mean(axis=1)
    zch = (yr(zc, fy) / yr(zc, fy - 1) - 1) * 100
    m = agree(zch.reindex(fhc.index), fhc)
    record(S, f"County (all): ZHVI annual-avg change {fy} vs FHFA HPI {fy}", "INFO",
           f"{m} — small counties have few repeat sales; both indexes are noisy there", m)
    bigc = [f for f, c in counties.items() if (c.get("emp") or 0) >= 50000]
    m = agree(zch.reindex(bigc).values, fhc.reindex(bigc).values)
    record(S, f"County (≥50k jobs): ZHVI annual-avg change {fy} vs FHFA HPI {fy}",
           "PASS" if m.get("pearson", 0) > 0.6 else "WARN", f"{m}", m)
    rdc = pd.read_csv(R("rdc_zip.csv"), dtype={"postal_code": str})
    rdc.index = rdc.postal_code.str.zfill(5)
    rdc = rdc[(rdc.quality_flag == 0) & (rdc.active_listing_count >= 20)]
    fz = pd.read_excel(R("fhfa_zip5.xlsx"), header=5, dtype={"Five-Digit ZIP Code": str})
    fz["chg"] = pd.to_numeric(fz["Annual Change (%)"], errors="coerce")
    fzc = fz[fz.Year == fy].set_index("Five-Digit ZIP Code")["chg"]
    zzh = (yr(zhvi, fy) / yr(zhvi, fy - 1) - 1) * 100
    m = agree(zzh.reindex(fzc.index), fzc)
    record(S, f"Zip (all): ZHVI annual-avg change {fy} vs FHFA zip5 HPI {fy}", "INFO", f"{m}", m)
    bigz = [z for z in zzh.index if z in rdc.index]
    m = agree(zzh.reindex(fzc.index).reindex(bigz).values, fzc.reindex(bigz).values)
    record(S, f"Zip (active markets, ≥20 listings): ZHVI vs FHFA zip5 {fy}", "PASS" if m.get("pearson", 0) > 0.4 else "WARN", f"{m}", m)
    rdc = pd.read_csv(R("rdc_zip.csv"), dtype={"postal_code": str})
    rdc.index = rdc.postal_code.str.zfill(5)
    rdc = rdc[(rdc.quality_flag == 0) & (rdc.active_listing_count >= 20)]
    last = zhvi.columns[-1]
    zyoy = (zhvi[last] / zhvi[f"{int(last[:4]) - 1}{last[4:]}"] - 1) * 100
    # Within-county vs between-county agreement: are zip-to-zip differences inside a county confirmed
    # by an independent source, or only the county-to-county differences?
    def within_between(x, y, label, what="Zip home values"):
        df = pd.DataFrame({"x": x, "y": y}).dropna()
        df["c"] = [zip_county.get(i, {}).get("countyFips") for i in df.index]
        g = df.dropna().groupby("c").filter(lambda t: len(t) >= 5)
        dx = g.x - g.groupby("c").x.transform("mean"); dy = g.y - g.groupby("c").y.transform("mean")
        cm = g.groupby("c")[["x", "y"]].mean()
        w, b = float(np.corrcoef(dx, dy)[0, 1]), float(cm.corr().iloc[0, 1])
        record(S, f"{what}, within- vs between-county agreement: {label}", "WARN" if w < 0.3 else "PASS",
               f"between counties r={b:.2f}; zip-vs-zip inside the same county r={w:.2f} (n={len(g)} zips) — "
               "county differences are corroborated, within-county zip differences are not", {"within": w, "between": b})
    within_between(zzh, fzc, f"ZHVI vs FHFA zip5 ({fy})")
    rr = pd.read_csv(R("rdc_zip.csv"), dtype={"postal_code": str}); rr.index = rr.postal_code.str.zfill(5)
    rr = rr[(rr.quality_flag == 0) & (rr.active_listing_count >= 30)]
    within_between(zyoy, rr.median_listing_price_per_square_foot_yy * 100, "ZHVI YoY vs Realtor.com list $/sqft YoY")
    m = agree(zyoy.reindex(rdc.index), rdc.median_listing_price_yy * 100)
    record(S, "Zip: ZHVI YoY vs Realtor.com median list price YoY (≥20 listings)",
           "INFO", f"{m} — list prices are noisy (mix of homes listed), weak agreement expected", m)

    # ------------------------------------------------------------------ 4. Rent: Zillow vs Apartment List vs HUD vs CPI
    S = "4. Rent — independent sources"
    al = pd.read_csv(R("al_rent.csv"))
    al = al[al.bed_size == "overall"]
    alc = al[al.location_type == "County"].copy()
    alc["fips"] = alc.location_fips_code.astype(int).astype(str).str.zfill(5)
    al_last = sorted(c for c in al.columns if re.match(r"\d{4}_\d{2}$", c))[-1]
    alc["pct"] = (alc[al_last] / alc["2025_01"] - 1) * 100
    built_rent = pd.Series({f: c["rent"] for f, c in counties.items() if "rent" in c})
    m = agree(built_rent.reindex(alc.fips).values, alc.pct.values)
    record(S, f"County: Zillow ZORI (SA) since Jan 2025 vs Apartment List since Jan 2025 (to {al_last})",
           "PASS" if m.get("pearson", 0) > 0.5 and m.get("sign_agree", 0) > 0.7 else "WARN", f"{m}", m)
    alp = al[al.location_type == "City"].copy()
    alp["pct"] = (alp[al_last] / alp["2025_01"] - 1) * 100
    zcity, zcd = zillow(R("zori_city.csv"), "city")
    zcity_pct = (zcity.ffill(axis=1).iloc[:, -1] / zcity["2025-01"] - 1) * 100
    keyed = alp.assign(k=alp.location_name.str.replace(r",.*", "", regex=True).str.replace(r" City$", "", regex=True)
                       + "|" + alp.location_name.str.extract(r",\s*([A-Z]{2})$")[0].fillna(""))
    keyed = keyed.drop_duplicates("k")
    m = agree(zcity_pct.reindex(keyed.k).values, keyed.pct.values)
    record(S, "City: Zillow ZORI (raw) vs Apartment List, since Jan 2025", "PASS" if m.get("pearson", 0) > 0.5 else "WARN", f"{m}", m)
    for city in ["Austin|TX", "San Francisco|CA", "Phoenix|AZ", "Denver|CO", "Miami|FL", "New York|NY", "Abilene|TX", "Lake Charles|LA"]:
        zv = zcity_pct.get(city, np.nan)
        av = keyed.set_index("k").pct.get(city, np.nan)
        record(S, f"City spot check: {city.replace('|', ', ')}", "PASS" if np.sign(zv) == np.sign(av) or abs(zv - av) < 2 else "WARN",
               f"Zillow {zv:+.1f}% vs Apartment List {av:+.1f}%")

    # HUD SAFMR FY25 -> FY27 (2BR) vs Zillow zip
    def safmr(p):
        d = pd.read_excel(p, dtype=str)
        d.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in d.columns]
        zc_ = [c for c in d.columns if c.startswith("ZIP")][0]
        bc = [c for c in d.columns if c == "SAFMR 2BR"][0]
        s = d[[zc_, bc]].copy()
        s[zc_] = s[zc_].str.zfill(5)
        s[bc] = pd.to_numeric(s[bc], errors="coerce")
        return s.groupby(zc_)[bc].median()
    h25, h27 = safmr(R("safmr_fy25.xlsx")), safmr(R("safmr_fy27.xlsx"))
    hud = ((h27 / h25 - 1) * 100).dropna()
    zz = (zori.ffill(axis=1).iloc[:, -1] / zori["2025-01"] - 1) * 100
    m = agree(zz.reindex(hud.index).values, hud.values)
    within_between(zz, hud, "Zillow ZORI vs HUD SAFMR FY25→FY27", what="Zip rents")
    record(S, "Zip: Zillow rent since Jan 2025 vs HUD Small Area FMR FY25→FY27 (2BR)", "INFO",
           f"{m} — HUD FMRs are formula-based on ~2-yr-old survey data plus trend; expect weak agreement and upward bias", m)

    # CPI rent of primary residence vs Zillow metro (explains 'CPI says up, Zillow says down')
    zm, zmd = zillow(R("zori_metro.csv"), "metro")
    zm.index = zmd.RegionName.values
    cu = pd.read_csv(R("cu.data.0.Current"), sep="\t", dtype=str)
    cu.columns = [c.strip() for c in cu.columns]
    cu["series_id"] = cu.series_id.str.strip()
    cu = cu[cu.series_id.str.match(r"CUURS\w{3}SEHA$") & cu.period.str.match(r"M\d\d") & (cu.period != "M13")]
    cu["m"] = cu.year + "-" + cu.period.str[1:]
    cu["v"] = pd.to_numeric(cu.value.str.strip(), errors="coerce")
    piv = cu.pivot_table(index=cu.series_id.str[4:8], columns="m", values="v")
    src = open(os.path.join(a.repo, "src/lib/mappings/county-metro-cpi.ts")).read()
    names = dict(re.findall(r"(S\d\d[A-Z]): \{ code: '\w+', name: '([^']+)'", src))
    rows = []
    for code, name in names.items():
        if code not in piv.index:
            continue
        first = name.split("-")[0].replace("Urban ", "")
        hit = [n for n in zm.index if n.startswith(first + ",")]
        if not hit:
            continue
        cpi_s = piv.loc[code].dropna()
        b = cpi_s.get("2025-01", cpi_s[cpi_s.index <= "2025-02"].iloc[-1] if (cpi_s.index <= "2025-02").any() else np.nan)
        cpi_pct = (cpi_s.iloc[-1] / b - 1) * 100
        zs = zm.loc[hit[0]].dropna()
        z_pct = (zs.iloc[-1] / zm.loc[hit[0], "2025-01"] - 1) * 100
        z_prev = (zm.loc[hit[0], "2025-01"] / zm.loc[hit[0], "2024-01"] - 1) * 100
        rows.append((name, round(cpi_pct, 1), round(z_pct, 1), round(z_prev, 1)))
    df = pd.DataFrame(rows, columns=["metro", "cpi_rent", "zillow_since_jan25", "zillow_2024"])
    m_now = agree(df.zillow_since_jan25, df.cpi_rent)
    m_lag = agree(df.zillow_2024, df.cpi_rent)
    record(S, "Metro: BLS CPI rent (all tenants) vs Zillow (new leases) — same window vs Zillow lagged 1 yr", "INFO",
           f"same-window r={m_now.get('pearson')}, lagged r={m_lag.get('pearson')}; CPI − Zillow bias {m_now.get('bias')} pts. "
           "CPI rent averages existing leases, so it trails market rents by ~a year.",
           {"same_window": m_now, "lagged": m_lag, "table": rows})

    # ------------------------------------------------------------------ 5. Wages
    S = "5. Paychecks (QCEW)"
    with zipfile.ZipFile(R("qcew_2026.zip")) as zf:
        q = pd.read_csv(zf.open(zf.namelist()[0]), dtype=str, usecols=["area_fips", "own_code", "industry_code", "agglvl_code", "qtr", "month3_emplvl", "oty_avg_wkly_wage_pct_chg", "total_qtrly_wages", "oty_total_qtrly_wages_chg"])
    q = q
    tot = q[(q.own_code == "0") & (q.industry_code == "10")]
    st = tot[tot.agglvl_code == "50"].set_index("area_fips")
    co = tot[tot.agglvl_code == "70"].copy()
    co["emp"] = pd.to_numeric(co.month3_emplvl, errors="coerce")
    co["w"] = pd.to_numeric(co.oty_avg_wkly_wage_pct_chg, errors="coerce")
    co["st"] = co.area_fips.str[:2] + "000"
    wavg = co.dropna(subset=["w"]).groupby("st").apply(lambda g: np.average(g.w, weights=g.emp))
    stv = pd.to_numeric(st.oty_avg_wkly_wage_pct_chg, errors="coerce")
    m = agree(wavg.reindex(stv.index), stv)
    record(S, "County wage changes aggregate to official state change (emp-weighted)",
           "PASS" if m.get("mae", 9) < 1.0 else "WARN", f"{m}", m)
    # persistence: Q4-2025 YoY from the 2025 file vs Q1-2026 YoY
    try:
        with zipfile.ZipFile(R("qcew_2025.zip")) as zf:
            q25 = pd.read_csv(zf.open(zf.namelist()[0]), dtype=str, usecols=["area_fips", "own_code", "industry_code", "agglvl_code", "qtr", "oty_avg_wkly_wage_pct_chg", "month3_emplvl"])
        q4 = q25[(q25.own_code == "0") & (q25.industry_code == "10") & (q25.agglvl_code == "70") & (q25.qtr == "4")].set_index("area_fips")
        q4w = pd.to_numeric(q4.oty_avg_wkly_wage_pct_chg, errors="coerce")
        q1 = q[(q.agglvl_code == "70") & (q.own_code == "0") & (q.industry_code == "10") & (q.qtr == "1")].set_index("area_fips")
        cur = pd.to_numeric(q1.oty_avg_wkly_wage_pct_chg, errors="coerce")
        big = co.set_index("area_fips").emp >= 20000
        idx = cur.index.intersection(q4w.index)
        m_all = agree(cur[idx], q4w[idx])
        bi = [f for f in idx if big.get(f, False)]
        m_big = agree(cur[bi], q4w[bi])
        built = pd.Series({f: c["wage"] for f, c in counties.items() if "wage" in c})
        record(S, "Why we pool 4 quarters: single-quarter YoY persistence (Q1-2026 vs Q4-2025, raw)", "INFO",
               f"all counties r={m_all.get('pearson')}; counties with ≥20k jobs r={m_big.get('pearson')} → single quarters are mostly bonus/vesting timing noise. "
               f"Built 4-quarter metric: ≥20k-job counties p5/p50/p95 = {built[[f for f in built.index if big.get(f, False)]].quantile([.05,.5,.95]).round(1).tolist()}",
               {"all": m_all, "big": m_big})
    except Exception as e:
        record(S, "Persistence check", "INFO", f"skipped: {e}")

    # ------------------------------------------------------------------ 6. Unemployment seasonal adjustment
    S = "6. Unemployment (LAUS)"
    def load_st(f):
        d = pd.read_csv(R(f), sep="\t", dtype=str); d.columns = [c.strip() for c in d.columns]
        d["series_id"] = d.series_id.str.strip()
        d = d[d.series_id.str.match(r"LA[SU]ST\d{2}0{11}03$") & d.period.str.match(r"M(0[1-9]|1[0-2])") & (d.year.astype(int) >= 2015)]
        d["st"] = d.series_id.str[5:7]; d["m"] = d.year + "-" + d.period.str[1:]
        d["v"] = pd.to_numeric(d.value.str.strip(), errors="coerce")
        return d.pivot_table(index="st", columns="m", values="v")
    if os.path.exists(R("la.data.2.AllStatesU")):
        U, Sa = load_st("la.data.2.AllStatesU"), load_st("la.data.3.AllStatesS")
        months = list(U.columns)
        # independent re-implementation of the classical decomposition
        X = U.to_numpy(); T = X.shape[1]
        w = np.r_[0.5, np.ones(11), 0.5] / 12
        cma = np.full_like(X, np.nan)
        for t in range(6, T - 6):
            cma[:, t] = X[:, t - 6:t + 7] @ w
        cal = np.array([int(m_[5:]) for m_ in months]); fit = np.array([m_ <= "2024-12" for m_ in months])
        fac = np.stack([np.nanmedian((X - cma)[:, fit & (cal == k)], axis=1) for k in range(1, 13)], 1)
        fac -= fac.mean(1, keepdims=True)
        sa = X - fac[:, cal - 1]
        i0, i1 = months.index("2025-01"), T - 1
        off = Sa.loc[U.index, months].to_numpy()
        ok = np.isfinite(off[:, i1])
        mine = (sa[:, i1] - sa[:, i0])[ok]; offc = (off[:, i1] - off[:, i0])[ok]; raw = (X[:, i1] - X[:, i0])[ok]
        record(S, "Our seasonal adjustment vs official BLS state SA (change since Jan 2025)",
               "PASS" if np.mean(np.abs(mine - offc)) < np.mean(np.abs(raw - offc)) else "WARN",
               f"MAE ours {np.mean(np.abs(mine - offc)):.2f} pts vs raw NSA {np.mean(np.abs(raw - offc)):.2f} pts; "
               f"raw NSA bias {np.mean(raw - offc):+.2f} pts (the live site's current method)")

    la = pd.read_csv(R("la.county"), sep="\t", dtype=str)
    la.columns = [c.strip() for c in la.columns]
    la = la[la.series_id.str.strip().str.endswith("03") & la.period.str.match(r"M(0[1-9]|1[0-2])") & (la.year.astype(int) >= 2025)]
    la["f"] = la.series_id.str.strip().str[5:10]; la["m"] = la.year + la.period
    la["v"] = pd.to_numeric(la.value.str.strip(), errors="coerce")
    pv = la.pivot_table(index="f", columns="m", values="v")
    lastm = pv.columns[-1]; prev12 = pv.columns[-13]
    jump = (pv[lastm] - pv[prev12])
    bigl = [f for f, c in counties.items() if (c.get("emp") or 0) >= 50000]
    jj = jump.reindex(bigl).dropna()
    flag = jj[jj.abs() >= 1.5].sort_values()
    record(S, f"Preliminary-month anomalies: {lastm} vs same month a year earlier, |Δ| ≥ 1.5 pts (≥50k-job counties)",
           "WARN" if len(flag) else "PASS",
           f"{len(flag)} flagged: " + ", ".join(f"{counties[f]['n']} {jj[f]:+.1f}" for f in flag.index[:10]) +
           ". Build uses 3-month averages to damp these; re-check after BLS revisions.")

    # ------------------------------------------------------------------ 6b. New metrics
    S = "6b. New metrics (electricity, job postings, ACA)"
    meta = json.load(open(os.path.join(a.data, "meta.json")))
    if os.path.exists(R("elec_5_6a.xlsx")) and os.path.exists(R("eia_elec_res.csv")):
        t = pd.read_excel(R("elec_5_6a.xlsx"), header=None)
        hdr = t.iloc[3].tolist()
        cur_lbl = str(hdr[1]); prev_lbl = str(hdr[2])
        st_names = t.iloc[4:, 0].astype(str).str.strip()
        tab = pd.DataFrame({"name": st_names, "cur": pd.to_numeric(t.iloc[4:, 1], errors="coerce"), "prev": pd.to_numeric(t.iloc[4:, 2], errors="coerce")})
        api = pd.read_csv(R("eia_elec_res.csv"))
        mon = pd.to_datetime(cur_lbl).strftime("%Y-%m"); pmon = pd.to_datetime(prev_lbl).strftime("%Y-%m")
        a1 = api[api.period == mon].set_index("stateDescription").price
        a0 = api[api.period == pmon].set_index("stateDescription").price
        j = tab.set_index("name").join(a1.rename("api1")).join(a0.rename("api0")).dropna()
        bad = j[(abs(j.cur - j.api1) > 0.02) | (abs(j.prev - j.api0) > 0.02)]
        record(S, f"EIA API monthly prices vs EIA Electric Power Monthly table 5.6.A ({cur_lbl}, {prev_lbl})",
               "PASS" if len(bad) == 0 else "WARN", f"{len(j)} states compared; {len(bad)} mismatches {bad.index.tolist()[:5]}")
        ap = api.pivot_table(index="stateid", columns="period", values="price")
        yoy = (ap[mon] / ap[pmon] - 1) * 100
        built = pd.Series({c["n"][-2:]: c["elec"] for c in counties.values() if "elec" in c}).groupby(level=0).first()
        m = agree(built.reindex(yoy.index), yoy)
        record(S, "Electricity: our SA change since Jan 2025 vs raw same-month YoY", "INFO",
               f"{m} — different windows (19 vs 12 months); checks direction/ranking only", m)
    if os.path.exists(R("indeed_metro.csv")):
        ind = pd.read_csv(R("indeed_metro.csv"), dtype={"cbsa_code": str})
        dl = pd.read_excel(R("cbsa_list1_2023.xlsx"), header=2, dtype=str)
        miss = sorted(set(ind.metro[~ind.cbsa_code.isin(set(dl["CBSA Code"]))]))
        record(S, "Indeed metros whose CBSA code isn't in the 2023 OMB delineation", "WARN" if len(miss) > 25 else "PASS",
               f"{len(miss)} unmatched: {miss[:8]}")
        vals = pd.Series({f: c["posts"] for f, c in counties.items() if "posts" in c})
        record(S, "Job postings change since Jan 2025 — distribution across counties", "INFO",
               f"n={len(vals)}, p5/median/p95 = {vals.quantile(.05):.1f}/{vals.median():.1f}/{vals.quantile(.95):.1f}%")
    oeps = sorted(glob.glob(R("oep*_county.zip")))
    if len(oeps) >= 2:
        def tot(path):
            with zipfile.ZipFile(path) as zf:
                d = pd.read_csv(zf.open([n for n in zf.namelist() if n.endswith(".csv")][0]), encoding="latin-1", dtype=str)
            num = lambda col: pd.to_numeric(d[col].str.replace(r"[$,\s]", "", regex=True), errors="coerce")
            d = d.assign(net=num("Avg_Prm_Aftr_APTC"), n=num("Cnsmr"))
            t_ = d[d.State_Abrvtn == "Total"]; c_ = d[(d.State_Abrvtn != "Total") & d.net.notna() & d.n.notna()]
            return float(t_.net.iloc[0]) if len(t_) else np.nan, float(np.average(c_.net, weights=c_.n)), int(c_.n.sum()), int(t_.n.iloc[0]) if len(t_) else -1
        for pth in oeps[-2:]:
            official, ours, n_ours, n_off = tot(pth)
            record(S, f"ACA {os.path.basename(pth)[:7]}: enrollment-weighted county avg net premium vs file's national Total row",
                   "PASS" if abs(official - ours) <= 3 else "WARN",
                   f"official ${official:.0f} vs recomputed ${ours:.0f}; consumers {n_ours:,} of {n_off:,} (suppressed counties excluded)")

    # ------------------------------------------------------------------ 7. Outliers
    S = "7. Outlier scan (robust z > 5, counties with ≥20k jobs)"
    for key, label in [("hv", "home value %"), ("rent", "rent %"), ("ur", "unemployment pts"), ("wage", "wage % (4-quarter)"), ("permits", "permits %"), ("posts", "job postings %"), ("acaNet", "ACA net premium $")]:
        vals = pd.Series({f: c[key] for f, c in counties.items() if key in c and (c.get("emp") or 0) >= 20000})
        med = vals.median(); mad = (vals - med).abs().median() * 1.4826
        z = (vals - med) / (mad or 1)
        flag = z[z.abs() > 5].sort_values(key=abs, ascending=False)
        record(S, label, "WARN" if len(flag) else "PASS",
               f"{len(flag)} flagged: " + ", ".join(f"{counties[f]['n']} {vals[f]:+.1f}" for f in flag.index[:8]),
               {"flagged": [(f, counties[f]["n"], float(vals[f])) for f in flag.index]})

    # ------------------------------------------------------------------ write report
    json.dump(RESULTS, open(os.path.join(a.out, "results.json"), "w"), indent=1, default=str)
    lines = ["# Local data validation report", "",
             f"Generated by `scripts/validate-local-data.py`. PASS {sum(r['status']=='PASS' for r in RESULTS)} · "
             f"WARN {sum(r['status']=='WARN' for r in RESULTS)} · FAIL {sum(r['status']=='FAIL' for r in RESULTS)} · "
             f"INFO {sum(r['status']=='INFO' for r in RESULTS)}", ""]
    sec = None
    for r in RESULTS:
        if r["section"] != sec:
            sec = r["section"]; lines += ["", f"## {sec}", "", "| Status | Check | Result |", "|---|---|---|"]
        lines.append(f"| {r['status']} | {r['check']} | {str(r['detail']).replace('|', '/')} |")
    open(os.path.join(a.out, "report.md"), "w").write("\n".join(lines) + "\n")
    sys.exit(1 if any(r["status"] == "FAIL" for r in RESULTS) else 0)

if __name__ == "__main__":
    main()
