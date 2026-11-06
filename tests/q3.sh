#!/usr/bin/env bash
# Q3 inverse percentile. Server must be listening. Expected values from awk over
# the CSV: F/Raw/SBD, 57 < BodyweightKg <= 63, placed, with a total, sorted
# ascending, element int(p/100 * n) -- docs/decisons.md, rank_index_at.
. "$(dirname "$0")/lib.sh"

BASE='"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","bodyweight":62,"lift":"LIFT_KIND_TOTAL"'
near() { echo "(($1) | if . < 0 then -. else . end) < 0.001"; }

echo "0. against awk"
call ValueAtPercentile "{$BASE,\"percentile\":95}"
check "n == 65964"               '.n == 65964'
check "weightClass is 63"        '.weightClass == "63"'
check "p95 == 405"               "$(near '.value - 405')"
check "actual 94.9336"           "$(near '.actualPercentile - 94.9336')"
check "actual <= requested"      '.actualPercentile <= 95'
call ValueAtPercentile "{$BASE,\"percentile\":50}"
check "p50 == 295"               "$(near '.value - 295')"
call ValueAtPercentile "{$BASE,\"percentile\":90}"
check "p90 == 377.5"             "$(near '.value - 377.5')"
call ValueAtPercentile "{$BASE,\"percentile\":99}"
check "p99 == 457.5"             "$(near '.value - 457.5')"

echo "1. edges"
call ValueAtPercentile "{$BASE,\"percentile\":100}"
check "p100 is the group max"    "$(near '.value - 582.5')"

echo "2. the round trip, through Percentile"
call ValueAtPercentile "{$BASE,\"percentile\":95}"
ACTUAL=$(jq -r '.actualPercentile' "$TMP")
VALUE=$(jq -r '.value' "$TMP")
call Percentile "{$BASE,\"value\":$VALUE}"
check "percentile_of(value) == actual" "$(near ".percentile - $ACTUAL")"

echo "3. empty group"
call ValueAtPercentile '{"sex":"SEX_MX","equipment":"EQUIPMENT_MULTI_PLY","event":"EVENT_S","bodyweight":62,"lift":"LIFT_KIND_SQUAT","percentile":95}'
check "n == 0"                   '.n == 0'
check "value == 0"               '.value == 0'
check "actual == 0, not NaN"     '.actualPercentile == 0'

echo "4. rejections"
reject "percentile unset"  ValueAtPercentile "{$BASE}"
reject "percentile -1"     ValueAtPercentile "{$BASE,\"percentile\":-1}"
reject "percentile 100.1"  ValueAtPercentile "{$BASE,\"percentile\":100.1}"
reject "percentile NaN"    ValueAtPercentile "{$BASE,\"percentile\":\"NaN\"}"
reject "bodyweight 0"      ValueAtPercentile '{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","lift":"LIFT_KIND_TOTAL","percentile":95}'
reject "lift unspecified"  ValueAtPercentile '{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","bodyweight":62,"percentile":95}'

summary
