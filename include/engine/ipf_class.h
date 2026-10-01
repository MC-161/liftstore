#pragma once

#include "engine/lift.h"

namespace engine {
// DERIVED (not in the CSV): IPF weight class assigned by measured bodyweight.
inline constexpr std::uint8_t kNoIpfClass = 255;

std::uint8_t ipf_class_index(Sex sex, float bodyweight_kg);
std::string_view ipf_class_name(Sex sex, std::uint8_t index);

}