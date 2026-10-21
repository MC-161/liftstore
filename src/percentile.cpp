#include "engine/percentile.h"

#include <algorithm>
#include <array>

namespace engine {
namespace {

// Which array inside a group holds this lift. Exactly one place knows the
// mapping, so the build loop and every query can never disagree.
//
// No `default:` -- LiftKind is our own closed enum, so -Wswitch warns if a fifth
// lift is added and this is not updated. (The opposite of from_proto, where
// the enum is proto3 and open, and `default` is mandatory.)
LiftIndex& lift_of(GroupIndex& g, LiftKind w) {
    switch (w) {
        case LiftKind::Squat:    return g.squat;
        case LiftKind::Bench:    return g.bench;
        case LiftKind::Deadlift: return g.deadlift;
        case LiftKind::Total:    break;
    }
    return g.total;
}

// Written out rather than const_cast'ing the above. const_cast is what you
// grep for when hunting thread-safety bugs; it shouldn't appear in code that
// has no reason to need it.
const LiftIndex& lift_of(const GroupIndex& g, LiftKind w) {
    switch (w) {
        case LiftKind::Squat:    return g.squat;
        case LiftKind::Bench:    return g.bench;
        case LiftKind::Deadlift: return g.deadlift;
        case LiftKind::Total:    break;
    }
    return g.total;
}



constexpr LiftKind kLifts[4] = { LiftKind::Squat, LiftKind::Bench, LiftKind::Deadlift, LiftKind::Total };

// Ascending by value; ties broken by row so the index is identical across
// runs. Without the tie-break, Q5 "nearest lifters" shows an arbitrary one of
// several tied lifters, and a different one after every rebuild.
// Step 4 will compute mean/sd here -- one walk, one place.
void sort_lift(LiftIndex& li) {
    std::sort(li.sorted.begin(), li.sorted.end(),
              [](const Entry& a, const Entry& b) {
                  if (a.value != b.value) { return a.value < b.value; }
                  return a.row < b.row;
              });
}

}  // namespace


std::size_t PercentileIndex::slot_of(Sex sex, Equipment equipment, Event event,
                                     std::uint8_t ipf_class) {
    const auto s = static_cast<std::size_t>(sex);
    const auto q = static_cast<std::size_t>(equipment);
    const auto e = static_cast<std::size_t>(event);
    const auto c = static_cast<std::size_t>(ipf_class);

    // ipf_class 255 (unassignable) lands here, as would any corrupted enum.
    if (s >= kSexes || q >= kEquipment || e >= kEvents || c >= kClasses) {
        return kNoSlot;
    }
    return ((s * kEquipment + q) * kEvents + e) * kClasses + c;
}


PercentileIndex::PercentileIndex(const ColumnStore& store)
        : groups_(kSlots) {
    const std::size_t rows = store.size();

    // Pass 1 -- count per (slot, lift) so every array allocates exactly once.
    std::vector<std::array<std::size_t, 4>> counts(kSlots, {0, 0, 0, 0});

    for (std::size_t i = 0; i < rows; ++i) {
        if (store.place_code[i] != PlaceCode::Placed) { continue; }

        const std::size_t s = slot_of(store.sex[i], store.equipment[i],
                                      store.event[i], store.ipf_class[i]);
        if (s == kNoSlot) { continue; }

        // Four INDEPENDENT tests, not four reasons to skip the row: a lifter
        // missing a squat still contributes a bench, a deadlift and a total.
        for (const LiftKind w : kLifts) {
            if (!is_missing(column_of(store, w)[i])) {
                ++counts[s][static_cast<std::size_t>(w)];
            }
        }
    }

    for (std::size_t s = 0; s < kSlots; ++s) {
        for (const LiftKind w : kLifts) {
            lift_of(groups_[s], w).sorted.reserve(counts[s][static_cast<std::size_t>(w)]);
        }
    }

    // Pass 2 -- fill. The gates MUST match pass 1 exactly; if they diverge,
    // reserve is wrong and (worse) a missing value could enter the array,
    // where a NaN would violate strict weak ordering and make std::sort UB.
    for (std::size_t i = 0; i < rows; ++i) {
        if (store.place_code[i] != PlaceCode::Placed) { continue; }

        const std::size_t s = slot_of(store.sex[i], store.equipment[i],
                                      store.event[i], store.ipf_class[i]);
        if (s == kNoSlot) { continue; }

        const auto row = static_cast<std::uint32_t>(i);
        for (const LiftKind w : kLifts) {
            const float v = column_of(store, w)[i];
            if (!is_missing(v)) {
                lift_of(groups_[s], w).sorted.push_back({ v, row });
            }
        }
    }

    for (auto& g : groups_) {
        for (const LiftKind w : kLifts) {
            sort_lift(lift_of(g, w));
        }
    }
}


// Percentile = (count strictly below) / (group size), no interpolation.
// The simplest definition to state, and the least misleading on small samples.
PercentileResult PercentileIndex::percentile_of(Sex sex, Equipment equipment,
                                                Event event,
                                                std::uint8_t ipf_class,
                                                float total_kg) const {
    PercentileResult r;

    const std::size_t slot = slot_of(sex, equipment, event, ipf_class);
    if (slot == kNoSlot) { return r; }

    const std::vector<Entry>& g = groups_[slot].total.sorted;
    if (g.empty()) { return r; }

    const auto it = std::lower_bound(g.begin(), g.end(), total_kg,
                                     [](const Entry& e, float v) { return e.value < v; });

    r.below      = static_cast<std::size_t>(it - g.begin());
    r.n          = g.size();
    r.percentile = 100.0 * static_cast<double>(r.below) / static_cast<double>(r.n);
    r.found      = true;
    return r;
}


std::size_t PercentileIndex::group_count() const {
    std::size_t n = 0;
    for (const auto& g : groups_) {
        if (!g.total.sorted.empty()) { ++n; }
    }
    return n;
}

// Entries for ONE lift, across all groups. Verification compares these four
// numbers to awk individually -- a single sum would hide one array being too
// large while another is too small.
std::size_t PercentileIndex::values(LiftKind which) const {
    std::size_t n = 0;
    for (const auto& g : groups_) {
        n += lift_of(g, which).sorted.size();
    }
    return n;
}

std::size_t PercentileIndex::total_values() const {
    std::size_t n = 0;
    for (const auto& g : groups_) {
        for (const LiftKind w : kLifts) { n += lift_of(g, w).sorted.size(); }
    }
    return n;
}

std::size_t PercentileIndex::bytes() const {
    std::size_t n = groups_.size() * sizeof(GroupIndex);
    for (const auto& g : groups_) {
        for (const LiftKind w : kLifts) {
            n += lift_of(g, w).sorted.capacity() * sizeof(Entry);
        }
    }
    return n;
}

}  // namespace engine