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
bg dl zori_city.csv   $Z/zori/City_zori_uc_sfrcondomfr_sm_month.csv                  # city rent rung (no county/metro series)
bg dl zhvi_zip.csv    $Z/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv    # zip order (SizeRank) only: representative zip per county
bg dl qcew_$QY.zip    https://data.bls.gov/cew/data/files/$QY/csv/${QY}_qtrly_singlefile.zip
bg dl county_names.txt https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt
bg dl place_by_county.txt https://www2.census.gov/geo/docs/reference/codes2020/national_place_by_county2020.txt  # city rung: place -> county
bg dl cousub_by_county.txt https://www2.census.gov/geo/docs/reference/codes2020/national_cousub2020.txt      # city rung: township -> county
# Metro rent: county -> CBSA (OMB March 2020 delineation, the vintage Zillow's metros use) and Zillow metro
# RegionID -> CBSA code (Zillow's own crosswalk; IDs only, no name matching)
bg dl cbsa_list1_2020.xls https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2020/delineation-files/list1_2020.xls
bg dl zillow_county_crosswalk.csv https://files.zillowstatic.com/research/public/CountyCrossWalk_Zillow.csv

# HUD Fair Market Rents, 2-bedroom history (public domain; map-only rent rung). The file name carries the latest fiscal
# year (FMR_2Bed_1983_2027.csv): read it from HUD's FMR page. The validator cross-checks it against HUD's yearly
# county FMR workbooks (FY2025 revised and the latest year), linked from the same page.
HUD=https://www.huduser.gov/portal/datasets
HUDP=$(curl -sSfL -A "$UA" $HUD/fmr.html)
HUDF=$(printf '%s' "$HUDP" | grep -oE 'FMR/FMR_2Bed_1983_[0-9]{4}\.csv' | sort -u | tail -1 || true)
[ -n "$HUDF" ] || { echo "ERROR: HUD FMR history link not found on $HUD/fmr.html" >&2; exit 1; }
HUDY=$(printf '%s' "$HUDF" | grep -oE '[0-9]{4}' | tail -1)
dl hud_fmr_2bed_hist.csv "$HUD/$HUDF"
HUDX=$(printf '%s' "$HUDP" | grep -oE "/portal/datasets/fmr/fmr$HUDY/FY${HUDY:2:2}_FMRs[a-z_]*\.xlsx" | head -1 || true)
[ -n "$HUDX" ] && dl hud_FY${HUDY:2:2}_FMRs.xlsx "https://www.huduser.gov$HUDX" || echo "WARN: HUD FY$HUDY county FMR workbook not found (validation-only)" >&2
dl hud_FY25_FMRs_revised.xlsx $HUD/fmr/fmr2025/FY25_FMRs_revised.xlsx || echo "WARN: HUD FY2025 county FMR workbook download failed (validation-only)" >&2

# --- validation-only sources (required: the validator reads them) ---
bg dl fhfa_county.xlsx https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx
wait_all

# Apartment List (best effort, validation-only): CSV URL changes monthly, scrape it from the data page
AL=$(curl -sSfL -A "$UA" https://www.apartmentlist.com/research/category/data-rent-estimates \
     | grep -oE '//assets\.ctfassets\.net/[^"\\ ]*Apartment_List_Rent_Estimates_[0-9]{4}_[0-9]{2}\.csv' | head -1 || true)
if [ -n "$AL" ]; then dl al_rent.csv "https:$AL" || echo "WARN: Apartment List download failed (validation-only)" >&2
else echo "WARN: Apartment List CSV link not found (validation-only)" >&2; fi

# --- static gas sources (best effort: on failure the build keeps the committed JSON and says so) ---
# Alaska DCRA Community Fuel Price Survey (CC BY 4.0) from DCRA's ArcGIS service, plus DCRA's community database
# (borough + region per community) and the Census 2023 ZCTA gazetteer (zip points for "nearest community").
AKS=https://maps.commerce.alaska.gov/server/rest/services
akq() { dl "$1" "$2/query?where=1%3D1&outFields=$3&returnGeometry=$4&outSR=4326&orderByFields=$5&resultOffset=${6:-0}&resultRecordCount=2000&f=json"; }
ak_ok=1
rm -f dcra_gas_*.json
ak_more=1
for off in 0 2000 4000 6000 8000 10000 12000 14000 16000 18000; do
  akq "dcra_gas_$off.json" "$AKS/Services/CDO_Utilities/MapServer/6" '*' true OBJECTID $off || { ak_ok=0; break; }
  grep -q '"exceededTransferLimit": *true' "dcra_gas_$off.json" || { ak_more=0; break; }
done
# Paging must end on a page ArcGIS says is the last one: a silently truncated survey would drop communities.
if [ $ak_ok = 1 ] && [ $ak_more = 1 ]; then
  echo "ERROR: Alaska DCRA gas layer still reports exceededTransferLimit after 20,000 rows; raise the paging cap" >&2
  exit 1
fi
[ $ak_ok = 1 ] && akq dcra_regional_gas.json "$AKS/Services/CDO_Utilities/MapServer/45" 'Region,AvgGas,Season,ReportingYear,ReportingPeriod' false OBJECTID || ak_ok=0
[ $ak_ok = 1 ] && akq dcra_communities.json "$AKS/Community_Related/Community_Regions_Overview/MapServer/0" 'CommunityName,BoroughCensusArea,DCRAAlaskaRegion' false OBJECTID || ak_ok=0
[ $ak_ok = 1 ] && akq dcra_boroughs.json "$AKS/Community_Related/Community_Locations_and_Boundaries/MapServer/3" 'CommunityName,FIPS' false OBJECTID || ak_ok=0
[ $ak_ok = 1 ] && akq dcra_community_points.json "$AKS/Community_Related/Community_Locations_and_Boundaries/MapServer/0" 'CommunityName,x,y' false OBJECTID || ak_ok=0
# The single-page layers must fit in one page too
for f in dcra_regional_gas.json dcra_communities.json dcra_boroughs.json dcra_community_points.json; do
  if [ $ak_ok = 1 ] && grep -q '"exceededTransferLimit": *true' "$f"; then
    echo "ERROR: Alaska DCRA layer $f was truncated (exceededTransferLimit); page it" >&2
    exit 1
  fi
done
[ $ak_ok = 1 ] && dl gaz_zcta.zip https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip || ak_ok=0
[ $ak_ok = 1 ] || { echo "WARN: Alaska DCRA fuel survey download failed; the build keeps the committed ak-gas.json" >&2; rm -f dcra_gas_*.json; }
# Puerto Rico DACO monthly average gasoline prices (xlsx linked from https://www.daco.pr.gov/recursos)
dl daco_gas.xlsx "https://docs.pr.gov/files/DACO/Gasolina/Precios%20Promedio%20Mensual%20al%20Consumidor/Precios-Promedios-de-Gasolina-y-Diesel%20(1).xlsx" \
  || { echo "WARN: DACO workbook download failed; the build keeps the committed pr-gas.json" >&2; rm -f daco_gas.xlsx; }
