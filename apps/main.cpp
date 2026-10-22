#include <array>
#include <cstdio>
#include <cstdlib>
#include <string_view>
#include "engine/parse.h"
#include "engine/file_buffer.h"
#include "engine/query.h"
#include "engine/timing.h"
#include <vector>
#include <chrono>
#include <exception>
#include "engine/column_store.h"
#include "engine/load_lifts.h"
#include "engine/ipf_class.h"
#include "engine/percentile.h"


// static void print_opt(const char* label, std::optional<float> v) {
//     if (v) { std::printf("  %-14s %g\n", label, *v); }
//     else   { std::printf("  %-14s (none)\n", label); }
// }
//
// static void print_lift(const engine::Lift& l) {
//     std::printf("  %-14s %s\n", "name", l.name.c_str());
//     std::printf("  %-14s %d\n", "sex", static_cast<int>(l.sex));             // M=0 F=1 Mx=2
//     std::printf("  %-14s %d\n", "event", static_cast<int>(l.event));         // SBD=0 B=1 D=2 ...
//     std::printf("  %-14s %d\n", "equipment", static_cast<int>(l.equipment)); // Raw=0 ...
//     print_opt("age", l.age);
//     print_opt("bodyweight", l.bodyweight_kg);
//     if (l.weight_class) {
//         std::printf("  %-14s %g%s\n", "weight_class",
//                     l.weight_class->kg, l.weight_class->plus ? "+" : "");
//     } else {
//         std::printf("  %-14s (none)\n", "weight_class");
//     }
//     print_opt("bench1", l.bench1_kg);
//     print_opt("bench2", l.bench2_kg);
//     print_opt("bench3", l.bench3_kg);
//     print_opt("best3_bench", l.best3_bench_kg);
//     print_opt("total", l.total_kg);
//     std::printf("  %-14s code=%d position=%u\n", "place",
//                 static_cast<int>(l.place.code), l.place.position);    // Placed=0 DQ=1 NS=2 G=3 DD=4
//     print_opt("dots", l.dots);
//     std::printf("  %-14s %s\n", "tested", l.tested ? "true" : "false");
//     std::printf("  %-14s %s\n", "federation", l.federation.c_str());
//     std::printf("  %-14s %s\n", "date", l.date.c_str());
//     std::printf("  %-14s %s\n", "meet", l.meet_name.c_str());
//     std::printf("  %-14s %s\n", "sanctioned", l.sanctioned ? "true" : "false");
// }




