#include "engine/percentile.h"

#include <algorithm>
#include <array>
#include <numeric>
#include<unordered_set>

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

std::size_t count_below(const LiftIndex& li, float value) {

    const auto it = std::lower_bound(li.sorted.begin(), li.sorted.end(), value,
                                 [](const Entry& e, float v) { return e.value < v; });
    return static_cast<std::size_t>(it - li.sorted.begin());
}

std::size_t count_at_or_below(const LiftIndex& li, float value) {
    const auto it = std::upper_bound(li.sorted.begin(), li.sorted.end(), value,
                                 [](float v, const Entry& e) { return v < e.value; });
    return static_cast<std::size_t>(it - li.sorted.begin());
}


constexpr LiftKind kLifts[4] = { LiftKind::Squat, LiftKind::Bench, LiftKind::Deadlift, LiftKind::Total };

// Ascending by value; ties broken by row so the index is identical across
// runs. Without the tie-break, "nearest lifters" shows an arbitrary one of
// several tied lifters, and a different one after every rebuild.
void sort_lift(LiftIndex& li) {
    std::sort(li.sorted.begin(), li.sorted.end(),
              [](const Entry& a, const Entry& b) {
                  if (a.value != b.value) { return a.value < b.value; }
                  return a.row < b.row;
              });

    if (!li.sorted.empty()) {
        // Calculate mean
        double sum = std::accumulate(li.sorted.begin(), li.sorted.end(), 0.0,
                [](double acc, const Entry& e) { return acc + e.value; });
        li.mean = sum / li.sorted.size();

        //  Calculate sum of squared differences
        double mean = li.mean;
        double ss = 0.0;
        for (const auto& e : li.sorted) {
            double diff = e.value - mean ;
            ss += diff * diff;
        }

        // Calculate standard deviation (using population variance: size)

        li.sd = std::sqrt(ss / li.sorted.size());
    }

}

}  // namespace


const LiftIndex *PercentileIndex::find_index(Sex sex, Equipment equipment, Event event, std::uint8_t ipf_class, LiftKind which) const {

    const std::size_t slot = slot_of(sex, equipment, event, ipf_class);   // size_t
    if (slot == kNoSlot) { return nullptr; }                              // nullptr

    const LiftIndex& li = lift_of(groups_[slot], which);
    if (li.sorted.empty()) { return nullptr; }

    return &li;

}



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
                                                std::uint8_t ipf_class, LiftKind which,
                                                float value) const {
    PercentileResult r;

    const LiftIndex* li = find_index(sex, equipment, event, ipf_class, which);
    if (li == nullptr) { return r; }        // found stays false

    r.below      = count_below(*li, value);
    r.n          = li->sorted.size();
    if (r.n == 0){return r;}
    r.rank       = r.n - count_at_or_below(*li, value) + 1;
    r.percentile = 100.0 * static_cast<double>(r.below) / static_cast<double>(r.n);
    r.found      = true;
    return r;
}


    DistributionResult PercentileIndex::distribution(
            Sex sex, Equipment equipment, Event event,
            std::uint8_t ipf_class, LiftKind which) const {

    DistributionResult r;

   const LiftIndex* li = find_index(sex, equipment,event,ipf_class,which);
    if (li == nullptr) { return r; }


    r.n     = li->sorted.size();
    r.mean  = li->mean;
    r.sd    = li->sd;
    r.found = true;
    return r;

}

NearestResult PercentileIndex::nearest(Sex sex, Equipment equipment, Event event,
                                       std::uint8_t ipf_class, LiftKind which,
                                       float value, std::size_t k,
                                       const std::vector<std::uint32_t>& names) const {
    NearestResult r;

    const LiftIndex* li = find_index(sex, equipment, event, ipf_class, which);
    if (li == nullptr) { return r; }

    const std::size_t n = li->sorted.size();
    r.n     = n;          // the GROUP size, not neighbours.size()
    r.found = true;       // the group EXISTS even if it is empty -- your own rule
    if (n == 0 || k == 0) { return r; }

    // First index whose value is >= `value`; everything below it is strictly less.
    const std::size_t pos = count_below(*li, value);

    const std::size_t want_below = k / 2;
    const std::size_t want_above = k - want_below;   // k=5 -> 2 below, 3 above

    // One lifter can own rows on BOTH sides (a 495 and a 505), so `seen` is
    // shared across all three phases. insert().second is the test and the
    // insert in a single hash lookup.
    std::unordered_set<std::uint32_t> seen;
    std::vector<Neighbour> below;   // collected walking DOWN -> descending
    std::vector<Neighbour> above;   // collected walking UP   -> ascending
    below.reserve(want_below);
    above.reserve(want_above);

    const auto try_take = [&](std::size_t idx, std::vector<Neighbour>& out) {
        const Entry& e = li->sorted[idx];
        // sorted position -> row -> name index. Dropping a step here is the
        // bug that makes `seen` never fire.
        if (seen.insert(names[e.row]).second) { out.push_back({e.row, e.value}); }
    };

    // Phase 1: down from pos. `--i` INSIDE `while (i > 0)` is the underflow
    // guard: `for (i = pos - 1; i >= 0; --i)` on a size_t never terminates, and
    // pos - 1 at pos == 0 wraps to ~1.8e19 and indexes into orbit.
    std::size_t i = pos;
    while (i > 0 && below.size() < want_below) {
        --i;
        try_take(i, below);
    }

    // Phase 2: up from pos. sorted[pos] is at-or-above `value`, so pos itself
    // is included.
    std::size_t j = pos;
    while (j < n && above.size() < want_above) {
        try_take(j, above);
        ++j;
    }

    // Phase 3: either side can run out before filling its quota -- query 70.0
    // and there is nothing below, query 582.5 and there is nothing above. Top
    // up from whichever side still has rows. BOTH halves are required.
    while (i > 0 && below.size() + above.size() < k) {
        --i;
        try_take(i, below);
    }
    while (j < n && below.size() + above.size() < k) {
        try_take(j, above);
        ++j;
    }

    // `below` is descending because we walked downward. Reverse before joining
    // or the result is not sorted -- and it looks *almost* right, which is worse.
    std::reverse(below.begin(), below.end());

    r.neighbours.reserve(below.size() + above.size());
    r.neighbours.insert(r.neighbours.end(), below.begin(), below.end());
    r.neighbours.insert(r.neighbours.end(), above.begin(), above.end());

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