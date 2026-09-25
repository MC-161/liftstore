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
    if (argc < 2) { std::fprintf(stderr, "usage: engine <csv>\n"); return 1; }
    std::printf("sizeof(Lift) = %zu bytes\n", sizeof(engine::Lift));
    try {
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


        // ---------------- Columnar ----------------
        t.reset();
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


        return 0;
    }
    catch(const std::exception& e){
        std::fprintf(stderr, "error: %s\n", e.what());
        return 1;
    }


};


