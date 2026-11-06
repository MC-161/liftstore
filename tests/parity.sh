#!/usr/bin/env bash
# The gateway must return byte-identical JSON to grpcurl, modulo key order.
# Both servers must be running. Override with GRPC=host:port HTTP=host:port.
GRPC=${GRPC:-localhost:50051}
HTTP=${HTTP:-localhost:8080}
FAILED=0

parity() {   # $1 label, $2 rpc, $3 grpc json payload, $4 http path+query
    local a b
    a=$(grpcurl -plaintext -emit-defaults -import-path proto -proto proto/engine.proto \
          -d "$3" "$GRPC" "engine.v1.Engine/$2" | jq -S .)
    b=$(curl -s "$HTTP$4" | jq -S .)
    # Two failed calls are two empty strings, and those compare equal.
    if [ -z "$a" ]; then
        printf '  FAIL  %s (no gRPC response)\n' "$1"
        FAILED=$((FAILED + 1))
    elif [ "$a" = "$b" ]; then
        printf '  PASS  %s\n' "$1"
    else
        printf '  FAIL  %s\n' "$1"
        diff <(echo "$a") <(echo "$b") | sed 's/^/        /'
        FAILED=$((FAILED + 1))
    fi
}

KEY='{"key":{"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD","ipfClass":4}'
Q='sex=SEX_F&equipment=EQUIPMENT_RAW&event=EVENT_SBD&ipf_class=4'
# Flat requests (no GroupKey): the same group without the class.
FLAT='"sex":"SEX_F","equipment":"EQUIPMENT_RAW","event":"EVENT_SBD"'
FQ='sex=SEX_F&equipment=EQUIPMENT_RAW&event=EVENT_SBD'

parity "distribution" Distribution "$KEY,\"lift\":\"LIFT_KIND_TOTAL\"}" \
       "/api/distribution?$Q&lift=LIFT_KIND_TOTAL"
parity "attempts"     Attempts     "$KEY,\"lift\":\"LIFT_KIND_SQUAT\"}" \
       "/api/attempts?$Q&lift=LIFT_KIND_SQUAT"
parity "class-trend"  ClassTrend   "$KEY,\"lift\":\"LIFT_KIND_TOTAL\"}" \
       "/api/class-trend?$Q&lift=LIFT_KIND_TOTAL"
parity "top-lifters"  TopLifters   "{$FLAT,\"limit\":20}" \
       "/api/top-lifters?$FQ&limit=20"
parity "percentile"   Percentile   "{$FLAT,\"bodyweight\":62,\"value\":400,\"lift\":\"LIFT_KIND_TOTAL\"}" \
       "/api/percentile?$FQ&bodyweight=62&value=400&lift=LIFT_KIND_TOTAL"
parity "conditional-percentile" ConditionalPercentile \
       "{$FLAT,\"conditionLift\":\"LIFT_KIND_SQUAT\",\"conditionValue\":140,\"targetLift\":\"LIFT_KIND_BENCH\",\"targetValue\":80}" \
       "/api/conditional-percentile?$FQ&condition_lift=LIFT_KIND_SQUAT&condition_value=140&target_lift=LIFT_KIND_BENCH&target_value=80"
parity "class-sweep"  ClassSweep   "{$FLAT,\"lift\":\"LIFT_KIND_TOTAL\",\"value\":400}" \
       "/api/class-sweep?$FQ&lift=LIFT_KIND_TOTAL&value=400"
parity "equipment-swap" EquipmentSwap \
       '{"sex":"SEX_F","event":"EVENT_SBD","fromEquipment":"EQUIPMENT_RAW","toEquipment":"EQUIPMENT_SINGLE_PLY","lift":"LIFT_KIND_TOTAL","ipfClass":4}' \
       "/api/equipment-swap?sex=SEX_F&event=EVENT_SBD&from_equipment=EQUIPMENT_RAW&to_equipment=EQUIPMENT_SINGLE_PLY&lift=LIFT_KIND_TOTAL&ipf_class=4"
parity "class-change" ClassChange  "{$FLAT,\"classDelta\":1}" \
       "/api/class-change?$FQ&class_delta=1"

echo
[ "$FAILED" -eq 0 ] && echo "all passed" || echo "$FAILED failed"
exit "$FAILED"