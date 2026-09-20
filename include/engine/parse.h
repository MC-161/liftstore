#pragma once

#include <array>
#include <optional>
#include <string_view>

#include "engine/lift.h"

namespace engine {

    const char* split_line(const char* p, const char* end,
                           std::array<std::string_view, 42>& fields,
                           std::size_t& count);

    Sex parse_sex(std::string_view s);

    Event parse_event(std::string_view s);
    Equipment parse_equipment(std::string_view s);
    std::optional<float> parse_optional_float(std::string_view s);
    Place parse_place(std::string_view s);
    std::optional<WeightClass> parse_weight_class(std::string_view s);
    bool parse_tested(std::string_view s);
    bool parse_sanctioned(std::string_view s);

    Lift make_lift(const std::array<std::string_view, 42>& f);

}  // namespace engine