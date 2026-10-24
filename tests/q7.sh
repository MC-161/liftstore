#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

BASE='"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD"'

echo "0. moved up one class"
call ClassChange "{$BASE,\"classDelta\":1}"
check "transitions > 0"           '.transitions > 0'
check "transitions >= lifters"    '.transitions >= .lifters'
check "lifters > 0"               '.lifters > 0'
check "improved <= transitions"   '.improved <= .transitions'
check "bins sum to transitions"   '([.deltaBins[].count] | add) == .transitions'
check "bins contiguous"           '[.deltaBins[].high][:-1] == [.deltaBins[].low][1:]'
check "sd > 0"                    '.sdTotalDelta > 0'

echo "1. moved down one class"
call ClassChange "{$BASE,\"classDelta\":-1}"
check "transitions > 0"           '.transitions > 0'
check "transitions >= lifters"    '.transitions >= .lifters'
check "bins sum to transitions"   '([.deltaBins[].count] | add) == .transitions'

echo "2. rejections"
reject "classDelta 0"    ClassChange "{$BASE,\"classDelta\":0}"
reject "classDelta 99"   ClassChange "{$BASE,\"classDelta\":99}"
reject "classDelta -99"  ClassChange "{$BASE,\"classDelta\":-99}"
reject "sex missing"     ClassChange '{"equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","classDelta":1}'

summary
