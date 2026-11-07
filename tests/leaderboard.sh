#!/usr/bin/env bash
# Leaderboards + LifterByName. Server must be listening. Anchors from awk:
#   awk -F, 'NR>1 && $2=="M" && $4=="Raw" && $3=="SBD" && $27~/^[0-9]+$/ && $26!="" \
#     && $9>74 && $9<=83 && $15+0>0 && $20+0>0 && $25+0>0 \
#     { n[$1]++; if ($26+0>m) m=$26+0 } END { c=0; for (k in n) c++; print c, m }'
#   -> 78559 915.5   (distinct lifters with a complete line; best total)
. "$(dirname "$0")/lib.sh"

KEY='"key":{"sex":"SEX_M","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipfClass":4}'
YOU='"youSquat":210,"youBench":140,"youDeadlift":260,"youBodyweight":82.4'
desc='[.rows[].score] as $s | ($s == ($s | sort | reverse))'
asc='[.rows[].score] as $s | ($s == ($s | sort))'

echo "0. top total, against awk"
call Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_TOP_TOTAL\",$YOU}"
# Filter on by default: 113 lifters' best totals have one lift under 15% of it.
# Same awk filters, then per name the best total -- ties to the EARLIEST date
# ($37), as the engine breaks them; first-seen gives 114 -- then min lift < 0.15*total.
check "lifters == 78559 - 113"    '.lifters == 78446'
check "hidden == 113"             '.hidden == 113'
check "#1 total == 915.5"         '.rows[0].total == 915.5'
check "10 rows by default"        '(.rows | length) == 10'
check "ranks are 1..10"           '[.rows[].rank] == [range(1;11)]'
check "score == total"            '[.rows[] | .score == .total] | all'
check "descending"                "$desc"
check "one row per lifter"        '([.rows[].name] | unique | length) == (.rows | length)'
check "total == s + b + d"        '[.rows[] | ((.total - (.squat + .bench + .deadlift)) | fabs) < 0.01] | all'
check "you ranked, below #10"     '.you.rank > 10 and .you.rank <= .lifters + 1'
check "you total 610"             '.you.total == 610'
TOP=$(jq -r '.rows[0].name' "$TMP")

echo "0b. filter off: every complete lifter, against awk"
call Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_TOP_TOTAL\",\"includeImplausible\":true}"
check "lifters == 78559"          '.lifters == 78559'
check "hidden == 0"               '.hidden == 0'

echo "1. custom: deadlift pct minus squat pct"
call Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_CUSTOM\",\"a\":{\"lift\":\"LIFT_KIND_DEADLIFT\",\"metric\":\"METRIC_PERCENTILE\"},\"combine\":\"COMBINE_MINUS\",\"b\":{\"lift\":\"LIFT_KIND_SQUAT\",\"metric\":\"METRIC_PERCENTILE\"},$YOU}"
check "score == dl% - sq%"        '[.rows[] | ((.score - (.deadliftPct - .squatPct)) | fabs) < 1e-6] | all'
check "you: score == dl% - sq%"   '((.you.score - (.you.deadliftPct - .you.squatPct)) | fabs) < 1e-6'
check "descending"                "$desc"
check "no line under 15%"         '[.rows[] | ([.squat,.bench,.deadlift] | min) >= 0.15 * .total] | all'
call Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_CUSTOM\",\"a\":{\"lift\":\"LIFT_KIND_DEADLIFT\",\"metric\":\"METRIC_PERCENTILE\"},\"combine\":\"COMBINE_MINUS\",\"b\":{\"lift\":\"LIFT_KIND_SQUAT\",\"metric\":\"METRIC_PERCENTILE\"},\"ascending\":true}"
check "ascending flips it"        "$asc"

echo "2. presets"
call Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_DOTS\",$YOU}"
check "score == dots"             '[.rows[] | ((.score - .dots) | fabs) < 0.01] | all'   # double vs float
check "descending"                "$desc"
# You: DOTS from the formula. 610 kg at 82.4 kg, men -> 413.49 (Python, same
# coefficients as OpenPowerlifting, which reproduce the CSV column).
check "you dots 413.49"           '((.you.dots - 413.49) | fabs) < 0.01'
call Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_BALANCED\"}"
check "ascending (spread)"        "$asc"
check "score == max% - min%"      '[.rows[] | ((.score - (([.squatPct,.benchPct,.deadliftPct]|max) - ([.squatPct,.benchPct,.deadliftPct]|min))) | fabs) < 1e-6] | all'
check "no you unless asked"       '.you == null'

echo "3. you at the top"
call Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_TOP_TOTAL\",\"youSquat\":400,\"youBench\":300,\"youDeadlift\":400,\"youBodyweight\":82}"
check "rank 1"                    '.you.rank == 1'

echo "4. lifter by name"
call LifterByName "{\"name\":\"$TOP\",\"sex\":\"SEX_M\",\"equipment\":\"EQUIPMENT_RAW\",\"event\":\"EVENT_SBD\"}"
check "same best total"           '.total == 915.5'
check "results >= 1"              '.results >= 1'
check "class 83"                  '.weightClass == "83"'
call LifterByName "{\"name\":\"$TOP\",\"sex\":\"SEX_M\",\"equipment\":\"EQUIPMENT_RAW\",\"event\":\"EVENT_SBD\",\"ipfClass\":4}"
check "in-class: same (best is in 83)" '.total == 915.5 and .weightClass == "83"'
call LifterByName '{"name":"John Haack","sex":"SEX_M","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD"}'
ANY=$(jq -r '.total' "$TMP")
call LifterByName '{"name":"John Haack","sex":"SEX_M","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipfClass":4}'
check "in-class best <= any-class best" ".total <= $ANY and .weightClass == \"83\""

echo "5. rejections"
reject   "preset unspecified"  Leaderboard "{$KEY}"
reject   "custom without a"    Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_CUSTOM\"}"
reject   "combine without b"   Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_CUSTOM\",\"a\":{\"lift\":\"LIFT_KIND_SQUAT\",\"metric\":\"METRIC_KG\"},\"combine\":\"COMBINE_MINUS\"}"
reject   "half a you"          Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_TOP_TOTAL\",\"youSquat\":200}"
reject   "limit 101"           Leaderboard "{$KEY,\"preset\":\"RANK_PRESET_TOP_TOTAL\",\"limit\":101}"
reject   "ipfClass 99"         Leaderboard '{"key":{"sex":"SEX_M","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipfClass":99},"preset":"RANK_PRESET_TOP_TOTAL"}'
reject   "name empty"          LifterByName '{"sex":"SEX_M","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD"}'
notfound "unknown name"        LifterByName '{"name":"Nobody Atall","sex":"SEX_M","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD"}'
notfound "no results in class" LifterByName "{\"name\":\"$TOP\",\"sex\":\"SEX_M\",\"equipment\":\"EQUIPMENT_RAW\",\"event\":\"EVENT_SBD\",\"ipfClass\":0}"
reject   "ipfClass 99 (lifter)" LifterByName "{\"name\":\"$TOP\",\"sex\":\"SEX_M\",\"equipment\":\"EQUIPMENT_RAW\",\"event\":\"EVENT_SBD\",\"ipfClass\":99}"
notfound "wrong category"      LifterByName "{\"name\":\"$TOP\",\"sex\":\"SEX_M\",\"equipment\":\"EQUIPMENT_MULTI_PLY\",\"event\":\"EVENT_SBD\"}"

summary
