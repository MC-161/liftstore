#pragma once
#include <cstddef>
#include <vector>

#include "engine/lift.h"
#include "engine/column_store.h"

namespace engine {

    // Percentile of one lift among lifters whose OTHER lift is near a given value.
    // Cannot be precomputed: the condition is a runtime range, so this is a scan.
    struct ConditionalResult {
        bool        found      = false;   // false when n == 0
        double      percentile = 0.0;     // 0-100, share strictly below
        std::size_t below      = 0;
        std::size_t n          = 0;
        float       tol_used   = 0.0f;    // the tolerance that produced n
    };


    // Best result per lifter matching the filters, highest total first.
    // Returns pointers into `lifts`, valid as long as `lifts` isn't modified.
    std::vector<const Lift*> top_lifters(const std::vector<Lift>& lifts,
                                         Sex sex, Equipment equipment, Event event,
                                         std::size_t n);

    struct Ranked { std::uint32_t row; float total; };

    std::vector<Ranked> top_lifters_columnar(const ColumnStore& store,
                                             Sex sex, Equipment equipment, Event event,
                                             std::size_t n);

    ConditionalResult conditional_percentile(
        const ColumnStore& store,
        Sex sex, Equipment equipment, Event event,
        LiftKind condition_lift, float condition_value,
        LiftKind target_lift,    float target_value,
        float tol = 2.5f, std::size_t min_n = 500);
}