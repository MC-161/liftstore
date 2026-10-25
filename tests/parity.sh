#!/usr/bin/env bash
# The gateway must return byte-identical JSON to grpcurl, modulo key order.
# Both servers must be running.
FAILED=0

parity() {   # $1 label, $2 rpc, $3 grpc json payload, $4 http path+query
    local a b
    a=$(grpcurl -plaintext -emit-defaults -import-path proto -proto proto/engine.proto \
          -d "$3" localhost:50051 "engine.v1.Engine/$2" | jq -S .)
    b=$(curl -s "localhost:8080$4" | jq -S .)
    if [ "$a" = "$b" ]; then
        printf '  PASS  %s\n' "$1"
    else
        printf '  FAIL  %s\n' "$1"
        diff <(echo "$a") <(echo "$b") | sed 's/^/        /'
        FAILED=$((FAILED + 1))
    fi
}

KEY='{"key":{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipfClass":4}'
Q='sex=SEX_F&equipment=EQUIPMENT_RAW&event=EVENT_SBD&ipf_class=4'

parity "distribution" Distribution "$KEY,\"lift\":\"LIFT_KIND_TOTAL\"}" \
       "/api/distribution?$Q&lift=LIFT_KIND_TOTAL"
parity "attempts"     Attempts     "$KEY,\"lift\":\"LIFT_KIND_SQUAT\"}" \
       "/api/attempts?$Q&lift=LIFT_KIND_SQUAT"
parity "class-trend"  ClassTrend   "$KEY,\"lift\":\"LIFT_KIND_TOTAL\"}" \
       "/api/class-trend?$Q&lift=LIFT_KIND_TOTAL"

echo
[ "$FAILED" -eq 0 ] && echo "all passed" || echo "$FAILED failed"
exit "$FAILED"