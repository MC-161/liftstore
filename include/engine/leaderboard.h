#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <vector>

#include "engine/column_store.h"
#include "engine/lift.h"
#include "engine/percentile.h"

namespace engine {

    // ---- Leaderboards: rank the LIFTERS of one class by an expression ----
    //
    // One line per lifter: their best-total result in the class, with the
    // three lifts from that same meet (a lifter's best squat and best bench
    // from different years never sat on one platform together).

    enum class Metric  : std::uint8_t { Kg, Percentile };
    enum class Combine : std::uint8_t { None, Minus, Plus, Ratio };
    enum class Preset  : std::uint8_t { TopTotal, Dots, Balanced, Custom };

    struct Operand  { LiftKind lift = LiftKind::Total; Metric metric = Metric::Kg; };

    struct RankSpec {
        Preset  preset    = Preset::TopTotal;
        Operand a;
        Combine combine   = Combine::None;
        Operand b;
        bool    ascending = false;      // Custom only; presets fix their own order
        // Drop lines where any one lift is under kMinLiftShare of the total --
        // in practice a mis-recorded meet (a 25 kg squat beside a 292.5 kg
        // deadlift), which otherwise tops every percentile-gap ranking.
        bool    plausible_only = true;
    };

    inline constexpr float kMinLiftShare = 0.15f;

    struct LifterLine {
        std::uint32_t row = 0;          // unused for "you"
        float  squat = 0, bench = 0, deadlift = 0, total = 0, bodyweight = 0, dots = 0;
        // Percentiles against the class's RESULTS (the same PercentileIndex
        // groups every other screen uses), so a number here matches Verdict.
        double squat_pct = 0, bench_pct = 0, deadlift_pct = 0, total_pct = 0;
        double score = 0;
    };

    struct YouInput { float squat, bench, deadlift, bodyweight; };

    struct LeaderboardResult {
        std::size_t lifters = 0;        // lifters ranked: complete S/B/D in this class
        std::size_t hidden  = 0;        // lifters dropped by plausible_only (not in `lifters`)
        std::vector<LifterLine> top;
        bool        has_you  = false;
        std::size_t you_rank = 0;       // 1-based: lifters strictly ahead + 1
        LifterLine  you;
    };

    [[nodiscard]] LeaderboardResult leaderboard(const ColumnStore& store, const PercentileIndex& index,
                                                Sex sex, Equipment equipment, Event event,
                                                std::uint8_t ipf_class, const RankSpec& spec,
                                                std::size_t limit, std::optional<YouInput> you);

    // DOTS, the formula OpenPowerlifting publishes; reproduces the dataset's
    // Dots column to the hundredth (checked on sample rows).
    [[nodiscard]] float dots_score(Sex sex, float bodyweight, float total);

    // ---- Head to Head: one lifter's best result in a category ----
    struct LifterBest {
        bool          found   = false;
        std::uint32_t row     = 0;
        std::size_t   results = 0;      // their placed results in the category
    };

    // Best total in (sex, equipment, event), in one IPF class or (nullopt) any.
    // name_index from name_dict.find(); 0 (not present) returns found = false.
    [[nodiscard]] LifterBest lifter_best(const ColumnStore& store, std::uint32_t name_index,
                                         Sex sex, Equipment equipment, Event event,
                                         std::optional<std::uint8_t> ipf_class);
}
