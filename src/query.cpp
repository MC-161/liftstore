#include "engine/query.h"

#include <algorithm>
#include <string_view>
#include <unordered_set>
#include "engine/timing.h"
#include <cstdlib>

namespace engine {
    namespace {
        struct ScanResult { std::size_t below = 0; std::size_t n = 0; };

        ScanResult scan_pop( const ColumnStore& store,
        Sex sex, Equipment equipment, Event event,
        LiftKind condition_lift, float condition_value,
        LiftKind target_lift,    float target_value,
        float tol) {

            ScanResult r;
            const std::vector<float>& cond_col = column_of(store, condition_lift);
            const std::vector<float>& targ_col = column_of(store, target_lift);

            for (std::size_t i = 0; i < store.size(); ++i) {
                if (store.place_code[i] != PlaceCode::Placed || store.equipment[i] != equipment || store.event[i] != event || store.sex[i] != sex) {
                    continue;
                }

                const float row_cv = cond_col[i];   // their squat ex
                if (is_missing(row_cv) ||
                    row_cv < condition_value - tol ||
                    row_cv > condition_value + tol) { continue; }

                const float row_tv = targ_col[i];
                if (is_missing(row_tv)) { continue; }

                ++r.n;
                if (row_tv < target_value) { ++r.below; }   // STRICTLY below
            }

            return r;
        }
    }

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
        const std::size_t n_rows = store.size();

        std::vector<Ranked> matches;
        // Without this, every request grows this vector from empty through a dozen
        // reallocations -- up to ~12 MB for the largest group (M/Raw/SBD, ~1.6M
        // matches). Under concurrency that is heavy malloc traffic on a lock.
        // n_rows/10 is a compromise: it covers most groups in one allocation while
        // keeping the transient cost ~3 MB per in-flight request. Reserving for the
        // worst case instead would be 12 MB x 50 concurrent = 640 MB.
        matches.reserve(n_rows / 10);
        for (std::size_t i = 0; i < n_rows; ++i) {
            if (store.sex[i] == sex && store.equipment[i] == equipment &&
                store.event[i] == event && store.place_code[i] == PlaceCode::Placed) {
                matches.push_back({static_cast<std::uint32_t>(i), store.total_kg[i]});
                }
        }
        const double filter_ms  = t.ms();


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


        // Per-query trace, off by default: stderr is a shared FILE* with an
        // internal lock, so leaving this on makes every handler thread queue
        // behind every other one. Set ENGINE_QUERY_TRACE=1 to turn it back on.
        // Function-local static: initialised once, thread-safely , so
        // the hot path reads a bool.
        static const bool trace = std::getenv("ENGINE_QUERY_TRACE") != nullptr;
        if (trace) {
            std::fprintf(stderr, "  filter %.1f  sort %.1f  dedupe %.1f  (%zu matches, %d attempt%s)\n",
                         filter_ms, sort_ms, dedupe_ms, matches.size(),
                         attempts, attempts == 1 ? "" : "s");
        }

        return result;

    }




    ConditionalResult conditional_percentile(
        const ColumnStore& store,
        Sex sex, Equipment equipment, Event event,
        LiftKind condition_lift, float condition_value,
        LiftKind target_lift,    float target_value,
        float tol , std::size_t min_n ) {

        ConditionalResult res;


        // helper function scans once at a given tolerance and return { below , n }
        ScanResult r = scan_pop(store, sex, equipment, event,
                        condition_lift, condition_value,
                        target_lift, target_value, tol);
        float used = tol;

        // widen once if the sample is too small
        if (r.n < min_n) {
            used = tol * 2.0f;
            r = scan_pop(store, sex, equipment, event,
                     condition_lift, condition_value,
                     target_lift, target_value, used);
        }

        res.n = r.n;
        res.below = r.below;
        res.tol_used = used;
        res.found = (r.n > 0);
        res.percentile = (r.n > 0) ? 100.0 * double(r.below) / double(r.n) : 0.0;

        return res;
}



}