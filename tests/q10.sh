#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

BASE='"sex":"SEX_F","event":"EVENT_SBD","lift":"LIFT_KIND_TOTAL","ipfClass":4'
FWD="{$BASE,\"fromEquipment\":\"EQUIPMENT_RAW\",\"toEquipment\":\"EQUIPMENT_SINGLE_PLY\"}"
REV="{$BASE,\"fromEquipment\":\"EQUIPMENT_SINGLE_PLY\",\"toEquipment\":\"EQUIPMENT_RAW\"}"

echo "0. raw -> single-ply"
call EquipmentSwap "$FWD"
check "lifters > 0"              '.lifters > 0'
check "meanDelta positive"       '.meanDelta > 0'
check "sdDelta > 0"              '.sdDelta > 0'
check "lifters <= from n"        '.lifters <= .fromSummary.n'
check "lifters <= to n"          '.lifters <= .toSummary.n'
check "fromSummary is RAW"       '.fromSummary.key.equipment == "EQUIPMENT_RAW"'
check "toSummary is SINGLE_PLY"  '.toSummary.key.equipment == "EQUIPMENT_SINGLE_PLY"'
check "same weight class"        '.fromSummary.weightClass == .toSummary.weightClass'
check "median near mean"         '((.medianDelta - .meanDelta) | fabs) < (3 * .sdDelta)'

FWD_LIFTERS=$(jq -r '.lifters'   "$TMP")
FWD_MEAN=$(jq -r '.meanDelta'    "$TMP")
FWD_MEDIAN=$(jq -r '.medianDelta' "$TMP")

echo "1. reversed -- the symmetry test"
call EquipmentSwap "$REV"
check "same lifter count"        ".lifters == $FWD_LIFTERS"
check "meanDelta negated"        "((.meanDelta + $FWD_MEAN) | fabs) < 0.01"
check "medianDelta negated"      "((.medianDelta + $FWD_MEDIAN) | fabs) < 0.01"
check "summaries swapped"        '.fromSummary.key.equipment == "EQUIPMENT_SINGLE_PLY" and .toSummary.key.equipment == "EQUIPMENT_RAW"'

echo "2. rejections"
reject "from == to"      EquipmentSwap "{$BASE,\"fromEquipment\":\"EQUIPMENT_RAW\",\"toEquipment\":\"EQUIPMENT_RAW\"}"
reject "ipfClass 99"     EquipmentSwap '{"sex":"SEX_F","event":"EVENT_SBD","lift":"LIFT_KIND_TOTAL","ipfClass":99,"fromEquipment":"EQUIPMENT_RAW","toEquipment":"EQUIPMENT_SINGLE_PLY"}'
reject "equip missing"   EquipmentSwap "{$BASE,\"toEquipment\":\"EQUIPMENT_SINGLE_PLY\"}"
reject "lift missing"    EquipmentSwap "{\"sex\":\"SEX_F\",\"event\":\"EVENT_SBD\",\"ipfClass\":4,\"fromEquipment\":\"EQUIPMENT_RAW\",\"toEquipment\":\"EQUIPMENT_SINGLE_PLY\"}"

summary