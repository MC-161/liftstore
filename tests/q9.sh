#!/usr/bin/env bash
# Q9 count + distinct federations. Server must be listening. Expected values from:
#   awk -F, 'NR>1 && $27~/^[0-9]+$/ && $26!="" { n++; f[$35] } END { print n, length(f) }'
# with $2=="F" && $4=="Raw" && $3=="SBD" added for the filtered case.
. "$(dirname "$0")/lib.sh"

echo "0. no filter: the whole dataset"
call DatasetStats '{}'
check "results == 3748104"       '.results == 3748104'
check "federations == 475"       '.federations == 475'

echo "1. filtered"
call DatasetStats '{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD"}'
check "results == 375568"        '.results == 375568'
check "federations == 340"       '.federations == 340'

echo "2. one filter alone narrows, and does not exceed the whole"
call DatasetStats '{"sex":"SEX_F"}'
check "0 < results < whole"      '.results > 0 and .results < 3748104'
check "results >= F/Raw/SBD"     '.results >= 375568'

echo "3. empty group is an answer"
call DatasetStats '{"sex":"SEX_MX","equipment":"EQUIPMENT_MULTI_PLY","event":"EVENT_S"}'
check "results == 0"             '.results == 0'
check "federations == 0"         '.federations == 0'

echo "4. an unknown enum number is not \"any\""
reject "sex 99"       DatasetStats '{"sex":99}'
reject "equipment 99" DatasetStats '{"equipment":99}'
reject "event 99"     DatasetStats '{"event":99}'

summary
