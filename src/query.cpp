#include "engine/query.h"

#include <algorithm>
#include <string_view>
#include <unordered_set>
#include "engine/timing.h"
#include <cstdlib>
#include <map>


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

        // Attempt columns for a lift. Total has none; the caller rejects it.
        // No default: -- LiftKind is a closed enum class, so -Wswitch guards it.
        std::pair<const std::vector<float>*, const std::vector<float>*>
        attempt_columns(const ColumnStore& store, LiftKind w) {
            switch (w) {
                case LiftKind::Squat:    return {&store.squat2_kg,    &store.squat3_kg};
                case LiftKind::Bench:    return {&store.bench2_kg,    &store.bench3_kg};
                case LiftKind::Deadlift: return {&store.deadlift2_kg, &store.deadlift3_kg};
                case LiftKind::Total:    return {nullptr, nullptr};
            }
            return {nullptr, nullptr};
        }

        struct SwapRow { std::uint32_t name; bool is_to; float value; };

        struct ChangeRow {
            std::uint32_t name;
            std::uint32_t date;     // yyyymmdd
            std::uint8_t  cls;
            float         total;
        };

        // Months between two yyyymmdd dates. Signed arithmetic deliberately.
        int months_between(std::uint32_t a, std::uint32_t b) {
            const int ya = static_cast<int>(a / 10000);
            const int ma = static_cast<int>((a / 100) % 100);
            const int yb = static_cast<int>(b / 10000);
            const int mb = static_cast<int>((b / 100) % 100);
            return (yb - ya) * 12 + (mb - ma);
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


AttemptsResult attempts(const ColumnStore &store, Sex sex, Equipment equipment, Event event, std::uint8_t ipf_class, LiftKind which, float bin_width) {
     AttemptsResult r;

    const auto [a2_col, a3_col] = attempt_columns(store, which);
    if (a2_col == nullptr) { return r; }          // Total: no attempts exist

    const std::vector<float>& a2 = *a2_col;
    const std::vector<float>& a3 = *a3_col;

    // ---- pass 1: collect every jump ----
    std::vector<float> jumps;
    double sum = 0.0;

    for (std::size_t i = 0; i < store.size(); ++i) {
        // Cheap enum comparisons first.
        // NOTE: deliberately NO place_code gate. A bomb-out does not place, and
        // bomb-outs are exactly the lifters with failed third attempts -- gating
        // on Placed would compute success_rate over a population pre-selected
        // for success. The important line here is the one that isn't.
        if (store.sex[i] != sex || store.equipment[i] != equipment
            || store.event[i] != event) { continue; }

        // A function call per surviving row, so it goes after the enum tests.
        if (store.ipf_class[i] != ipf_class) { continue; }
        const float v2 = a2[i];
        const float v3 = a3[i];
        if (is_missing(v2) || is_missing(v3)) { continue; }
        if (v2 == 0.0f || v3 == 0.0f) { continue; }   // "not attempted", if encoded as 0

        // A failed attempt is stored negative, but the weight was still attempted.
        const float jump = std::fabs(v3) - std::fabs(v2);

        jumps.push_back(jump);
        sum += jump;                                   // DOUBLE accumulator
        if (v3 > 0.0f) { ++r.third_success; }
    }

    r.n = jumps.size();
    if (r.n == 0) { return r; }

    r.mean_jump = sum / static_cast<double>(r.n);

    // ---- pass 2: two-pass sd, same reason as sort_lift ----
    double ss = 0.0;
    for (const float j : jumps) {
        const double d = static_cast<double>(j) - r.mean_jump;
        ss += d * d;
    }
    r.sd_jump = std::sqrt(ss / static_cast<double>(r.n));

    const auto [lo_it, hi_it] = std::minmax_element(jumps.begin(), jumps.end());
    r.min_jump = *lo_it;
    r.max_jump = *hi_it;

    // ---- pass 3: bins by direct index ----
    const float first_edge = std::floor(r.min_jump / bin_width) * bin_width;
    const auto  bin_count  = static_cast<std::size_t>(
                                 std::floor((r.max_jump - first_edge) / bin_width)) + 1;

    std::vector<std::size_t> counts(bin_count, 0);
    for (const float j : jumps) {
        // (j - first_edge) is >= 0 because first_edge <= min_jump. Cast only
        // after that is guaranteed -- a negative intermediate wraps to ~1.8e19.
        const auto idx = static_cast<std::size_t>((j - first_edge) / bin_width);
        ++counts[idx < bin_count ? idx : bin_count - 1];
    }

    r.bins.reserve(bin_count);
    for (std::size_t b = 0; b < bin_count; ++b) {
        r.bins.push_back({first_edge + static_cast<float>(b)     * bin_width,
                          first_edge + static_cast<float>(b + 1) * bin_width,
                          counts[b]});
    }

    return r;
}


std::vector<TrendRow> class_trend(const ColumnStore& store, Sex sex, Equipment equipment,
                                  Event event, std::uint8_t ipf_class, LiftKind which,
                                  std::uint32_t start_year, std::uint32_t end_year) {

        const std::vector<float>& col = column_of(store, which);
        // phase 1: bucket the values by year
        std::map<std::uint32_t, std::vector<float>> by_year;

        for (std::size_t i = 0; i < store.size(); ++i) {
            if (store.place_code[i] != PlaceCode::Placed) { continue; }     // <-- new
            if (store.sex[i] != sex || store.equipment[i] != equipment
                || store.event[i] != event || store.ipf_class[i] != ipf_class) { continue; }

            const std::uint32_t d = store.date[i];
            if (d == 0) { continue; }                 // 0 is the missing-date sentinel
            const std::uint32_t y = d / 10000;        // yyyymmdd -> yyyy
            if (y < start_year || y > end_year) { continue; }

            const float v = col[i];
            if (is_missing(v)) { continue; }

            by_year[y].push_back(v);
        }

        std::vector<TrendRow> rows;
        if (by_year.empty()) { return rows; }

        // Walk every year from the first with data to the last, so an interior gap
        // comes back as an n == 0 row instead of being silently closed up.
        const std::uint32_t first = by_year.begin()->first;
        const std::uint32_t last  = by_year.rbegin()->first;

        for (std::uint32_t y = first; y <= last; ++y) {
            TrendRow row;
            row.year = y;

            const auto it = by_year.find(y);
            if (it == by_year.end()) { rows.push_back(row); continue; }   // the gap

            std::vector<float>& vals = it->second;
            std::sort(vals.begin(), vals.end());        // THIS year's values

            row.n = vals.size();

            double sum = 0.0;
            for (const float v : vals) { sum += v; }
            row.mean = sum / static_cast<double>(row.n);

            double ss = 0.0;                            // two-pass, as always
            for (const float v : vals) {
                const double dv = static_cast<double>(v) - row.mean;
                ss += dv * dv;
            }
            row.sd = std::sqrt(ss / static_cast<double>(row.n));

            row.p50 = value_at(vals, 50.0);
            row.p90 = value_at(vals, 90.0);

            rows.push_back(row);
        }

        return rows;
    }


SwapResult equipment_swap(const ColumnStore& store, Sex sex, Event event,
                          Equipment from, Equipment to, std::uint8_t ipf_class,
                          LiftKind which) {
    SwapResult r;
    if (from == to) { return r; }          // defensive; the handler rejects it first

    const std::vector<float>& col = column_of(store, which);

    // ---- collect the two buckets ----
    std::vector<SwapRow> rows;
    for (std::size_t i = 0; i < store.size(); ++i) {
        if (store.place_code[i] != PlaceCode::Placed) { continue; }
        if (store.sex[i] != sex || store.event[i] != event
            || store.ipf_class[i] != ipf_class) { continue; }   // class held fixed

        const Equipment e = store.equipment[i];
        const bool is_to = (e == to);
        if (!is_to && e != from) { continue; }

        const float v = col[i];
        if (is_missing(v)) { continue; }

        rows.push_back({store.name[i], is_to, v});
    }

    // ---- group by lifter: sort by name, walk the equal-name runs ----
    std::sort(rows.begin(), rows.end(),
              [](const SwapRow& a, const SwapRow& b) { return a.name < b.name; });

    std::vector<float> deltas;
    std::size_t i = 0;
    while (i < rows.size()) {
        const std::uint32_t name = rows[i].name;

        bool  have_from = false, have_to  = false;
        float best_from = 0.0f,  best_to  = 0.0f;

        std::size_t j = i;
        while (j < rows.size() && rows[j].name == name) {
            if (rows[j].is_to) {
                if (!have_to   || rows[j].value > best_to)   { best_to   = rows[j].value; have_to   = true; }
            } else {
                if (!have_from || rows[j].value > best_from) { best_from = rows[j].value; have_from = true; }
            }
            ++j;
        }

        // Only lifters with a result in BOTH categories contribute.
        if (have_from && have_to) { deltas.push_back(best_to - best_from); }

        i = j;                             // NOT ++i -- see below
    }

    r.lifters = deltas.size();
    if (r.lifters == 0) { return r; }

    double sum = 0.0;
    for (const float d : deltas) { sum += d; }
    r.mean_delta = sum / static_cast<double>(r.lifters);

    double ss = 0.0;
    for (const float d : deltas) {
        const double dv = static_cast<double>(d) - r.mean_delta;
        ss += dv * dv;
    }
    r.sd_delta = std::sqrt(ss / static_cast<double>(r.lifters));

    std::sort(deltas.begin(), deltas.end());
    r.median_delta = value_at(deltas, 50.0);

    return r;
}

ClassChangeResult class_change(const ColumnStore& store, Sex sex, Equipment equipment,
                               Event event, int class_delta, float bin_width) {
    ClassChangeResult r;
    if (class_delta == 0) { return r; }        // handler rejects first

    const std::vector<float>& col = column_of(store, LiftKind::Total);

    // ---- pass 1: every comparable result, with its class and date ----
    // NOTE: no ipf_class gate -- the class changing is the whole subject.
    std::vector<ChangeRow> rows;
    for (std::size_t i = 0; i < store.size(); ++i) {
        if (store.place_code[i] != PlaceCode::Placed) { continue; }
        if (store.sex[i] != sex || store.equipment[i] != equipment
            || store.event[i] != event) { continue; }
        if (store.ipf_class[i] == kNoIpfClass) { continue; }   // unassignable
        if (store.date[i] == 0) { continue; }

        const float v = col[i];
        if (is_missing(v)) { continue; }

        rows.push_back({store.name[i], store.date[i], store.ipf_class[i], v});
    }

    // ---- group by lifter, ordered within each lifter by date ----
    std::sort(rows.begin(), rows.end(), [](const ChangeRow& a, const ChangeRow& b) {
        if (a.name != b.name) { return a.name < b.name; }
        return a.date < b.date;
    });

    std::vector<float> deltas;
    std::size_t i = 0;
    while (i < rows.size()) {
        const std::uint32_t name = rows[i].name;

        std::size_t j = i;
        while (j < rows.size() && rows[j].name == name) { ++j; }   // [i, j) is this lifter

        bool contributed = false;
        for (std::size_t k = i; k + 1 < j; ++k) {
            // Chronologically ADJACENT pair. Note cls is uint8_t -- cast to int
            // before subtracting, or a downward move reads as a huge positive.
            const int moved = static_cast<int>(rows[k + 1].cls) - static_cast<int>(rows[k].cls);
            if (moved != class_delta) { continue; }
            if (months_between(rows[k].date, rows[k + 1].date) > 18) { continue; }

            const float d = rows[k + 1].total - rows[k].total;
            deltas.push_back(d);
            if (d > 0.0f) { ++r.improved; }
            contributed = true;
        }
        if (contributed) { ++r.lifters; }

        i = j;                                 // NOT ++i
    }

    r.transitions = deltas.size();
    if (r.transitions == 0) { return r; }

    double sum = 0.0;
    for (const float d : deltas) { sum += d; }
    r.mean_delta = sum / static_cast<double>(r.transitions);

    double ss = 0.0;
    for (const float d : deltas) {
        const double dv = static_cast<double>(d) - r.mean_delta;
        ss += dv * dv;
    }
    r.sd_delta = std::sqrt(ss / static_cast<double>(r.transitions));

    // ---- bins by direct index, as in attempts() ----
    const auto [lo_it, hi_it] = std::minmax_element(deltas.begin(), deltas.end());
    const float first_edge = std::floor(*lo_it / bin_width) * bin_width;
    const auto  bin_count  = static_cast<std::size_t>(
                                 std::floor((*hi_it - first_edge) / bin_width)) + 1;

    std::vector<std::size_t> counts(bin_count, 0);
    for (const float d : deltas) {
        const auto idx = static_cast<std::size_t>((d - first_edge) / bin_width);
        ++counts[idx < bin_count ? idx : bin_count - 1];
    }

    r.bins.reserve(bin_count);
    for (std::size_t b = 0; b < bin_count; ++b) {
        r.bins.push_back({first_edge + static_cast<float>(b)     * bin_width,
                          first_edge + static_cast<float>(b + 1) * bin_width,
                          counts[b]});
    }

    return r;
}




}
