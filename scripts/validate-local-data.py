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

    # ------------------------------------------------------------------ 1. Re-derivation from raw
    S = "1. Built JSON matches raw source"
    zc, _ = zillow(R("zhvi_county.csv"), "county")
    zr, _ = zillow(R("zori_county.csv"), "county")
    errs = []
    for f, c in counties.items():
        if "hv" in c and f in zc.index and np.isfinite(zc.loc[f, "2025-01"]):
            row = zc.loc[f].dropna()
            exp = (row.iloc[-1] / zc.loc[f, "2025-01"] - 1) * 100
            if abs(c["hv"] - exp) > 0.06 or abs(c["hvCur"] - row.iloc[-1]) > 51:
                errs.append(f"{f} hv exp {exp:.2f} got {c['hv']}")
    record(S, "County home value % and level (every county, independent recompute from raw ZHVI)", "FAIL" if errs else "PASS",
           "; ".join(errs[:10]) or "all match raw ZHVI within 0.06 pts (level within $50, built rounds to $100)")

    # rent: raw (unadjusted) vs built (seasonally adjusted) — report size of adjustment
    diffs, lvl_err = [], []
    for f, c in counties.items():
        if "rent" in c and f in zr.index and np.isfinite(zr.loc[f, "2025-01"]):
            row = zr.loc[f].dropna()
            diffs.append(c["rent"] - (row.iloc[-1] / zr.loc[f, "2025-01"] - 1) * 100)
            if abs(c["rentCur"] - row.iloc[-1]) > 0.5:
                lvl_err.append(f)
    diffs = np.array(diffs)
    record(S, "Rent seasonal adjustment size (built SA − raw NSA, all counties)", "PASS" if np.median(np.abs(diffs)) < 2.5 else "WARN",
           f"median |adj| {np.median(np.abs(diffs)):.2f} pts, mean {diffs.mean():+.2f}, p95 |adj| {np.percentile(np.abs(diffs), 95):.2f}",
           {"n": len(diffs), "median_abs": round(float(np.median(np.abs(diffs))), 2), "mean": round(float(diffs.mean()), 2)})
    record(S, "County rent level = observed (unadjusted) latest ZORI", "FAIL" if lvl_err else "PASS",
           f"{len(lvl_err)} mismatches {lvl_err[:8]}" if lvl_err else "all match raw")

    # QCEW jobs (used only to pick large counties): independent re-read of the latest quarter
    qf = max(glob.glob(R("qcew_*.zip")))
    with zipfile.ZipFile(qf) as zf:
        qq = pd.read_csv(zf.open(zf.namelist()[0]), dtype=str, usecols=["area_fips", "year", "qtr", "own_code", "industry_code", "agglvl_code", "month1_emplvl", "month2_emplvl", "month3_emplvl"])
    qq = qq[(qq.agglvl_code == "70") & (qq.own_code == "0") & (qq.industry_code == "10")]
    qq = qq[(qq.year.astype(int) * 4 + qq.qtr.astype(int)) == (qq.year.astype(int) * 4 + qq.qtr.astype(int)).max()].set_index("area_fips")
    exp_emp = qq[["month1_emplvl", "month2_emplvl", "month3_emplvl"]].apply(pd.to_numeric, errors="coerce").mean(axis=1)
    bad = [f for f in ["06085", "48453", "36061", "17031", "53011"] if abs(counties[f].get("emp", -1) - exp_emp[f]) > 1]
    record(S, "County jobs (QCEW latest quarter, movers-list eligibility) vs independent re-read", "FAIL" if bad else "PASS",
           f"mismatches {bad}" if bad else "5 large counties match")

    # ------------------------------------------------------------------ 2. Coverage & geography
    S = "2. Coverage and geography"
    site_zips = set(zip_county)
    rent_cty = {f for f, c in counties.items() if "rent" in c}
    n_cty = sum(1 for v in zip_county.values() if v["countyFips"] in rent_cty)
    record(S, "Site zips whose county has published rent (SA since Jan 2025)", "INFO",
           f"{n_cty}/{len(site_zips)} ({100*n_cty/len(site_zips):.0f}%)")
    topo = json.load(open(os.path.join(a.data, "counties-albers-10m.json")))
    topo_ids = {str(g["id"]).zfill(5) for g in topo["objects"]["counties"]["geometries"]}
    no_shape = sorted(f for f in counties if f not in topo_ids)
    no_data = sorted(f for f in topo_ids if f not in counties)
    record(S, "Counties with data but no map shape", "WARN" if no_shape else "PASS",
           f"{len(no_shape)}: {no_shape[:12]} (new AK census areas; CT planning regions are folded into legacy counties)")
    record(S, "Map shapes with no data", "INFO", f"{len(no_data)}: {no_data[:12]}")

    # ------------------------------------------------------------------ 3. Home values: ZHVI vs FHFA vs Realtor.com
    S = "3. Home values — independent source (FHFA HPI)"
    fh = pd.read_excel(R("fhfa_county.xlsx"), header=5, dtype={"FIPS code": str})
    fh["chg"] = pd.to_numeric(fh["Annual Change (%)"], errors="coerce")
    fy = int(fh.Year.max())
    fhc = fh[fh.Year == fy].set_index("FIPS code")["chg"]
    yr = lambda df, y: df[[c for c in df.columns if c.startswith(str(y))]].mean(axis=1)
    zch = (yr(zc, fy) / yr(zc, fy - 1) - 1) * 100
    m = agree(zch.reindex(fhc.index), fhc)
    record(S, f"County (all): ZHVI annual-avg change {fy} vs FHFA HPI {fy}", "INFO",
           f"{m} — small counties have few repeat sales; both indexes are noisy there", m)
    bigc = [f for f, c in counties.items() if (c.get("emp") or 0) >= 50000]
    m = agree(zch.reindex(bigc).values, fhc.reindex(bigc).values)
    record(S, f"County (≥50k jobs): ZHVI annual-avg change {fy} vs FHFA HPI {fy}",
           "PASS" if m.get("pearson", 0) > 0.6 else "WARN", f"{m}", m)
    # ------------------------------------------------------------------ 4. Rent: Zillow vs Apartment List vs HUD vs CPI
    S = "4. Rent — independent source (Apartment List)"
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
    # ------------------------------------------------------------------ 7. Outliers
    S = "5. Outlier scan (robust z > 5, counties with ≥20k jobs)"
    for key, label in [("hv", "home value %"), ("rent", "rent %")]:
        vals = pd.Series({f: c[key] for f, c in counties.items() if key in c and (c.get("emp") or 0) >= 20000})
        med = vals.median(); mad = (vals - med).abs().median() * 1.4826
        z = (vals - med) / (mad or 1)
        flag = z[z.abs() > 5].sort_values(key=abs, ascending=False)
        record(S, label, "WARN" if len(flag) else "PASS",
               f"{len(flag)} flagged: " + ", ".join(f"{counties[f]['n']} {vals[f]:+.1f}" for f in flag.index[:8]),
               {"flagged": [(f, counties[f]["n"], float(vals[f])) for f in flag.index]})

    # ------------------------------------------------------------------ 8. Shipped-data invariants (FAIL on violation)
    S = "6. Shipped data invariants"
    def inv(name, bad, fmt=lambda b: str(b[:10])):
        record(S, name, "FAIL" if bad else "PASS", f"{len(bad)} violations: {fmt(bad)}" if bad else "none")
    inv("No county name equals its FIPS or is empty", [f for f, c in counties.items() if not c.get("n") or c["n"] == f])
    inv("No CT planning-region (091x0) or statewide rows", [f for f in counties if re.fullmatch(r"091[1-9]0", f) or f.endswith("000")])
    ranges = {"hv": (-50, 50), "rent": (-50, 80)}
    inv("County metrics within sanity ranges", [(f, k, c[k]) for f, c in counties.items() for k, (lo, hi) in ranges.items()
                                               if k in c and not lo <= c[k] <= hi])
    inv("No percentile-rank fields shipped", [(f, k) for f, c in counties.items() for k in c if re.fullmatch(r"[a-z]+R", k)])
    ALLOWED = {"n", "z", "hv", "hvCur", "rent", "rentCur", "emp", "approx", "approxFrom", "flags", "note", "hvS", "rentS"}
    inv("County records carry only fields the site reads", [(f, sorted(set(c) - ALLOWED)) for f, c in counties.items() if set(c) - ALLOWED])
    resolved = set(counties)
    # No source publishes these: Kalawao HI (15005) and the island territories (AS 60, GU 66, MP 69, VI 78)
    no_data_ok = lambda f: f == "15005" or f[:2] in ("60", "66", "69", "78")
    inv("Every crosswalk zip resolves to a county record",
        sorted(f for f in {v["countyFips"] for v in zip_county.values()} - resolved if not no_data_ok(f)))
    geo_path = os.path.join(a.repo, "src/lib/data/county-geo.json")
    geo = json.load(open(geo_path)) if os.path.exists(geo_path) else {}
    LEGACY_NOT_IN_GEO = {"02261"}  # Valdez-Cordova AK (map shape); legacy shape, not in the live geography
    if len(geo) < 3100:
        record(S, "county-geo.json present with >= 3,100 counties", "FAIL", f"{len(geo)} counties")
    else:
        inv("Every county with a rent figure (Rent card) is a county in county-geo.json (the live site's geography)",
            sorted(f for f, c in counties.items() if "rent" in c and f not in geo and f not in LEGACY_NOT_IN_GEO))
        miss_hv = sorted(f for f, c in counties.items() if "hv" in c and f not in geo and f not in LEGACY_NOT_IN_GEO)
        record(S, "Counties with a home-value figure but not in county-geo.json", "INFO", f"{len(miss_hv)}: {miss_hv[:8]} (VA independent cities merged in the live geography)")
    cr_path = os.path.join(a.repo, "src/lib/data/county-rent.json")
    if os.path.exists(cr_path):
        crj = json.load(open(cr_path))
        inv("county-rent.json: pct in [-30, 60], levels positive, matches counties.json",
            [f for f, v in crj["counties"].items() if not (-30 <= v["pct"] <= 60 and v["curRent"] > 0 and v["baseRent"] > 0
                                                         and counties.get(f, {}).get("rent") == v["pct"])])
        # Housing graph series (county shards): the Rent tab's latest % must equal the Rent card's %,
        # and the Home prices tab's latest % must equal the map's home-value %.
        shards = {}
        for sp in glob.glob(os.path.join(a.data, "county", "*.json")):
            shards.update(json.load(open(sp)))

        def series_pct(s, latest):
            if not s or not s.get("v"):
                return None
            y, m = int(s["start"][:4]), int(s["start"][5:])
            bi = (2025 - y) * 12 + (1 - m)
            v = s["v"]
            if bi < 0 or bi >= len(v) or v[bi] is None or v[-1] is None:
                return None
            n = len(v) - 1 + m - 1
            end = f"{y + n // 12:04d}-{n % 12 + 1:02d}"
            return round((v[-1] / v[bi] - 1) * 100, 1) if end == latest else ("stale", end)
        inv("County rentS series reproduce county-rent.json pct (Rent tab = Rent card)",
            [(f, v["pct"], series_pct(shards.get(f, {}).get("rentS"), v["asOf"])) for f, v in crj["counties"].items()
             if series_pct(shards.get(f, {}).get("rentS"), v["asOf"]) != v["pct"]])
        hv_latest = json.load(open(os.path.join(a.data, "meta.json")))["sources"]["zhvi"]["latest"]
        inv("County hvS series reproduce the county home-value % (Home prices tab = map)",
            [(f, c["hv"], series_pct(c.get("hvS"), hv_latest)) for f, c in shards.items()
             if "hv" in c and series_pct(c.get("hvS"), hv_latest) != c["hv"]])
        inv("counties.json carries no monthly series (kept in the per-state shards)",
            [f for f, c in counties.items() if "hvS" in c or "rentS" in c])

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
