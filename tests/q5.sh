#!/usr/bin/env bash
# tests/nearest_decisions.sh
# Q5: nearest-lifter window, server-side dedupe, and the n == 0 guard.
# Run from the repo ROOT with the server already listening.
#
#   cmake --build build-debug && ./build-debug/apps/server      # <- the && matters
#   bash tests/nearest_decisions.sh

HOST=localhost:50051
METHOD=engine.v1.Engine/Percentile
G=(grpcurl -plaintext -emit-defaults -import-path proto -proto engine.proto)

BW=62                # bodyweight landing in the F class you verified
EXPECT_N=65964         # that class's TOTAL count -- the anchor
EMPTY_EVENT=EVENT_S    # <-- your squat-only enum value; confirm this group IS empty

FAILED=0
TMP=$(mktemp)
trap 'rm -f "$TMP" "$TMP.err"' EXIT

payload() {   # $1 = value, $2 = lift
    printf '{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","bodyweight":%s,"value":%s,"lift":"%s"}' \
        "$BW" "$1" "$2"
}

call() { "${G[@]}" -d "$1" "$HOST" "$METHOD" >"$TMP" 2>"$TMP.err"; }

check() {   # $1 = label, $2 = jq predicate
    if jq -e "$2" "$TMP" >/dev/null 2>&1; then
        printf '  PASS  %s\n' "$1"
    else
        printf '  FAIL  %s\n' "$1"
        printf '        got: %s\n' "$(jq -c . "$TMP" 2>/dev/null || cat "$TMP.err")"
        FAILED=$((FAILED + 1))
    fi
}

reject() {  # $1 = label, $2 = payload -- expects INVALID_ARGUMENT
    if "${G[@]}" -d "$2" "$HOST" "$METHOD" >/dev/null 2>"$TMP.err"; then
        printf '  FAIL  %s (accepted)\n' "$1"; FAILED=$((FAILED + 1))
    elif grep -q 'InvalidArgument' "$TMP.err"; then
        printf '  PASS  %s\n' "$1"
    else
        printf '  FAIL  %s (wrong status)\n' "$1"
        sed 's/^/        /' "$TMP.err"
        FAILED=$((FAILED + 1))
    fi
}

# --- 0. group identity -------------------------------------------------------
# If this is wrong every comparison below is meaningless, so abort rather than
# report 20 confusing failures.
echo "0. group identity"
call "$(payload 500 LIFT_KIND_TOTAL)"
if ! jq -e ".n == $EXPECT_N" "$TMP" >/dev/null 2>&1; then
    echo "  ABORT  n != $EXPECT_N -- wrong group. Fix BW, or update EXPECT_N."
    jq -c '{n, weightClass}' "$TMP" 2>/dev/null || cat "$TMP.err"
    exit 1
fi
printf '  PASS  n == %s\n' "$EXPECT_N"
# percentile checked against its own derivation, not a fourth constant.
check "percentile == 100*below/n" \
      '((.percentile - (100 * .below / .n)) | if . < 0 then -. else . end) < 0.001'

# --- 1. centring -------------------------------------------------------------
# Structure, not constants: two strictly below, then the first at-or-above.
echo "1. window centring (value = 500)"
check "5 rows"                 '(.neighbours | length) == 5'
check "5 distinct lifters"     '(.neighbours | length) == ([.neighbours[].name] | unique | length)'
check "ascending"              '[.neighbours[].value] == ([.neighbours[].value] | sort)'
check "index 1 is below 500"   '.neighbours[1].value < 500'
check "index 2 is at-or-above" '.neighbours[2].value >= 500'

# --- 2. above max: THE dedupe test ------------------------------------------
# Pre-dedupe this returned 5 rows / 3 lifters (Bostrom x2, Gasparyan x2), so the
# window started at 569.0. Deduped, it must reach further down to find 5 people.
echo "2. above max (value = 1500) -- dedupe"
call "$(payload 1500 LIFT_KIND_TOTAL)"
check "5 rows"               '(.neighbours | length) == 5'
check "5 distinct lifters"   '(.neighbours | length) == ([.neighbours[].name] | unique | length)'
check "ascending"            '[.neighbours[].value] == ([.neighbours[].value] | sort)'
check "reaches past 569"     '.neighbours[0].value < 569'
check "rank == 1"            '.rank == 1'
check "below == n"           '.below == .n'
# case 2
check "ends at group max 582.5" '(.neighbours[4].value - 582.5 | if . < 0 then -. else . end) < 0.001'


# --- 3. below min: unsigned underflow ---------------------------------------
# rank == n+1 is correct, not a bug: "where you would place if you entered".
echo "3. below min (value = 1) -- underflow"
call "$(payload 1 LIFT_KIND_TOTAL)"
check "5 rows"             '(.neighbours | length) == 5'
check "5 distinct lifters" '(.neighbours | length) == ([.neighbours[].name] | unique | length)'
check "ascending"          '[.neighbours[].value] == ([.neighbours[].value] | sort)'
check "below == 0"         '.below == 0'
check "percentile == 0"    '.percentile == 0'
check "rank == n+1"        '.rank == (.n + 1)'
# case 3
check "starts at group min 70"  '(.neighbours[0].value - 70   | if . < 0 then -. else . end) < 0.001'

# --- 4. empty group ---------------------------------------------------------
# percentile must be 0, NOT the string "NaN": 100*0/0 is NaN, protobuf's JSON
# printer emits it as a string, and every numeric assertion then stops testing.
echo "4. empty group -- n == 0 guard"
call "{\"sex\":\"SEX_MX\",\"equipment\":\"EQUIPMENT_MULTI_PLY\",\"event\":\"$EMPTY_EVENT\",\"bodyweight\":$BW,\"value\":200,\"lift\":\"LIFT_KIND_SQUAT\"}"
check "n == 0"                 '.n == 0'
check "percentile == 0 (number, not \"NaN\")" '.percentile == 0'
check "rank == 0"              '.rank == 0'
check "no neighbours"          '(.neighbours | length) == 0'
check "weightClass populated"  '(.weightClass | length) > 0'


# --- 5. rejections ----------------------------------------------------------
# A non-OK status rides in the HTTP/2 trailers, so there is no response body.
echo "5. validation"
reject "value = 0"          "$(payload 0 LIFT_KIND_TOTAL)"
reject "value = 99999"      "$(payload 99999 LIFT_KIND_TOTAL)"
reject "lift unspecified"   "$(payload 500 LIFT_KIND_UNSPECIFIED)"
reject "bodyweight = 0"     '{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","bodyweight":0,"value":500,"lift":"LIFT_KIND_TOTAL"}'
reject "sex unspecified"    '{"sex":"SEX_UNSPECIFIED","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","bodyweight":66,"value":500,"lift":"LIFT_KIND_TOTAL"}'


# ---------------------------------------------------------------------------
echo
if [ "$FAILED" -eq 0 ]; then
    echo "all passed"
else
    echo "$FAILED failed"
fi
exit "$FAILED"