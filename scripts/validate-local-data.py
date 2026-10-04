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
from collections import defaultdict
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
    ALLOWED = {"n", "z", "hv", "hvCur", "rent", "rentCur", "emp", "approx", "approxFrom", "flags", "note", "hvS", "rentS",
               "rentSaPool"}
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
            [f for f, c in counties.items() if "hvS" in c or "rentS" in c or "rentM" in c or "rentMS" in c])
        inv("Shard records carry only fields the site reads",
            [(f, sorted(set(c) - ALLOWED - {"rentM", "rentMS"})) for f, c in shards.items() if set(c) - ALLOWED - {"rentM", "rentMS"}])
        pooled = [f for f, v in crj["counties"].items() if v.get("saPool")]
        record(S, "County rent seasonally adjusted with a pooled (state / U.S.) seasonal pattern (series too short for their own)",
               "INFO", f"{len(pooled)} of {len(crj['counties'])} counties, e.g. {pooled[:6]}")

        # ---------------------------------------------------------- metro rent (Rent card's metro rung)
        mr_path = os.path.join(a.repo, "src/lib/data/metro-rent.json")
        if not os.path.exists(mr_path):
            record(S, "metro-rent.json present", "FAIL", "missing")
        else:
            mrj = json.load(open(mr_path))
            metros, mcounties = mrj["metros"], mrj["counties"]
            inv("metro-rent.json: pct in [-30, 60], levels positive, as-of = Zillow metro file's latest month",
                [cb for cb, v in metros.items() if not (-30 <= v["pct"] <= 60 and v["curRent"] > 0 and v["baseRent"] > 0)])
            inv("metro-rent.json: no county with its own county rent row is mapped to a metro", sorted(set(mcounties) & set(crj["counties"])))
            inv("metro-rent.json: every mapped metro has a row", sorted({cb for cb in mcounties.values() if cb not in metros}))
            inv("No metro-mapped county has its own county rent series in the shards (rentS)",
                sorted(f for f in mcounties if shards.get(f, {}).get("rentS")))
            # Independent re-read: OMB March 2020 delineation (county -> CBSA) and Zillow's crosswalk (RegionID <-> CBSA)
            d20 = pd.read_excel(R("cbsa_list1_2020.xls"), header=2, dtype=str)
            d20 = d20[d20["CBSA Code"].notna() & d20["FIPS State Code"].notna()]
            omb = dict(zip(d20["FIPS State Code"].str.zfill(2) + d20["FIPS County Code"].str.zfill(3), d20["CBSA Code"]))
            omb_title = dict(zip(d20["CBSA Code"], d20["CBSA Title"]))
            inv("Every metro-mapped county is in that CBSA in the OMB March 2020 delineation",
                [(f, cb, omb.get(f)) for f, cb in mcounties.items() if omb.get(f) != cb])
            inv("Metro names are the OMB 2020 CBSA titles", [(cb, v["name"]) for cb, v in metros.items() if omb_title.get(cb) != v["name"]])
            # Zillow's own county files label each county with its metro's full title: they must agree with OMB 2020
            _, zrc_meta = zillow(R("zori_county.csv"), "county")
            _, zhc_meta = zillow(R("zhvi_county.csv"), "county")
            zmetro = {**zhc_meta["Metro"].dropna().to_dict(), **zrc_meta["Metro"].dropna().to_dict()}
            inv("Zillow's own county->metro labels agree with the mapping (same 2020 CBSA title)",
                [(f, zmetro[f], metros[cb]["name"]) for f, cb in mcounties.items() if f in zmetro and zmetro[f] != metros[cb]["name"]])
            # Zillow's labels mangle non-ASCII letters ("Ca±on City"): compare ASCII letters only
            asc = lambda t: re.sub(r"[^A-Za-z]", "", t.encode("ascii", "ignore").decode())
            vint = [f for f in zmetro if f in omb and asc(omb_title[omb[f]]) != asc(zmetro[f])]
            record(S, "Zillow county->metro labels vs OMB March 2020 CBSA titles (all Zillow counties; vintage check)",
                   "FAIL" if vint else "PASS", f"{len(vint)} disagreements {vint[:6]}" if vint else f"all {sum(f in omb for f in zmetro)} agree")
            xw = pd.read_csv(R("zillow_county_crosswalk.csv"), dtype=str, encoding="latin-1").dropna(subset=["CBSACode", "MetroRegionID_Zillow"])
            cb2id = dict(zip(xw.CBSACode, xw.MetroRegionID_Zillow))
            zm = pd.read_csv(R("zori_metro.csv"), dtype={"RegionID": str}).set_index("RegionID")
            mcols = [c for c in zm.columns if re.match(r"\d{4}-\d{2}-\d{2}$", c)]
            zmv = zm[mcols].apply(pd.to_numeric, errors="coerce"); zmv.columns = [c[:7] for c in mcols]
            lvl, sz = [], []
            for cb, v in metros.items():
                rid = cb2id.get(cb)
                if rid not in zmv.index:
                    lvl.append((cb, "no Zillow metro row")); continue
                row = zmv.loc[rid]
                if abs(row["2025-01"] - v["baseRent"]) > 0.51 or abs(row.dropna().iloc[-1] - v["curRent"]) > 0.51 or zmv.columns[-1] != v["asOf"]:
                    lvl.append(cb)
                sz.append(v["pct"] - (row.dropna().iloc[-1] / row["2025-01"] - 1) * 100)
            inv("Metro rent levels = observed Zillow metro ZORI (Jan 2025 and latest), via Zillow's RegionID<->CBSA link", lvl)
            sz = np.array(sz)
            record(S, "Metro rent seasonal adjustment size (built SA - raw NSA)", "PASS" if len(sz) and np.median(np.abs(sz)) < 2.5 else "WARN",
                   f"median |adj| {np.median(np.abs(sz)):.2f} pts over {len(sz)} metros" if len(sz) else "no metros")
            inv("Metro rentMS series reproduce metro-rent.json pct (Rent tab = Rent card)",
                [(f, metros[cb]["pct"], series_pct(shards.get(f, {}).get("rentMS"), metros[cb]["asOf"]))
                 for f, cb in mcounties.items() if f in shards and series_pct(shards[f].get("rentMS"), metros[cb]["asOf"]) != metros[cb]["pct"]])
            m_zips = sum(1 for v in zip_county.values() if v["countyFips"] in mcounties)
            record(S, "Zips that get metro rent (no county series)", "INFO", f"{m_zips} zips, {len(mcounties)} counties, {len(metros)} metros")

    # ------------------------------------------------------------------ 7. Static gas sources (AK DCRA, PR DACO)
    S = "7. Static gas sources"
    ak_path = os.path.join(a.repo, "src/lib/data/ak-gas.json")
    if os.path.exists(ak_path):
        ak = json.load(open(ak_path))
        meta_ = ak["meta"]
        inv("ak-gas.json: CC BY 4.0 attribution present", [] if meta_.get("license") == "CC BY 4.0" and meta_.get("publisher") else ["meta"])
        months = []
        y, mth = int(meta_["start"][:4]), int(meta_["start"][5:])
        while f"{y:04d}-{mth:02d}" <= meta_["latestSurvey"]:
            months.append(f"{y:04d}-{mth:02d}"); y, mth = (y, 7) if mth == 1 else (y + 1, 1)
        bi_, li_ = months.index("2025-01"), months.index(meta_["latestSurvey"])
        rows_ = list(ak["communities"].items()) + list(ak["regions"].items())
        inv("ak-gas.json: every community/region has the Jan 2025 and latest surveys, prices $1-$20",
            [k for k, v in rows_ if len(v["v"]) != len(months) or v["v"][bi_] is None or v["v"][li_] is None
             or any(x is not None and not 1 <= x <= 20 for x in v["v"])])
        ak_zips = {z for z, v in zip_county.items() if v["stateAbbr"] == "AK" and v["countyFips"] not in ("02020", "02170")}
        inv("ak-gas.json: every AK zip outside the Anchorage CBSA maps to a community or region", sorted(ak_zips - set(ak["zips"])))
        inv("ak-gas.json: nearest-community matches are in the zip's own borough and within 100 km",
            [z for z, m in ak["zips"].items() if m["k"] == "n" and (m["km"] > 100 or ak["communities"][m["c"]]["b"] != zip_county[z]["countyFips"])])
        # Independent re-read of the raw DCRA survey pages
        raw = defaultdict(dict)
        for fp in glob.glob(R("dcra_gas_*.json")):
            for f in json.load(open(fp))["features"]:
                at = f["attributes"]
                if at.get("GasRetailGal") is not None:
                    raw[at["CommunityName"]][f"{at['ReportingYear']}-{'01' if at['ReportingSeason'] == 'Winter' else '07'}"] = at["GasRetailGal"]
        if raw:
            inv("ak-gas.json community prices match the raw DCRA survey (Jan 2025 and latest)",
                [c for c, v in ak["communities"].items() if abs(raw[c].get("2025-01", -1) - v["v"][bi_]) > 0.001
                 or abs(raw[c].get(meta_["latestSurvey"], -1) - v["v"][li_]) > 0.001])
        kinds = defaultdict(int)
        for m in ak["zips"].values():
            kinds[m["k"]] += 1
        record(S, "AK zips by match (c = own community, n = nearest surveyed community, r = DCRA region average)", "INFO", dict(kinds))
    else:
        record(S, "ak-gas.json present", "FAIL", "missing")
    pr_path = os.path.join(a.repo, "src/lib/data/pr-gas.json")
    if os.path.exists(pr_path):
        pr = json.load(open(pr_path))
        if os.path.exists(R("daco_gas.xlsx")):
            import openpyxl
            ws = openpyxl.load_workbook(R("daco_gas.xlsx"), read_only=True, data_only=True).worksheets[0]
            rawpr = {f"{r[0].year:04d}-{r[0].month:02d}": r[2] / 100 for r in ws.iter_rows(values_only=True)
                     if r and hasattr(r[0], "year") and isinstance(r[2], (int, float))}
            y, mth = int(pr["meta"]["start"][:4]), int(pr["meta"]["start"][5:])
            bad = []
            for v in pr["v"]:
                k = f"{y:04d}-{mth:02d}"
                if (v is None) != (k not in rawpr) or (v is not None and abs(v - rawpr[k]) > 0.0001):
                    bad.append(k)
                mth += 1
                if mth > 12:
                    y, mth = y + 1, 1
            inv("pr-gas.json matches the raw DACO workbook (regular, cents -> $/gal) month by month", bad)
        inv("pr-gas.json: Jan 2025 and latest present, $1-$10/gal",
            [] if pr["v"][-1] is not None and all(x is None or 1 <= x <= 10 for x in pr["v"]) else ["range"])
    else:
        record(S, "pr-gas.json present", "FAIL", "missing")

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
