#!/usr/bin/env bash
# Downloads the free bulk files used by scripts/build-local-data.py and scripts/validate-local-data.py.
# Usage: EIA_API_KEY=... scripts/fetch-local-data.sh <raw_dir>
# Everything is keyless except the EIA electricity API (falls back to DEMO_KEY, which is rate-limited).
# Portable to macOS (bash 3.2, BSD date) and Linux. Any failed required download fails the run.
set -euo pipefail
RAW=${1:-raw}; mkdir -p "$RAW"; cd "$RAW"
PYTHON=${PYTHON:-python3}
# BLS (download.bls.gov) returns 403 unless the User-Agent carries a contact email. BLS_CONTACT_EMAIL
# (repo secret in CI) is required and must be a monitored inbox; there is no default.
if [ -z "${BLS_CONTACT_EMAIL:-}" ]; then
  echo "error: BLS_CONTACT_EMAIL is not set. download.bls.gov requires a contact email in the User-Agent;" >&2
  echo "       set it to a monitored inbox (GitHub: repository secret BLS_CONTACT_EMAIL)." >&2
  exit 1
fi
UA_BOT="whatchanged.us data refresh (${BLS_CONTACT_EMAIL})"
UA_BROWSER="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
Z=https://files.zillowstatic.com/research/public_csvs
Y=$(date -u +%Y); PY=$((Y-1)); M=$((10#$(date -u +%m)))

dl()  { curl -sSfL -A "$UA_BOT" --retry 3 -o "$1" "$2" && echo "ok $1"; }
dlb() { curl -sSfL -A "$UA_BROWSER" -H "Accept: text/html,*/*" --retry 3 -o "$1" "$2" && echo "ok $1"; }
lower() { echo "$1" | tr '[:upper:]' '[:lower:]'; }

# Background jobs: remember each PID + file name, then wait on every one so a failed curl fails the run.
PIDS=(); NAMES=()
bg() { "$@" & PIDS+=($!); NAMES+=("$2"); }
wait_all() {
  local fail=0 i
  for i in "${!PIDS[@]}"; do
    if ! wait "${PIDS[$i]}"; then echo "FAILED: ${NAMES[$i]}" >&2; fail=1; fi
  done
  PIDS=(); NAMES=()
  return $fail
}

# Census BPS county YTD file: newest month that exists (usually 2 months back), and the same month a year earlier
BPS_M=""
for back in 1 2 3 4; do
  bm=$((M - back)); by=$Y
  if [ $bm -le 0 ]; then bm=$((bm + 12)); by=$((by - 1)); fi
  cand=$(printf %02d%02d $((by % 100)) $bm)
  if curl -sfI -A "$UA_BOT" "https://www2.census.gov/econ/bps/County/co${cand}y.txt" >/dev/null; then BPS_M=$cand; break; fi
done
[ -n "$BPS_M" ] || { echo "FAILED: no Census BPS county file found for the last 4 months" >&2; exit 1; }
BPS_PM=$(printf %02d $((10#${BPS_M:0:2} - 1)))${BPS_M:2:2}

QY=$Y; curl -sfI "https://data.bls.gov/cew/data/files/$QY/csv/${QY}_qtrly_singlefile.zip" >/dev/null || QY=$PY

# --- used by the build (all required) ---
for g in Zip County City; do
  lg=$(lower $g)
  bg dl zhvi_${lg}.csv $Z/zhvi/${g}_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
  bg dl zori_${lg}.csv $Z/zori/${g}_zori_uc_sfrcondomfr_sm_month.csv
done
bg dl zori_metro.csv $Z/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv
bg dl zhvi_metro.csv $Z/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv  # U.S. row for the Housing graph
bg dl rdc_zip.csv https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv
for y in $QY $((QY-1)) $((QY-2)); do bg dl qcew_$y.zip https://data.bls.gov/cew/data/files/$y/csv/${y}_qtrly_singlefile.zip; done
bg dl permits_cur.txt  https://www2.census.gov/econ/bps/County/co${BPS_M}y.txt
bg dl permits_prev.txt https://www2.census.gov/econ/bps/County/co${BPS_PM}y.txt
bg dl cu.data.0.Current https://download.bls.gov/pub/time.series/cu/cu.data.0.Current
bg dl la.county        https://download.bls.gov/pub/time.series/la/la.data.64.County
bg dl indeed_metro.csv https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/US/metro_job_postings_us.csv
bg dl cbsa_list1_2023.xlsx https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx
bg dl county_names.txt https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt

# ACA open-enrollment county files: newest two plan years that exist (probe first, then download)
rm -f oep*_county.zip
ACA_YEARS=()
for y in $((Y+1)) $Y $PY $((PY-1)); do
  [ ${#ACA_YEARS[@]} -ge 2 ] && break
  if curl -sfI -A "$UA_BROWSER" "https://www.cms.gov/files/zip/$y-oep-county-level-public-use-file.zip" >/dev/null; then ACA_YEARS+=($y); fi
done
[ ${#ACA_YEARS[@]} -eq 2 ] || { echo "FAILED: fewer than two CMS OEP county files found" >&2; exit 1; }
for y in "${ACA_YEARS[@]}"; do bg dlb oep${y}_county.zip "https://www.cms.gov/files/zip/$y-oep-county-level-public-use-file.zip"; done
wait_all

# EIA residential electricity price, all states, monthly since 2015 (paged).
# The key is passed through the environment (not argv) so it doesn't show up in process listings.
EIA_KEY=${EIA_API_KEY:-DEMO_KEY} "$PYTHON" - <<'PY'
import json, os, urllib.request, pandas as pd
key, rows, off = os.environ["EIA_KEY"], [], 0
while True:
    u = ("https://api.eia.gov/v2/electricity/retail-sales/data/?api_key=" + key + "&frequency=monthly&data[0]=price"
         "&facets[sectorid][]=RES&start=2015-01&sort[0][column]=period&sort[0][direction]=desc&length=5000&offset=" + str(off))
    r = json.load(urllib.request.urlopen(u, timeout=60))["response"]
    rows += r["data"]; off += 5000
    if off >= int(r["total"]): break
pd.DataFrame(rows).to_csv("eia_elec_res.csv", index=False); print("ok eia_elec_res.csv", len(rows))
PY

# --- validation-only sources (required: the validator reads them) ---
bg dl la.data.2.AllStatesU https://download.bls.gov/pub/time.series/la/la.data.2.AllStatesU
bg dl la.data.3.AllStatesS https://download.bls.gov/pub/time.series/la/la.data.3.AllStatesS
bg dlb fhfa_county.xlsx https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx
bg dlb fhfa_zip5.xlsx   https://www.fhfa.gov/hpi/download/annual/hpi_at_zip5.xlsx
bg dlb safmr_fy25.xlsx  https://www.huduser.gov/portal/datasets/fmr/fmr2025/fy2025_safmrs.xlsx
bg dlb safmr_fy27.xlsx  https://www.huduser.gov/portal/datasets/fmr/fmr2027/FY27_safmrs.xlsx
bg dlb elec_5_6a.xlsx   https://www.eia.gov/electricity/monthly/xls/table_5_06_a.xlsx
wait_all

# Apartment List (best effort, validation-only): CSV URL changes monthly, scrape it from the data page
AL=$(curl -sSfL -A "$UA_BROWSER" https://www.apartmentlist.com/research/category/data-rent-estimates \
     | grep -oE '//assets\.ctfassets\.net/[^"\\ ]*Apartment_List_Rent_Estimates_[0-9]{4}_[0-9]{2}\.csv' | head -1 || true)
if [ -n "$AL" ]; then dl al_rent.csv "https:$AL" || echo "WARN: Apartment List download failed (validation-only)" >&2
else echo "WARN: Apartment List CSV link not found (validation-only)" >&2; fi
