#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

KEY='"key":{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipfClass":4}'

echo "0. squat, class 4"
call Attempts "{$KEY,\"lift\":\"LIFT_KIND_SQUAT\"}"
check "n > 0"                     '.n > 0'
check "successes <= n"            '.thirdAttemptSuccess <= .n'
check "successRate == succ / n"   '((.successRate - (.thirdAttemptSuccess / .n)) | if . < 0 then -. else . end) < 0.0001'
check "bins sum to n"             '([.jumpBins[].count] | add) == .n'
check "bins contiguous"           '[.jumpBins[].high][:-1] == [.jumpBins[].low][1:]'
check "meanJump not inverted"     '.meanJump > 0 and .meanJump < 20'
check "successRate plausible"     '.successRate > 0.2 and .successRate < 0.8'
check "sdJump > 0"                '.sdJump > 0'

echo "1. bench, same class -- different column, same invariants"
call Attempts "{$KEY,\"lift\":\"LIFT_KIND_BENCH\"}"
check "n > 0"                     '.n > 0'
check "bins sum to n"             '([.jumpBins[].count] | add) == .n'
check "successRate == succ / n"   '(.successRate - (.thirdAttemptSuccess / .n) | fabs) < 0.0001'