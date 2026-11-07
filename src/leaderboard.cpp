#include "engine/leaderboard.h"

#include <algorithm>
#include <cmath>
#include <string_view>

namespace engine {
    namespace {
        double pct(const PercentileIndex& ix, Sex s, Equipment q, Event e, std::uint8_t c,
                   LiftKind w, float v) {
            return ix.percentile_of(s, q, e, c, w, v).percentile;
        }

        double operand(const LifterLine& l, const Operand& o) {
            if (o.metric == Metric::Kg) {
                switch (o.lift) {
                    case LiftKind::Squat:    return l.squat;
                    case LiftKind::Bench:    return l.bench;
                    case LiftKind::Deadlift: return l.deadlift;
                    case LiftKind::Total:    return l.total;
                }
            }
            switch (o.lift) {
                case LiftKind::Squat:    return l.squat_pct;
                case LiftKind::Bench:    return l.bench_pct;
                case LiftKind::Deadlift: return l.deadlift_pct;
                case LiftKind::Total:    return l.total_pct;
            }
            return 0.0;
        }

        // NaN = this line can't be scored (a ratio over zero); it is dropped,
        // never sorted -- a NaN in the comparator is the UB fixed in
        // top_lifters_columnar.
        double score_of(const LifterLine& l, const RankSpec& s) {
            switch (s.preset) {
                case Preset::TopTotal: return l.total;
                case Preset::Dots:     return l.dots;
                case Preset::Balanced: {
                    const double hi = std::max({l.squat_pct, l.bench_pct, l.deadlift_pct});
                    const double lo = std::min({l.squat_pct, l.bench_pct, l.deadlift_pct});
                    return hi - lo;                 // spread of the three: smaller = more balanced
                }
                case Preset::Custom: break;
            }
            const double a = operand(l, s.a);
            switch (s.combine) {
                case Combine::None:  return a;
                case Combine::Minus: return a - operand(l, s.b);
                case Combine::Plus:  return a + operand(l, s.b);
                case Combine::Ratio: {
                    const double b = operand(l, s.b);
                    return b > 0.0 ? a / b : std::nan("");
                }
            }
            return a;
        }

        bool ascending_of(const RankSpec& s) {
            switch (s.preset) {
                case Preset::TopTotal: return false;
                case Preset::Dots:     return false;
                case Preset::Balanced: return true;
                case Preset::Custom:   break;
            }
            return s.ascending;
        }
    }

    float dots_score(Sex sex, float bodyweight, float total) {
        // Coefficients and bodyweight clamps as OpenPowerlifting computes them.
        const bool men = (sex != Sex::F);
        const double bw = std::clamp(static_cast<double>(bodyweight), 40.0, men ? 210.0 : 150.0);
        const double a = men ? -0.000001093 : -0.0000010706;
        const double b = men ? 0.0007391293 : 0.0005158568;
        const double c = men ? -0.1918759221 : -0.1126655495;
        const double d = men ? 24.0900756 : 13.6175032;
        const double e = men ? -307.75076 : -57.96288;
        const double denom = (((a * bw + b) * bw + c) * bw + d) * bw + e;
        return static_cast<float>(static_cast<double>(total) * 500.0 / denom);
    }

