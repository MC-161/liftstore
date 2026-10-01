#include "engine/percentile.h"

#include <algorithm>

namespace engine {

std::size_t PercentileIndex::slot_of(Sex sex, Equipment equipment, Event event, std::uint8_t ipf_class) {
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

    std::vector<std::size_t> counts(kSlots, 0);

    for (std::size_t i = 0; i < rows; ++i) {
        if (store.place_code[i] != PlaceCode::Placed) {
            continue;
        }
        if (is_missing(store.total_kg[i])) {
            continue;
        }
        std::size_t s = slot_of(store.sex[i], store.equipment[i], store.event[i], store.ipf_class[i]);
        if (s == kNoSlot) {continue;}

        ++counts[s];
    }

    // Now each group knows its final size.
    for (std::size_t s = 0; s < kSlots; ++s) {
        groups_[s].reserve(counts[s]);
    }

    for (std::size_t i = 0; i < rows; ++i) {
        if (store.place_code[i] != PlaceCode::Placed) {
            continue;
        }
        if (is_missing(store.total_kg[i])) {
            continue;
        }
        std::size_t s = slot_of(store.sex[i], store.equipment[i], store.event[i], store.ipf_class[i]);
        if (s == kNoSlot) {continue;}

        groups_[s].push_back(store.total_kg[i]);
    }

    for (auto& g : groups_) {
        std::sort(g.begin(), g.end());
    }

}

// The simplest definition to state, and the least misleading on small samples
    PercentileResult PercentileIndex::percentile_of(Sex sex, Equipment equipment,
                                                    Event event,
                                                    std::uint8_t ipf_class,
                                                    float total_kg) const{
    PercentileResult r;

    std::size_t slot = slot_of(sex, equipment, event, ipf_class);
    if (slot == kNoSlot) {
        return r;
    }

    const std::vector<float>& g = groups_[slot];
    if (g.empty()) {
        return r;
    }

    auto it = std::lower_bound(g.begin(), g.end(), total_kg);
    r.below = static_cast<std::size_t>(it - g.begin());
    r.n = g.size();
    r.percentile = 100.0 * r.below / r.n;
    r.found = true;

    return r;

}


std::size_t PercentileIndex::group_count() const {
    std::size_t n = 0;
    for (const auto& g : groups_) {
        if (!g.empty()) {
            ++n;
        }
}
return n;
}

std::size_t PercentileIndex::total_values() const {
    std::size_t n = 0;
    for (const auto& g : groups_) {
        n += g.size();
}
return n;
}

std::size_t PercentileIndex::bytes() const {
    std::size_t n = groups_.size() * sizeof(std::vector<float>);
    for (const auto& g : groups_) {
        n += g.capacity() * sizeof(float);
    }
return n;
}

}