// Four benchmarks, each answering a question the docs currently answer with
// a prediction or a one-off Timer:
//
//   1. Filter: inline vs gather     -- settles build spec 1.3
//   2. Top lifters: AoS vs SoA      -- the headline, under a real harness
//   3. Percentile: index vs scan    -- what the 98 MiB index buys
//   4. Conditional percentile       -- the hero query, which has no index
//
// Every benchmark runs over the full dataset, loaded once. Release only:
//
//   cmake --build build-release --target engine_bench
//   ./build-release/bench/engine_bench --benchmark_min_time=1s
//
// ENGINE_BENCH_CSV overrides the dataset path (e.g. data/dev.csv for a
// quick run). Results go in docs/benchmarks.md, not in comments here.

#include <benchmark/benchmark.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <unordered_set>
#include <vector>

#include "engine/column_store.h"
#include "engine/ipf_class.h"
#include "engine/load_lifts.h"
#include "engine/percentile.h"
#include "engine/query.h"

namespace {

const char* dataset_path() {
    const char* env = std::getenv("ENGINE_BENCH_CSV");
    return env != nullptr ? env : ENGINE_SOURCE_DIR "/data/openpowerlifting-2026-09-12-64bfe49f.csv";
}

// Function-local statics: loaded on first use, so a --benchmark_filter that
// skips the AoS benchmarks never pays its 3 GB.
const engine::ColumnStore& store() {
    static const engine::ColumnStore s = engine::load_columns(dataset_path());
    return s;
}

const std::vector<engine::Lift>& lifts() {
    static const std::vector<engine::Lift> l = engine::load_lifts(dataset_path());
    return l;
}

const engine::PercentileIndex& index() {
    static const engine::PercentileIndex ix(store());
    return ix;
}

// Three groups spanning the selectivity range, as benchmark Args.
struct Group { engine::Sex sex; engine::Equipment equipment; engine::Event event; const char* label; };
constexpr Group kGroups[] = {
    {engine::Sex::M, engine::Equipment::Raw,      engine::Event::SBD, "M/Raw/SBD"},       // 750,556 matches, 18.6% of rows
    {engine::Sex::F, engine::Equipment::Raw,      engine::Event::SBD, "F/Raw/SBD"},       // 375,568, 9.3%
    {engine::Sex::F, engine::Equipment::MultiPly, engine::Event::SBD, "F/MultiPly/SBD"},  // 7,476, 0.19%
};

const Group& group(const benchmark::State& state) {
    return kGroups[static_cast<std::size_t>(state.range(0))];
}

// The exact predicate top_lifters_columnar uses. Key passed BY VALUE, as the
// engine's parameters are: read through a `const Group&`, every store in the
// loop body could alias it, so the compiler reloads all three fields per row
// -- a harness artifact that would be charged to Inline. (Measured: no
// difference here, but the engine's code takes them by value, so this does.)
struct Key { engine::Sex sex; engine::Equipment equipment; engine::Event event; };

Key key_of(const benchmark::State& state) {
    const Group& g = group(state);
    return {g.sex, g.equipment, g.event};
}

inline bool matches(const engine::ColumnStore& s, std::size_t i, Key k) {
    return s.sex[i] == k.sex && s.equipment[i] == k.equipment && s.event[i] == k.event &&
           s.place_code[i] == engine::PlaceCode::Placed && !engine::is_missing(s.total_kg[i]);
}

void set_counters(benchmark::State& state, std::size_t rows, std::size_t hits) {
    state.SetLabel(group(state).label);
    state.counters["matches"] = static_cast<double>(hits);
    state.counters["rows/s"] = benchmark::Counter(static_cast<double>(rows),
                                                  benchmark::Counter::kIsIterationInvariantRate);
}

// =====================================================================
// 1. Filter: inline vs gather (build spec 1.3)
//
// Inline: one pass; the predicate and the total read share a loop, and each
//         hit is appended straight away. This is what the engine ships.
// Gather: pass 1 writes matching row indexes to a selection vector,
//         branch-free (sel[k] = i; k += hit); pass 2 gathers the totals.
//         The vectorised-engine shape (DuckDB, Velox).
// InlineBranchless: inline's single pass with gather's branch-free write --
//         without it, "inline vs gather" would conflate the pass structure
//         with branch prediction.
//
// All three produce the same vector<Ranked>; the sort that follows is
// identical, so it is left out.
// =====================================================================

void BM_Filter_Inline(benchmark::State& state) {
    const auto& s = store();
    const Key k = key_of(state);
    const std::size_t n = s.size();
    std::vector<engine::Ranked> out;
    out.reserve(n / 10);                         // as the engine does
    for (auto _ : state) {
        out.clear();
        for (std::size_t i = 0; i < n; ++i) {
            if (matches(s, i, k)) {
                out.push_back({static_cast<std::uint32_t>(i), s.total_kg[i]});
            }
        }
        benchmark::DoNotOptimize(out.data());
        benchmark::ClobberMemory();
    }
    set_counters(state, n, out.size());
}

void BM_Filter_InlineBranchless(benchmark::State& state) {
    const auto& s = store();
    const Key k = key_of(state);
    const std::size_t n = s.size();
    std::vector<engine::Ranked> out(n);          // worst case: every row matches
    std::size_t hits = 0;
    for (auto _ : state) {
        hits = 0;
        for (std::size_t i = 0; i < n; ++i) {
            out[hits] = {static_cast<std::uint32_t>(i), s.total_kg[i]};
            hits += matches(s, i, k) ? 1 : 0;
        }
        benchmark::DoNotOptimize(out.data());
        benchmark::ClobberMemory();
    }
    set_counters(state, n, hits);
}

void BM_Filter_Gather(benchmark::State& state) {
    const auto& s = store();
    const Key k = key_of(state);
    const std::size_t n = s.size();
    std::vector<std::uint32_t> sel(n);
    std::vector<engine::Ranked> out(n);
    std::size_t hits = 0;
    for (auto _ : state) {
        hits = 0;
        for (std::size_t i = 0; i < n; ++i) {
            sel[hits] = static_cast<std::uint32_t>(i);
            hits += matches(s, i, k) ? 1 : 0;
        }
        for (std::size_t j = 0; j < hits; ++j) {
            out[j] = {sel[j], s.total_kg[sel[j]]};
        }
        benchmark::DoNotOptimize(out.data());
        benchmark::ClobberMemory();
    }
    set_counters(state, n, hits);
}

BENCHMARK(BM_Filter_Inline)->DenseRange(0, 2)->Unit(benchmark::kMillisecond);
BENCHMARK(BM_Filter_InlineBranchless)->DenseRange(0, 2)->Unit(benchmark::kMillisecond);
BENCHMARK(BM_Filter_Gather)->DenseRange(0, 2)->Unit(benchmark::kMillisecond);

// =====================================================================
// 2. Top lifters, end to end: row-oriented vs columnar.
//
// Same query, same answer (top 10, one per lifter). AoS is the M1 baseline,
// which full-sorts; SoA is the shipped partial_sort version. FullSort is SoA's
// filter with AoS's sort -- the attribution step between them, since the
// layout and the algorithm both changed at once.
// =====================================================================

void BM_TopLifters_AoS(benchmark::State& state) {
    const auto& l = lifts();
    const Group& g = group(state);
    std::size_t got = 0;
    for (auto _ : state) {
        const auto top = engine::top_lifters(l, g.sex, g.equipment, g.event, 10);
        got = top.size();
        benchmark::DoNotOptimize(top.data());
    }
    set_counters(state, l.size(), got);
}

void BM_TopLifters_SoA_FullSort(benchmark::State& state) {
    const auto& s = store();
    const Key k = key_of(state);
    const std::size_t n = s.size();
    std::vector<engine::Ranked> m;
    m.reserve(n / 10);
    const auto cmp = [&s](const engine::Ranked& a, const engine::Ranked& b) {
        if (a.total != b.total) { return a.total > b.total; }
        const auto na = s.name_dict.value(s.name[a.row]);
        const auto nb = s.name_dict.value(s.name[b.row]);
        if (na != nb) { return na < nb; }
        return s.date[a.row] < s.date[b.row];
    };
    for (auto _ : state) {
        m.clear();
        for (std::size_t i = 0; i < n; ++i) {
            if (matches(s, i, k)) { m.push_back({static_cast<std::uint32_t>(i), s.total_kg[i]}); }
        }
        std::sort(m.begin(), m.end(), cmp);
        benchmark::DoNotOptimize(m.data());
    }
    set_counters(state, n, m.size());
}

void BM_TopLifters_SoA(benchmark::State& state) {
    const auto& s = store();
    const Group& g = group(state);
    std::size_t got = 0;
    for (auto _ : state) {
        const auto top = engine::top_lifters_columnar(s, g.sex, g.equipment, g.event, 10);
        got = top.size();
        benchmark::DoNotOptimize(top.data());
    }
    set_counters(state, s.size(), got);
}

// The shipped function with ONLY its filter swapped for gather: the same
// reserve, partial_sort, doubling retry and dedupe, copied from
// top_lifters_columnar. This, not the isolated filter loops above, is the
// number that decides 1.3 -- the isolated Inline loop runs slower than the
// shipped function does end to end, so the filter-only gap overstates it.
//
// chunk == 0: one selection vector over the whole table (16 MB per call).
// chunk > 0:  a fixed stack buffer of that many rows, refilled per chunk --
//             the vectorised-engine shape, with no per-request allocation
//             beyond the engine's own n_rows/10 reserve.
std::vector<engine::Ranked> top_lifters_gather(const engine::ColumnStore& s, Key key,
                                               std::size_t n, std::size_t chunk) {
    const std::size_t n_rows = s.size();
    std::vector<engine::Ranked> m;
    if (chunk == 0) {
        std::vector<std::uint32_t> sel(n_rows);
        std::size_t hits = 0;
        for (std::size_t i = 0; i < n_rows; ++i) {
            sel[hits] = static_cast<std::uint32_t>(i);
            hits += matches(s, i, key) ? 1 : 0;
        }
        m.reserve(hits);
        for (std::size_t j = 0; j < hits; ++j) { m.push_back({sel[j], s.total_kg[sel[j]]}); }
    } else {
        constexpr std::size_t kMaxChunk = 8192;
        std::uint32_t sel[kMaxChunk];
        m.reserve(n_rows / 10);
        for (std::size_t base = 0; base < n_rows; base += chunk) {
            const std::size_t end = std::min(base + chunk, n_rows);
            std::size_t hits = 0;
            for (std::size_t i = base; i < end; ++i) {
                sel[hits] = static_cast<std::uint32_t>(i);
                hits += matches(s, i, key) ? 1 : 0;
            }
            for (std::size_t j = 0; j < hits; ++j) { m.push_back({sel[j], s.total_kg[sel[j]]}); }
        }
    }

    const auto cmp = [&s](const engine::Ranked& a, const engine::Ranked& b) {
        if (a.total != b.total) { return a.total > b.total; }
        const auto na = s.name_dict.value(s.name[a.row]);
        const auto nb = s.name_dict.value(s.name[b.row]);
        if (na != nb) { return na < nb; }
        return s.date[a.row] < s.date[b.row];
    };
    std::vector<engine::Ranked> result;
    std::unordered_set<std::uint32_t> seen;
    std::size_t k = std::min<std::size_t>(200, m.size());
    while (true) {
        result.clear();
        seen.clear();
        std::partial_sort(m.begin(), m.begin() + static_cast<std::ptrdiff_t>(k), m.end(), cmp);
        for (std::size_t i = 0; i < k; ++i) {
            if (seen.insert(s.name[m[i].row]).second) {
                result.push_back(m[i]);
                if (result.size() == n) { break; }
            }
        }
        if (result.size() == n || k == m.size()) { break; }
        k = std::min(k * 2, m.size());
    }
    return result;
}

void BM_TopLifters_SoA_Gather(benchmark::State& state) {
    const auto& s = store();
    const Key k = key_of(state);
    const auto chunk = static_cast<std::size_t>(state.range(1));
    std::size_t got = 0;
    for (auto _ : state) {
        auto top = top_lifters_gather(s, k, 10, chunk);
        got = top.size();
        benchmark::DoNotOptimize(top.data());
    }
    set_counters(state, s.size(), got);
}

BENCHMARK(BM_TopLifters_AoS)->DenseRange(0, 2)->Unit(benchmark::kMillisecond);
BENCHMARK(BM_TopLifters_SoA_FullSort)->DenseRange(0, 2)->Unit(benchmark::kMillisecond);
BENCHMARK(BM_TopLifters_SoA)->DenseRange(0, 2)->Unit(benchmark::kMillisecond);
BENCHMARK(BM_TopLifters_SoA_Gather)
    ->ArgsProduct({{0, 1, 2}, {0, 1024, 2048, 8192}})
    ->ArgNames({"group", "chunk"})
    ->Unit(benchmark::kMillisecond);

// =====================================================================
// 3. Percentile: precomputed index vs scanning for it.
//
// F/Raw/SBD 63 kg (class 4), total 500 -- the README's example. Scan is
// what a percentile costs without the index: filter the group, count below.
// =====================================================================

constexpr std::uint8_t kClass63 = 4;

void BM_Percentile_Index(benchmark::State& state) {
    const auto& ix = index();
    std::size_t n = 0;
    for (auto _ : state) {
        auto r = ix.percentile_of(engine::Sex::F, engine::Equipment::Raw, engine::Event::SBD,
                                        kClass63, engine::LiftKind::Total, 500.0f);
        n = r.n;
        benchmark::DoNotOptimize(r);
    }
    state.counters["n"] = static_cast<double>(n);
}

void BM_Percentile_Scan(benchmark::State& state) {
    const auto& s = store();
    std::size_t n = 0;
    for (auto _ : state) {
        std::size_t below = 0;
        n = 0;
        for (std::size_t i = 0; i < s.size(); ++i) {
            if (s.sex[i] != engine::Sex::F || s.equipment[i] != engine::Equipment::Raw ||
                s.event[i] != engine::Event::SBD || s.place_code[i] != engine::PlaceCode::Placed ||
                s.ipf_class[i] != kClass63) { continue; }
            const float v = s.total_kg[i];
            if (engine::is_missing(v)) { continue; }
            ++n;
            below += (v < 500.0f) ? 1 : 0;
        }
        benchmark::DoNotOptimize(below);
    }
    state.counters["n"] = static_cast<double>(n);
}

BENCHMARK(BM_Percentile_Index);
BENCHMARK(BM_Percentile_Scan)->Unit(benchmark::kMillisecond);

// =====================================================================
// 4. Conditional percentile -- the hero query.
//
// "Among men who squat 210 (+/-2.5), where does a 140 bench sit?" The
// condition is a runtime range on another column, so nothing precomputes
// it: this is a full scan every time. Second case forces the widening
// branch (n = 5 < min_n, so it scans twice).
// =====================================================================

void BM_ConditionalPercentile(benchmark::State& state) {
    const auto& s = store();
    const bool widen = state.range(0) == 1;
    const auto sex = widen ? engine::Sex::F : engine::Sex::M;
    const float squat = widen ? 300.0f : 210.0f;
    const float bench = widen ? 150.0f : 140.0f;
    std::size_t n = 0;
    for (auto _ : state) {
        auto r = engine::conditional_percentile(s, sex, engine::Equipment::Raw,
                                                      engine::Event::SBD,
                                                      engine::LiftKind::Squat, squat,
                                                      engine::LiftKind::Bench, bench);
        n = r.n;
        benchmark::DoNotOptimize(r);
    }
    state.SetLabel(widen ? "F squat 300 -> bench 150 (widens, 2 scans)"
                         : "M squat 210 -> bench 140");
    state.counters["n"] = static_cast<double>(n);
}

BENCHMARK(BM_ConditionalPercentile)->Arg(0)->Arg(1)->Unit(benchmark::kMillisecond);

}  // namespace
