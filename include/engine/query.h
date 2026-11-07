#pragma once
#include <cstddef>
#include <optional>
#include <vector>

#include "engine/lift.h"
#include "engine/column_store.h"
#include "engine/ipf_class.h"

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

    struct AttemptsResult {
        std::size_t n             = 0;    // rows with BOTH attempts present
        std::size_t third_success = 0;
        double      mean_jump     = 0.0;
        double      sd_jump       = 0.0;
        float       min_jump      = 0.0f;
        float       max_jump      = 0.0f;
        std::vector<HistBin> bins;
    };

    struct TrendRow {
        std::uint32_t year = 0;
        std::size_t   n    = 0;
        double mean = 0.0, sd = 0.0;
        float  p50  = 0.0f, p90 = 0.0f;
    };

    struct SwapResult {
        std::size_t lifters      = 0;
        double      mean_delta   = 0.0;
        double      sd_delta     = 0.0;
        float       median_delta = 0.0f;
    };

    struct ClassChangeResult {
        std::size_t lifters     = 0;
        std::size_t transitions = 0;
        double      mean_delta  = 0.0;
        double      sd_delta    = 0.0;
        std::size_t improved    = 0;
        std::vector<HistBin> bins;
        // Bodyweight side of the same transitions. per_bw_kg is the median of
        // (total delta / bodyweight delta) over transitions whose bodyweight
        // moved at least 1 kg -- what a kg of bodyweight is worth in total.
        std::size_t bw_transitions    = 0;
        float       median_bw_delta   = 0.0f;
        float       median_per_bw_kg  = 0.0f;
    };



    struct DatasetStats {
        std::size_t results     = 0;
        std::size_t federations = 0;
    };

    // Best result per lifter matching the filters, highest total first.
    // Returns pointers into `lifts`, valid as long as `lifts` isn't modified.
    [[nodiscard]] std::vector<const Lift*> top_lifters(const std::vector<Lift>& lifts,
                                         Sex sex, Equipment equipment, Event event,
                                         std::size_t n);

    struct Ranked { std::uint32_t row; float total; };

    [[nodiscard]] std::vector<Ranked> top_lifters_columnar(const ColumnStore& store,
                                             Sex sex, Equipment equipment, Event event,
                                             std::size_t n);

    [[nodiscard]] ConditionalResult conditional_percentile(
        const ColumnStore& store,
        Sex sex, Equipment equipment, Event event,
        LiftKind condition_lift, float condition_value,
        LiftKind target_lift,    float target_value,
        float tol = 2.5f, std::size_t min_n = 500);

    // Placed rows with a total, and their distinct federations. Each filter is
    // optional: nullopt matches everything.
    [[nodiscard]] DatasetStats dataset_stats(const ColumnStore& store, std::optional<Sex> sex,
                                             std::optional<Equipment> equipment,
                                             std::optional<Event> event);

    [[nodiscard]] AttemptsResult attempts(const ColumnStore& store, Sex sex, Equipment equipment,
                        Event event, std::uint8_t ipf_class, LiftKind which,
                        float bin_width);

    [[nodiscard]] std::vector<TrendRow> class_trend(const ColumnStore& store, Sex sex, Equipment equipment,
                                  Event event, std::uint8_t ipf_class, LiftKind which,
                                  std::uint32_t start_year, std::uint32_t end_year);

    [[nodiscard]] SwapResult equipment_swap(const ColumnStore& store, Sex sex, Event event,
                           Equipment from, Equipment to, std::uint8_t ipf_class,
                           LiftKind which);

    [[nodiscard]] ClassChangeResult class_change(const ColumnStore& store, Sex sex, Equipment equipment,
                               Event event, int class_delta, float bin_width);
}