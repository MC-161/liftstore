#include "engine/query.h"

#include <algorithm>
#include <string_view>
#include <unordered_set>
#include "engine/timing.h"

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

    std::vector<Ranked> top_lifters_columnar(const ColumnStore &store, Sex sex, Equipment equipment, Event event, std::size_t n) {
        if (n == 0) {
            return {};
        }

        Timer t;
        std::vector<Ranked> matches;
        const std::size_t n_rows = store.size();
        for (std::size_t i = 0; i < n_rows; ++i) {
            if (store.sex[i] == sex && store.equipment[i] == equipment &&
                store.event[i] == event && store.place_code[i] == PlaceCode::Placed) {
                matches.push_back({static_cast<std::uint32_t>(i), store.total_kg[i]});
                }
        }
        const double filter_ms  = t.ms();

        // t.reset();
        // const std::size_t k = std::min<std::size_t>(5, matches.size());
        // std::partial_sort(matches.begin(), matches.begin() + k, matches.end(),
        //                   [&store](const Ranked& a, const Ranked& b) {
        //                       if (a.total != b.total) {
        //                           return a.total > b.total;
        //                       }
        //                       std::string_view na = store.name_dict.value(store.name[a.row]);
        //                       std::string_view nb = store.name_dict.value(store.name[b.row]);
        //                       if (na != nb) {
        //                           return na < nb;
        //                       }
        //                       return store.date[a.row] < store.date[b.row];
        //                   });
        // const double sort_ms = t.ms();
        //
        // t.reset();
        // std::vector<Ranked> result;
        // std::unordered_set<std::uint32_t> seen;
        // for (std::size_t i = 0; i < k; ++i) {
        //     const Ranked& m = matches[i];
        //     if (seen.insert(store.name[m.row]).second) {
        //         result.push_back(m);
        //         if (result.size() == n) { break; }
        //     }
        // }
        //
        // if (result.size() < n && k < matches.size()) {
        //
        // }
        // const double dedupe_ms = t.ms();

        t.reset();
        auto cmp = [&store](const Ranked& a, const Ranked& b) {
            if (a.total != b.total) { return a.total > b.total; }
            std::string_view na = store.name_dict.value(store.name[a.row]);
            std::string_view nb = store.name_dict.value(store.name[b.row]);
            if (na != nb) { return na < nb; }
            return store.date[a.row] < store.date[b.row];
        };

        double sort_ms = 0.0;
        double dedupe_ms = 0.0;
        int attempts = 0;

        std::vector<Ranked> result;
        std::unordered_set<std::uint32_t> seen;

        std::size_t k = std::min<std::size_t>(200, matches.size());

        while (true) {
            ++attempts;
            result.clear();
            seen.clear();

            Timer ts;
            std::partial_sort(matches.begin(),
                              matches.begin() + static_cast<std::ptrdiff_t>(k),
                              matches.end(), cmp);
            sort_ms += ts.ms();

            Timer td;
            for (std::size_t i = 0; i < k; ++i) {
                if (seen.insert(store.name[matches[i].row]).second) {
                    result.push_back(matches[i]);
                    if (result.size() == n) { break; }
                }
            }
            dedupe_ms += td.ms();

            if (result.size() == n) { break; }          // found enough
            if (k == matches.size()) { break; }         // sorted everything: this is all there is

            k = std::min(k * 2, matches.size());        // widen and try again
        }


        std::fprintf(stderr, "  filter %.1f  sort %.1f  dedupe %.1f  (%zu matches, %d attempt%s)\n",
                 filter_ms, sort_ms, dedupe_ms, matches.size(),
                 attempts, attempts == 1 ? "" : "s");

        return result;

    }



}