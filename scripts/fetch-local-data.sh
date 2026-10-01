#!/usr/bin/env bash
# Downloads the free, keyless bulk files used by scripts/build-local-data.py.
# Usage: scripts/fetch-local-data.sh <raw_dir>
set -euo pipefail
RAW=${1:-raw}; mkdir -p "$RAW"; cd "$RAW"
UA="whatchanged.us data refresh (https://github.com/cgreenberg/whatchanged)"
Z=https://files.zillowstatic.com/research/public_csvs
Y=$(date -u +%Y); PY=$((Y-1))
# Latest finished BPS month (Census posts ~4 weeks after month end)
BPS_M=$(date -u -d "$(date -u +%Y-%m-15) -2 month" +%y%m); BPS_PM=$(( ${BPS_M:0:2} - 1 ))${BPS_M:2:2}
QY=$Y; curl -sfI "https://data.bls.gov/cew/data/files/$QY/csv/${QY}_qtrly_singlefile.zip" >/dev/null || QY=$PY
dl() { curl -sSfL -A "$UA" --retry 3 -o "$1" "$2"; echo "ok $1"; }
dl zhvi_zip.csv     $Z/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv &
dl zori_zip.csv     $Z/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv &
dl zhvi_county.csv  $Z/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv &
dl zori_county.csv  $Z/zori/County_zori_uc_sfrcondomfr_sm_month.csv &
dl rdc_zip.csv      https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv &
dl qcew_latest.zip    https://data.bls.gov/cew/data/files/$QY/csv/${QY}_qtrly_singlefile.zip &
dl permits_cur.txt  https://www2.census.gov/econ/bps/County/co${BPS_M}y.txt &
dl permits_prev.txt https://www2.census.gov/econ/bps/County/co$(printf %04d $BPS_PM)y.txt &
dl cu.data.0.Current https://download.bls.gov/pub/time.series/cu/cu.data.0.Current &
dl la.county        https://download.bls.gov/pub/time.series/la/la.data.64.County &
wait
