#!/usr/bin/env bash
# Downloads the free bulk files used by scripts/build-local-data.py and scripts/validate-local-data.py.
# Usage: scripts/fetch-local-data.sh <raw_dir>
# Everything is keyless. Portable to macOS (bash 3.2) and Linux. Any failed required download fails the run.
set -euo pipefail
RAW=${1:-raw}; mkdir -p "$RAW"; cd "$RAW"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
Z=https://files.zillowstatic.com/research/public_csvs
Y=$(date -u +%Y); PY=$((Y-1))

dl() { curl -sSfL -A "$UA" -H "Accept: text/html,*/*" --retry 3 -o "$1" "$2" && echo "ok $1"; }

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

# BLS QCEW singlefile for the newest year that exists (county jobs, latest quarter only)
QY=$Y; curl -sfI -A "$UA" "https://data.bls.gov/cew/data/files/$QY/csv/${QY}_qtrly_singlefile.zip" >/dev/null || QY=$PY

# --- used by the build (all required) ---
bg dl zhvi_county.csv $Z/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
bg dl zori_county.csv $Z/zori/County_zori_uc_sfrcondomfr_sm_month.csv
bg dl zhvi_metro.csv  $Z/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv  # U.S. row for the Housing graph
bg dl zori_metro.csv  $Z/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv                 # U.S. row for the Housing graph
bg dl zhvi_zip.csv    $Z/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv    # zip order (SizeRank) only: representative zip per county
bg dl qcew_$QY.zip    https://data.bls.gov/cew/data/files/$QY/csv/${QY}_qtrly_singlefile.zip
bg dl county_names.txt https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt

# --- validation-only sources (required: the validator reads them) ---
bg dl fhfa_county.xlsx https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx
wait_all

# Apartment List (best effort, validation-only): CSV URL changes monthly, scrape it from the data page
AL=$(curl -sSfL -A "$UA" https://www.apartmentlist.com/research/category/data-rent-estimates \
     | grep -oE '//assets\.ctfassets\.net/[^"\\ ]*Apartment_List_Rent_Estimates_[0-9]{4}_[0-9]{2}\.csv' | head -1 || true)
if [ -n "$AL" ]; then dl al_rent.csv "https:$AL" || echo "WARN: Apartment List download failed (validation-only)" >&2
else echo "WARN: Apartment List CSV link not found (validation-only)" >&2; fi