int main(int argc, char** argv) {
    // if (argc < 2) { std::fprintf(stderr, "usage: engine <csv>\n"); return 1; }
    if (argc < 2) { std::fprintf(stderr, "usage: engine <csv> [aos|soa]\n"); return 1; }

    // No second argument = run both.
    const bool run_aos = (argc < 3) || std::string_view(argv[2]) != "soa";
    const bool run_soa = (argc < 3) || std::string_view(argv[2]) != "aos";
    try {
        if (run_aos) {
            // ---------------- Baseline: array of structs (M1/M2) ----------------
            engine::Timer t;
            std::vector<engine::Lift> lifts = engine::load_lifts(argv[1]);
            std::printf("AoS load   %8.1f ms   (%zu rows)\n", t.ms(), lifts.size());

            std::vector<const engine::Lift*> top;
            for (int run = 0; run < 5; ++run) {
                engine::Timer qt;
                top = engine::top_lifters(lifts, engine::Sex::F, engine::Equipment::Raw,
                                          engine::Event::SBD, 10);
                std::printf("AoS query run %d: %6.1f ms\n", run + 1, qt.ms());
            }

            std::printf("\nAoS top 10:\n");
            for (std::size_t i = 0; i < top.size(); ++i) {
                const engine::Lift* l = top[i];
                std::printf("%2zu. %-28s %7.2f  %s  %s\n", i + 1, l->name.c_str(),
                            *l->total_kg, l->date.c_str(), l->federation.c_str());
            }
        }

        if (run_soa) {
            // ---------------- Columnar ----------------
            engine::Timer t;;
            engine::ColumnStore store = engine::load_columns(argv[1]);
            const double soa_load_ms = t.ms();
            std::printf("\nSoA load   %8.1f ms   (%zu rows)\n", soa_load_ms, store.size());

            std::vector<engine::Ranked> top_soa;
            for (int run = 0; run < 5; ++run) {
                engine::Timer qt;
                top_soa = engine::top_lifters_columnar(store, engine::Sex::F,
                                                       engine::Equipment::Raw,
                                                       engine::Event::SBD, 10);
                std::printf("SoA query run %d: %6.1f ms\n", run + 1, qt.ms());
            }

            std::printf("\nSoA top 10:\n");
            for (std::size_t i = 0; i < top_soa.size(); ++i) {
                const std::uint32_t row = top_soa[i].row;
                std::string_view name = store.name_dict.value(store.name[row]);
                std::printf("%2zu. %-28.*s %7.2f  %u\n", i + 1,
                            static_cast<int>(name.size()), name.data(),
                            store.total_kg[row], store.date[row]);
            }

            std::array<std::size_t, 10> counts{};
            for (std::size_t i = 0; i < store.size(); ++i) {
                const std::uint8_t c = store.ipf_class[i];
                counts[c == engine::kNoIpfClass ? 9 : c]++;
            }
            for (std::size_t i = 0; i < counts.size(); ++i) {
                std::printf("ipf_class %zu: %zu\n", i, counts[i]);
            }

            engine::Timer pt;
            engine::PercentileIndex pct(store);
            std::printf("percentile index: %.1f ms  %zu groups  %zu values  %.1f MB\n",
                        pt.ms(), pct.group_count(), pct.total_values(),
                        pct.bytes() / 1048576.0);

            const auto show = [&](const char* label, float v, std::size_t k) {
                const auto nr = pct.nearest(engine::Sex::F, engine::Equipment::Raw,
                                            engine::Event::SBD, 4,
                                            engine::LiftKind::Total, v, k, store.name);
                std::printf("%-22s found=%d  n=%zu  returned=%zu\n",
                            label, nr.found, nr.n, nr.neighbours.size());
                for (const auto& nb : nr.neighbours) {
                    const auto name = store.name_dict.value(store.name[nb.row]);
                    std::printf("    %8.1f  %.*s\n", nb.value,
                                static_cast<int>(name.size()), name.data());
                }
            };

            show("normal (500)",    500.0f, 5);
            show("below min (0)",     0.0f, 5);
            show("above max (9999)",9999.0f, 5);

            // Women, Raw, full power, 63 kg class (index 4), 500 kg total.
            engine::Timer qt;
            engine::PercentileResult r = pct.percentile_of(
                engine::Sex::F, engine::Equipment::Raw, engine::Event::SBD, 4,engine::LiftKind::Total , 500.0f);
            const double q_us = qt.ms() * 1000.0;
            engine::DistributionResult dr = pct.distribution(engine::Sex::F, engine::Equipment::Raw, engine::Event::SBD, 4, engine::LiftKind::Total);

            if (r.found) {
                std::printf("500.0 kg, F Raw SBD 63kg: %.2f%%  (%zu below, n=%zu)  %.1f us\n",
                            r.percentile, r.below, r.n, q_us);
            if(dr.found) {
                std::printf("F Raw SBD 63kg  distribution: n=%zu  mean=%.3f  sd=%.4f\n",dr.n, dr.mean, dr.sd);
            }
            } else {
                std::printf("no data for that group\n");
            }

            const auto q2 = engine::conditional_percentile(
    store, engine::Sex::F, engine::Equipment::Raw, engine::Event::SBD,
    engine::LiftKind::Squat, 300.0f,
    engine::LiftKind::Bench, 150.0f);
            std::printf("Q2  M/Raw/SBD  squat 210 +/-%.1f -> bench 140: %.2f%%  (below %zu, n %zu)\n",
                        q2.tol_used, q2.percentile, q2.below, q2.n);
            }




        return 0;
    }
    catch(const std::exception& e){
        std::fprintf(stderr, "error: %s\n", e.what());
        return 1;
    }


}



