#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "engine/column_store.h"
#include "engine/lift.h"

namespace engine {

// Result of a percentile query. `n` is always reported alongside the
// percentile: a percentile over a handful of results is not wrong, it is
// meaningless, and the caller needs n to judge that (percentile-design.md,
// decision 3).
struct PercentileResult {
    bool found = false;          // false = no such group, or unassignable input
    double percentile = 0.0;     // 0-100: share of the group strictly below
    std::size_t rank = 0;
    std::size_t below = 0;       // count strictly below the query value
    std::size_t n = 0;           // group size
};

struct DistributionResult {
    bool        found = false;
    std::size_t n     = 0;
    double      mean  = 0.0;
    double      sd    = 0.0;
    float min = 0.0f;
    float max = 0.0f;
    // bins + sigma marks come next
};

// Inverse of PercentileResult. `actual_percentile` is what percentile_of()
// reports for `value`, and can sit below the percentile asked for: ties mean
// sorted[rank_index_at(n, p)] can have fewer than p% strictly below it. F/Raw/SBD
// 63 kg, p = 95: value 405, actual 94.93. Returned so the two directions can't
// quietly disagree on screen.
struct ValueAtResult {
    bool        found             = false;
    std::size_t n                 = 0;
    float       value             = 0.0f;
    double      actual_percentile = 0.0;
};

struct Neighbour { std::uint32_t row; float value; };

struct NearestResult {
    bool                   found = false;
    std::size_t            n     = 0;
    std::vector<Neighbour> neighbours;
};


struct HistogramResult {
    bool   found = false;
    std::size_t n = 0;
    double mean = 0.0, sd = 0.0;
    float  min = 0.0f, max = 0.0f;
    float  bin_width = 0.0f;
    std::vector<HistBin> bins;
};


struct Entry      { float value; std::uint32_t row; };
struct LiftIndex  { std::vector<Entry> sorted; double mean = 0.0; double sd = 0.0; };
struct GroupIndex { LiftIndex squat, bench, deadlift, total; };

// Sorted totals per comparison group, built once from a loaded ColumnStore.
//
// Group = sex x equipment x event x IPF weight class.
//
class PercentileIndex {
public:
    explicit PercentileIndex(const ColumnStore& store);

    // Owns ~15 MB: non-copyable so an accidental copy is a compile error,
    // movable so it can be returned by value. Same rule as ColumnStore.
    PercentileIndex(const PercentileIndex&) = delete;
    PercentileIndex& operator=(const PercentileIndex&) = delete;
    PercentileIndex(PercentileIndex&&) noexcept = default;
    PercentileIndex& operator=(PercentileIndex&&) noexcept = default;

    // Percentile = (count strictly below) / (group size), no interpolation.
    // The simplest definition to state, and the least misleading on small samples
    [[nodiscard]] PercentileResult percentile_of(Sex sex, Equipment equipment, Event event,
                                   std::uint8_t ipf_class, LiftKind, float value) const;


    // Nearest-rank via rank_index_at(), the codebase's one percentile convention.
    [[nodiscard]] ValueAtResult value_at_percentile(Sex sex, Equipment equipment, Event event,
                                                    std::uint8_t ipf_class, LiftKind which,
                                                    double pct) const;

    [[nodiscard]] DistributionResult distribution(Sex, Equipment, Event,
                                std::uint8_t ipf_class, LiftKind) const;

    [[nodiscard]] NearestResult nearest(Sex, Equipment, Event, std::uint8_t ipf_class,
                      LiftKind which, float value, std::size_t k, const std::vector<std::uint32_t>& names) const;

    [[nodiscard]] HistogramResult histogram(Sex sex, Equipment equipment, Event event,
                          std::uint8_t ipf_class, LiftKind which,
                          float bin_width) const;


    [[nodiscard]] std::size_t group_count() const;    // groups with at least one value
    [[nodiscard]] std::size_t total_values() const;   // values across all groups
    [[nodiscard]] std::size_t bytes() const;          // memory held by the sorted arrays
    [[nodiscard]] std::size_t values(LiftKind which) const;   // entries for one lift, all groups

private:
    // The key space is dense and tiny: 3 sexes x 6 equipment x 7 events x
    // 9 classes = 1,134 combinations, so a flat array indexed by a mixed-radix
    // offset beats a hash map. No hashing, no probing, no allocation per key.
    static constexpr std::size_t kSexes = 3;
    static constexpr std::size_t kEquipment = 6;
    static constexpr std::size_t kEvents = 7;
    static constexpr std::size_t kClasses = 9;   // 0-7 named, 8 = open
    static constexpr std::size_t kSlots = kSexes * kEquipment * kEvents * kClasses;
    static constexpr std::size_t kNoSlot = kSlots;


    static std::size_t slot_of(Sex sex, Equipment equipment, Event event,
                               std::uint8_t ipf_class);

    // nullptr when there is no such slot or the group is empty.
    const LiftIndex* find_index(Sex, Equipment, Event,
                                std::uint8_t ipf_class, LiftKind) const;

    std::vector<GroupIndex> groups_;   // kSlots entries, most small

};

}  // namespace engine