    LeaderboardResult leaderboard(const ColumnStore& store, const PercentileIndex& index,
                                  Sex sex, Equipment equipment, Event event,
                                  std::uint8_t ipf_class, const RankSpec& spec,
                                  std::size_t limit, std::optional<YouInput> you) {
        LeaderboardResult r;

        // ---- each lifter's best-total row in the class ----
        struct Cand { std::uint32_t name; std::uint32_t row; };
        std::vector<Cand> cands;
        for (std::size_t i = 0; i < store.size(); ++i) {
            if (store.place_code[i] != PlaceCode::Placed || store.ipf_class[i] != ipf_class) { continue; }
            if (store.sex[i] != sex || store.equipment[i] != equipment || store.event[i] != event) { continue; }
            // Complete lines only: every expression may read any of the three.
            if (is_missing(store.total_kg[i]) || !(store.best3_squat_kg[i] > 0.0f)
                || !(store.best3_bench_kg[i] > 0.0f) || !(store.best3_deadlift_kg[i] > 0.0f)) { continue; }
            cands.push_back({store.name[i], static_cast<std::uint32_t>(i)});
        }

        // Group by name; within a name, highest total first, then earliest date.
        std::sort(cands.begin(), cands.end(), [&store](const Cand& x, const Cand& y) {
            if (x.name != y.name) { return x.name < y.name; }
            if (store.total_kg[x.row] != store.total_kg[y.row]) { return store.total_kg[x.row] > store.total_kg[y.row]; }
            return store.date[x.row] < store.date[y.row];
        });

        std::vector<LifterLine> lines;
        for (std::size_t k = 0; k < cands.size(); ++k) {
            if (k > 0 && cands[k].name == cands[k - 1].name) { continue; }   // first = best
            const std::uint32_t i = cands[k].row;
            if (spec.plausible_only) {
                const float floor = kMinLiftShare * store.total_kg[i];
                if (store.best3_squat_kg[i] < floor || store.best3_bench_kg[i] < floor
                    || store.best3_deadlift_kg[i] < floor) { ++r.hidden; continue; }
            }
            LifterLine l;
            l.row = i;
            l.squat = store.best3_squat_kg[i];
            l.bench = store.best3_bench_kg[i];
            l.deadlift = store.best3_deadlift_kg[i];
            l.total = store.total_kg[i];
            l.bodyweight = store.bodyweight_kg[i];
            l.dots = is_missing(store.dots[i]) ? dots_score(sex, l.bodyweight, l.total) : store.dots[i];
            l.squat_pct    = pct(index, sex, equipment, event, ipf_class, LiftKind::Squat, l.squat);
            l.bench_pct    = pct(index, sex, equipment, event, ipf_class, LiftKind::Bench, l.bench);
            l.deadlift_pct = pct(index, sex, equipment, event, ipf_class, LiftKind::Deadlift, l.deadlift);
            l.total_pct    = pct(index, sex, equipment, event, ipf_class, LiftKind::Total, l.total);
            l.score = score_of(l, spec);
            if (std::isnan(l.score)) { continue; }
            lines.push_back(l);
        }
        r.lifters = lines.size();

        const bool asc = ascending_of(spec);
        const auto better = [asc](double a, double b) { return asc ? a < b : a > b; };

        if (you) {
            LifterLine y;
            y.squat = you->squat; y.bench = you->bench; y.deadlift = you->deadlift;
            y.total = you->squat + you->bench + you->deadlift;
            y.bodyweight = you->bodyweight;
            y.dots = dots_score(sex, y.bodyweight, y.total);
            y.squat_pct    = pct(index, sex, equipment, event, ipf_class, LiftKind::Squat, y.squat);
            y.bench_pct    = pct(index, sex, equipment, event, ipf_class, LiftKind::Bench, y.bench);
            y.deadlift_pct = pct(index, sex, equipment, event, ipf_class, LiftKind::Deadlift, y.deadlift);
            y.total_pct    = pct(index, sex, equipment, event, ipf_class, LiftKind::Total, y.total);
            y.score = score_of(y, spec);
            if (!std::isnan(y.score)) {
                r.has_you = true;
                r.you = y;
                r.you_rank = 1 + static_cast<std::size_t>(std::count_if(lines.begin(), lines.end(),
                    [&](const LifterLine& l) { return better(l.score, y.score); }));
            }
        }

        // Deterministic order: score, then higher total, then name bytes.
        const auto cmp = [&](const LifterLine& x, const LifterLine& y) {
            if (x.score != y.score) { return better(x.score, y.score); }
            if (x.total != y.total) { return x.total > y.total; }
            return store.name_dict.value(store.name[x.row]) < store.name_dict.value(store.name[y.row]);
        };
        const std::size_t k = std::min(limit, lines.size());
        std::partial_sort(lines.begin(), lines.begin() + static_cast<std::ptrdiff_t>(k), lines.end(), cmp);
        lines.resize(k);
        r.top = std::move(lines);
        return r;
    }

    LifterBest lifter_best(const ColumnStore& store, std::uint32_t name_index,
                           Sex sex, Equipment equipment, Event event,
                           std::optional<std::uint8_t> ipf_class) {
        LifterBest r;
        if (name_index == 0) { return r; }
        for (std::size_t i = 0; i < store.size(); ++i) {
            if (store.name[i] != name_index) { continue; }
            if (store.place_code[i] != PlaceCode::Placed || is_missing(store.total_kg[i])) { continue; }
            if (store.sex[i] != sex || store.equipment[i] != equipment || store.event[i] != event) { continue; }
            if (ipf_class && store.ipf_class[i] != *ipf_class) { continue; }
            ++r.results;
            const auto row = static_cast<std::uint32_t>(i);
            if (!r.found || store.total_kg[i] > store.total_kg[r.row]
                || (store.total_kg[i] == store.total_kg[r.row] && store.date[i] < store.date[r.row])) {
                r.row = row;
                r.found = true;
            }
        }
        return r;
    }
}
