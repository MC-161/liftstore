#pragma once
#include <cstddef>
#include <vector>

#include "engine/lift.h"
#include "engine/column_store.h"

namespace engine {

    // Best result per lifter matching the filters, highest total first.
    // Returns pointers into `lifts`, valid as long as `lifts` isn't modified.
    std::vector<const Lift*> top_lifters(const std::vector<Lift>& lifts,
                                         Sex sex, Equipment equipment, Event event,
                                         std::size_t n);

    struct Ranked { std::uint32_t row; float total; };

    std::vector<Ranked> top_lifters_columnar(const ColumnStore& store,
                                             Sex sex, Equipment equipment, Event event,
                                             std::size_t n);
}