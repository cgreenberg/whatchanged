#!/usr/bin/env bash
# Downloads the free bulk files used by scripts/build-local-data.py and scripts/validate-local-data.py.
# Usage: EIA_API_KEY=... scripts/fetch-local-data.sh <raw_dir>
# Everything is keyless except the EIA electricity API (falls back to DEMO_KEY, which is rate-limited).
set -euo pipefail
RAW=${1:-raw}; mkdir -p "$RAW"; cd "$RAW"
UA_BOT="whatchanged.us data refresh (https://github.com/cgreenberg/whatchanged)"
UA_BROWSER="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
Z=https://files.zillowstatic.com/research/public_csvs
Y=$(date -u +%Y); PY=$((Y-1))
BPS_M=$(date -u -d "$(date -u +%Y-%m-15) -2 month" +%y%m); BPS_PM=$(printf %02d $((10#${BPS_M:0:2} - 1)))${BPS_M:2:2}
QY=$Y; curl -sfI "https://data.bls.gov/cew/data/files/$QY/csv/${QY}_qtrly_singlefile.zip" >/dev/null || QY=$PY
dl()  { curl -sSfL -A "$UA_BOT" --retry 3 -o "$1" "$2" && echo "ok $1"; }
dlb() { curl -sSfL -A "$UA_BROWSER" -H "Accept: text/html,*/*" --retry 3 -o "$1" "$2" && echo "ok $1"; }

# --- used by the build ---
for g in Zip County City; do
  dl zhvi_${g,,}.csv $Z/zhvi/${g}_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv &
  dl zori_${g,,}.csv $Z/zori/${g}_zori_uc_sfrcondomfr_sm_month.csv &
done
dl zori_metro.csv $Z/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv &
dl rdc_zip.csv https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv &
for y in $QY $((QY-1)) $((QY-2)); do dl qcew_$y.zip https://data.bls.gov/cew/data/files/$y/csv/${y}_qtrly_singlefile.zip & done
dl permits_cur.txt  https://www2.census.gov/econ/bps/County/co${BPS_M}y.txt &
dl permits_prev.txt https://www2.census.gov/econ/bps/County/co${BPS_PM}y.txt &
dl cu.data.0.Current https://download.bls.gov/pub/time.series/cu/cu.data.0.Current &
dl la.county        https://download.bls.gov/pub/time.series/la/la.data.64.County &
dl indeed_metro.csv https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/US/metro_job_postings_us.csv &
dl cbsa_list1_2023.xlsx https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx &
# ACA open-enrollment county files: latest two plan years that exist
for y in $((Y+1)) $Y $PY $((PY-1)); do
  curl -sfI -A "$UA_BROWSER" "https://www.cms.gov/files/zip/$y-oep-county-level-public-use-file.zip" >/dev/null && dlb oep${y}_county.zip "https://www.cms.gov/files/zip/$y-oep-county-level-public-use-file.zip" &
done
wait
ls oep*_county.zip | sort | head -n -2 | xargs -r rm -f   # keep the newest two

# EIA residential electricity price, all states, monthly since 2015 (paged)
KEY=${EIA_API_KEY:-DEMO_KEY}
python3 - "$KEY" <<'PY'
import json, sys, urllib.request, pandas as pd
key, rows, off = sys.argv[1], [], 0
while True:
    u = ("https://api.eia.gov/v2/electricity/retail-sales/data/?api_key=" + key + "&frequency=monthly&data[0]=price"
         "&facets[sectorid][]=RES&start=2015-01&sort[0][column]=period&sort[0][direction]=desc&length=5000&offset=" + str(off))
    r = json.load(urllib.request.urlopen(u, timeout=60))["response"]
    rows += r["data"]; off += 5000
    if off >= int(r["total"]): break
pd.DataFrame(rows).to_csv("eia_elec_res.csv", index=False); print("ok eia_elec_res.csv", len(rows))
PY

# --- validation-only sources ---
dl la.data.2.AllStatesU https://download.bls.gov/pub/time.series/la/la.data.2.AllStatesU &
dl la.data.3.AllStatesS https://download.bls.gov/pub/time.series/la/la.data.3.AllStatesS &
dlb fhfa_county.xlsx https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx &
dlb fhfa_zip5.xlsx   https://www.fhfa.gov/hpi/download/annual/hpi_at_zip5.xlsx &
dlb safmr_fy25.xlsx  https://www.huduser.gov/portal/datasets/fmr/fmr2025/fy2025_safmrs.xlsx &
dlb safmr_fy27.xlsx  https://www.huduser.gov/portal/datasets/fmr/fmr2027/FY27_safmrs.xlsx &
dlb elec_5_6a.xlsx   https://www.eia.gov/electricity/monthly/xls/table_5_06_a.xlsx &
# Apartment List: CSV URL changes monthly, scrape it from the data page
AL=$(curl -sSfL -A "$UA_BROWSER" https://www.apartmentlist.com/research/category/data-rent-estimates \
     | grep -oE '//assets\.ctfassets\.net/[^"\\ ]*Apartment_List_Rent_Estimates_[0-9]{4}_[0-9]{2}\.csv' | head -1)
[ -n "$AL" ] && dl al_rent.csv "https:$AL" &
wait
