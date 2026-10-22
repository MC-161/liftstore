#!/usr/bin/env bash
# V3 of the M6 verification plan, plus the V1 and per-lift checks that need
# no CLI reference.
#
# Usage: bash tests/v3_decisions.sh [host:port]      (run from the repo root)
# Requires: grpcurl, jq. Server loaded with the FULL dataset.

set -u
ADDR="${1:-localhost:50051}"
PASS=0; FAIL=0

# Must track kMaxLimit in include/engine/service.h.
CAP=30000

G() {
  grpcurl -plaintext -emit-defaults -max-time 60 \
          -import-path proto -proto engine.proto \
          -d "$2" "$ADDR" "$1" 2>&1
}

ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n        %.200s\n' "$1" "$2"; FAIL=$((FAIL+1)); }

# an error is expected, and the message must mention each given substring
expect_err() {
  local name=$1 method=$2 json=$3; shift 3
  local out; out=$(G "$method" "$json" | head -c 2000)
  [[ "$out" == *InvalidArgument* ]] || { bad "$name" "no InvalidArgument: $out"; return; }
  local s
  for s in "$@"; do
    [[ "$out" == *"$s"* ]] || { bad "$name" "message missing '$s': $out"; return; }
  done
  ok "$name"
}

# success expected; body discarded (used where the body would be huge)
expect_ok() {
  local name=$1 method=$2 json=$3
  if G "$method" "$json" >/dev/null 2>&1; then ok "$name"; else bad "$name" "call failed"; fi
}

# success expected; assert on one jq-extracted value. Streams into jq --
# the response never lands in a shell variable.
expect_jq() {
  local name=$1 method=$2 json=$3 filter=$4 want=$5
  local got; got=$(G "$method" "$json" | jq -r "$filter" 2>/dev/null)
  [[ "$got" == "$want" ]] && ok "$name" || bad "$name" "$filter = '$got', want '$want'"
}

TL=engine.v1.Engine/TopLifters
PC=engine.v1.Engine/Percentile

FILT='"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD"'
PFILT='"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","lift":"LIFT_KIND_TOTAL"'
SQ='"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","lift":"LIFT_KIND_SQUAT"'

echo
echo "Decision 2 - unspecified enums rejected, naming the right field"
expect_err "sex omitted"       $TL '{"equipment":"EQUIPMENT_RAW","event":"EVENT_SBD"}' sex
expect_err "equipment omitted" $TL '{"sex":"SEX_F","event":"EVENT_SBD"}'               equipment
expect_err "event omitted"     $TL '{"sex":"SEX_F","equipment":"EQUIPMENT_RAW"}'       event

echo
echo "Decision 3 - limit 0 means default; cap inclusive; over-cap is an error"
expect_jq  "limit omitted -> 200"    $TL "{$FILT}"               '.results|length' 200
expect_jq  "limit 1 -> 1"            $TL "{$FILT,\"limit\":1}"   '.results|length' 1

# results, past grpcurl's default 4 MB receive limit, so the cap as configured
# is larger than a default client can accept. Either lower kMaxLimit below
# ~20000, or raise the limit here and in the Go service.
expect_ok  "large limit accepted"    $TL "{$FILT,\"limit\":10000}"
expect_err "limit over cap rejected" $TL "{$FILT,\"limit\":$((CAP+1))}" "$((CAP+1))" "$CAP"
expect_err "limit far over rejected" $TL "{$FILT,\"limit\":50000}"      50000        "$CAP"

echo
echo "Decision 4 - empty group is OK with n=0, class still named"
expect_jq "unassignable (Mx) -> n=0" $PC \
  '{"sex":"SEX_MX","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","lift":"LIFT_KIND_TOTAL","bodyweight":75,"value":500}' \
  '.n' 0
expect_jq "empty group -> n=0" $PC \
  '{"sex":"SEX_F","equipment":"EQUIPMENT_STRAPS","event":"EVENT_SD","lift":"LIFT_KIND_TOTAL","bodyweight":63,"value":300}' \
  '.n' 0
expect_jq "empty group still names the class" $PC \
  '{"sex":"SEX_F","equipment":"EQUIPMENT_STRAPS","event":"EVENT_SD","lift":"LIFT_KIND_TOTAL","bodyweight":63,"value":300}' \
  '.weightClass != ""' true

echo
echo "Scalar guards - 0.0 is proto3's default, so omitted must not mean valid"
# Each case supplies everything valid EXCEPT the field under test. Without
# that, validation ORDER silently decides which assertion actually fires --
# a request missing both lift and bodyweight only ever reports lift.
expect_err "lift omitted"       $PC "{$FILT,\"bodyweight\":63,\"value\":500}"   lift
expect_err "bodyweight omitted" $PC "{$PFILT,\"value\":500}"                    bodyweight
expect_err "value omitted"      $PC "{$PFILT,\"bodyweight\":63}"                value
expect_err "bodyweight 0"       $PC "{$PFILT,\"bodyweight\":0,\"value\":500}"   bodyweight
expect_err "value 0"            $PC "{$PFILT,\"bodyweight\":63,\"value\":0}"    value

echo
echo "Per-lift percentile - reconciled against awk (docs/data-notes.md)"
# F/Raw/SBD, 63 kg class (57 < bw <= 63). The two arrays have DIFFERENT sizes,
# which is what makes these a tripwire: a server reading .total when asked for
# .squat returns n=65964 instead of 65949 even before the value is wrong.
expect_jq "total 500: below" $PC "{$PFILT,\"bodyweight\":60,\"value\":500}" '.below' 65810
expect_jq "total 500: n"     $PC "{$PFILT,\"bodyweight\":60,\"value\":500}" '.n'     65964
expect_jq "squat 150: below" $PC "{$SQ,\"bodyweight\":60,\"value\":150}"    '.below' 62402
expect_jq "squat 150: n"     $PC "{$SQ,\"bodyweight\":60,\"value\":150}"    '.n'     65949

echo
echo "V1 leftovers"
dupes=$(G $TL "{$FILT,\"limit\":200}" | jq -r '.results[].name' | sort | uniq -d)
[[ -z "$dupes" ]] && ok "no duplicate lifters in 200 results" || bad "dedupe" "repeated: $dupes"

a=$(G $TL "{$FILT,\"limit\":10}"  | jq -c '[.results[].name]')
b=$(G $TL "{$FILT,\"limit\":200}" | jq -c '[.results[:10][].name]')
[[ "$a" == "$b" ]] && ok "prefix invariance (10 == first 10 of 200)" \
                   || bad "prefix invariance" "$a != $b"

echo
printf 'passed %d, failed %d\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]