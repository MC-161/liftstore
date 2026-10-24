#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

KEY='"key":{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipfClass":4}'

echo "0. full range"
call ClassTrend "{$KEY,\"lift\":\"LIFT_KIND_TOTAL\",\"startYear\":0,\"endYear\":0}"
check "rows returned"          '(.rows | length) > 0'
check "sum of n == 65964"      '([.rows[].n] | add) == 65964'
check "years ascending"        '[.rows[].year] == ([.rows[].year] | sort)'
check "years contiguous"       '. as $r | ([$r.rows[].year] | last) - ([$r.rows[].year] | first) + 1 == ($r.rows | length)'
check "first year has data"    '.rows[0].n > 0'
check "last year has data"     '.rows[-1].n > 0'
check "p50 <= p90 everywhere"  '[.rows[] | select(.n > 0) | .p50 <= .p90] | all'
check "empty years are zeroed" '[.rows[] | select(.n == 0) | (.mean == 0 and .sd == 0 and .p50 == 0)] | all'

echo "1. narrowed range"
call ClassTrend "{$KEY,\"lift\":\"LIFT_KIND_TOTAL\",\"startYear\":2015,\"endYear\":2019}"
check "at most 5 rows"         '(.rows | length) <= 5'
check "all within range"       '[.rows[] | .year >= 2015 and .year <= 2019] | all'
check "n is lower than full"   '([.rows[].n] | add) < 65964'

echo "2. rejections"
reject "start > end"   ClassTrend "{$KEY,\"lift\":\"LIFT_KIND_TOTAL\",\"startYear\":2020,\"endYear\":2010}"
reject "year 3000"     ClassTrend "{$KEY,\"lift\":\"LIFT_KIND_TOTAL\",\"startYear\":2900,\"endYear\":3000}"
reject "ipfClass 99"   ClassTrend '{"key":{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipfClass":99},"lift":"LIFT_KIND_TOTAL"}'

summary
