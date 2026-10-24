#!/usr/bin/env bash
# Q4 distribution histogram. Server must be listening.
. "$(dirname "$0")/lib.sh"

KEY='"key":{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipf_class":4}'
EXPECT_N=65964

echo "0. group identity"
call Distribution "{$KEY,\"lift\":\"LIFT_KIND_TOTAL\",\"binWidth\":0}"
if ! jq -e ".summary.n == $EXPECT_N" "$TMP" >/dev/null 2>&1; then
    echo "  ABORT  wrong group"; jq -c '.summary' "$TMP" 2>/dev/null || cat "$TMP.err"; exit 1
fi
printf '  PASS  n == %s\n' "$EXPECT_N"
check "weightClass is 63"        '.summary.weightClass == "63"'
check "default binWidth is 10"   '.binWidth == 10'
check "min == 70"                '((.min - 70)    | if . < 0 then -. else . end) < 0.001'
check "max == 582.5"             '((.max - 582.5) | if . < 0 then -. else . end) < 0.001'

echo "1. the invariant"
check "bins sum to n"            '([.bins[].count] | add) == .summary.n'
check "52 bins at width 10"      '(.bins | length) == 52'
check "first edge <= min"        '.bins[0].low <= .min'
check "last edge > max"          '.bins[-1].high > .max'
check "edges are contiguous"     '[.bins[].high][:-1] == [.bins[].low][1:]'

echo "2. sigma marks"
check "5 marks"                  '(.sigmaMarks | length) == 5'
check "k runs -2..2"             '[.sigmaMarks[].k] == [-2,-1,0,1,2]'
check "value == mean + k*sd"     '. as $r | ([$r.sigmaMarks[] | ((.value - ($r.summary.mean + (.k * $r.summary.sd))) | if . < 0 then -. else . end)] | max) < 0.01'
check "all in range here"        '[.sigmaMarks[].inRange] | all'

echo "3. width 2.5 -- the floor/ceil discriminator"
call Distribution "{$KEY,\"lift\":\"LIFT_KIND_TOTAL\",\"binWidth\":2.5}"
check "206 bins"                 '(.bins | length) == 206'
check "bins sum to n"            '([.bins[].count] | add) == .summary.n'
check "last edge > max"          '.bins[-1].high > .max'
check "echoed binWidth is 2.5"   '.binWidth == 2.5'

echo "4. empty group"
call Distribution '{"key":{"sex":"SEX_MX","equipment":"EQUIPMENT_MULTI_PLY","event":"EVENT_S","ipf_class":4},"lift":"LIFT_KIND_SQUAT","binWidth":0}'
check "n == 0"                   '.summary.n == 0'
check "weightClass populated"    '(.summary.weightClass | length) > 0'
check "no bins"                  '(.bins | length) == 0'
check "no sigma marks"           '(.sigmaMarks | length) == 0'

echo "5. rejections"
reject "binWidth 0.001"   Distribution "{$KEY,\"lift\":\"LIFT_KIND_TOTAL\",\"binWidth\":0.001}"
reject "binWidth -5"      Distribution "{$KEY,\"lift\":\"LIFT_KIND_TOTAL\",\"binWidth\":-5}"
reject "binWidth NaN"     Distribution "{$KEY,\"lift\":\"LIFT_KIND_TOTAL\",\"binWidth\":\"NaN\"}"
reject "ipf_class 99"     Distribution '{"key":{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipf_class":99},"lift":"LIFT_KIND_TOTAL"}'
reject "lift unspecified" Distribution "{$KEY,\"lift\":\"LIFT_KIND_UNSPECIFIED\"}"

summary