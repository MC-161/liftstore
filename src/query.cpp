#include "engine/query.h"

#include <algorithm>
#include <string_view>
#include <unordered_set>

namespace engine {

    std::vector<const Lift*> top_lifters(const std::vector<Lift>& lifts,
                                         Sex sex, Equipment equipment, Event event,
                                         std::size_t n) {
        if (n == 0) {
            return {};
        }

        // filter. Linear scan over every row.
        std::vector<const Lift*> matches;
        for (const Lift& l : lifts) {
            if (l.sex == sex && l.equipment == equipment && l.event == event &&
                l.place.code == PlaceCode::Placed && l.total_kg.has_value()) {
                matches.push_back(&l);
                }
        }

        // sort, highest total first. Tie-breaks make the order
        // deterministic, so results are comparable across runs and versions.
        std::sort(matches.begin(), matches.end(),
                  [](const Lift* a, const Lift* b) {
                      if (*a->total_kg != *b->total_kg) {
                          return *a->total_kg > *b->total_kg;  // higher total first
                      }
                      if (a->name != b->name) {
                          return a->name < b->name;            // tie: alphabetical
                      }
                      return a->date < b->date;                // same lifter: earlier meet first
                  });

        // first appearance of each name is that lifter's best.
        std::vector<const Lift*> result;
        std::unordered_set<std::string_view> seen;
        for (const Lift* l : matches) {
            if (seen.insert(l->name).second) {  // true only the first time
                result.push_back(l);
                if (result.size() == n) {
                    break;
                }
            }
        }
        return result;
    }

}