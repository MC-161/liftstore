#include <array>
#include <cstdio>
#include <cstdlib>
#include <string_view>
#include "engine/parse.h"
#include "engine/file_buffer.h"
#include "engine/query.h"
#include <vector>
#include <chrono>
#include <exception>

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
        auto t0 = std::chrono::steady_clock::now();
        engine::FileBuffer file(argv[1]);
        const char* buf = file.data();
        long size = static_cast<long>(file.size());

        long rows = 0;
        const char* end = buf + size;

        for (const char* p = buf; p < end; ++p) {
            if (*p == '\n') {
                ++rows;
            }
        }

        if (size > 0 && buf[size - 1] != '\n') {
            ++rows;
        }

        std::printf("%ld rows\n", rows);

        //    The first data line starts one byte after it.
        const char* data_start = nullptr;
        for (const char* p = buf; p < end; ++p) {
            if (*p == '\n') {
                data_start = p + 1;
                break;
            }
        }
        if (data_start == nullptr || data_start >= end) {
            std::fprintf(stderr, "no data line after header\n");
            return 1;
        }


        // 2. Split that data line into fields.
        std::array<std::string_view, 42> fields;
        std::vector<engine::Lift> lifts;
        lifts.reserve(static_cast<std::size_t>(rows - 1));
        const char* p = data_start;
        long parsed = 0;


        while (p < end) {
            std::size_t count = 0;
            p = engine::split_line(p, end, fields, count);
            ++parsed;

            if (count != 42) {
                std::fprintf(stderr, "row %ld: expected 42 fields, got %zu\n", parsed, count);
                return 1;
            }

            lifts.push_back(engine::make_lift(fields));
        }
        std::printf("parsed %ld rows\n", parsed);
        std::printf("stored %zu lifts\n", lifts.size());

        auto t1 = std::chrono::steady_clock::now();
        double load_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        std::printf("load: %.1f ms\n", load_ms);

        std::vector<const engine::Lift*> top;
        for (int run = 0; run < 5; ++run) {
            auto q0 = std::chrono::steady_clock::now();
            top = engine::top_lifters(lifts, engine::Sex::F, engine::Equipment::Raw,
                                      engine::Event::SBD, 10);
            auto q1 = std::chrono::steady_clock::now();
            std::chrono::duration<double, std::milli> q = q1 - q0;
            std::printf("query run %d: %.1f ms\n", run + 1, q.count());
        }

        for (std::size_t i = 0; i < top.size(); ++i) {
            const engine::Lift* l = top[i];
            std::printf("%2zu. %-28s %7.1f  %s  %s  %s\n", i + 1, l->name.c_str(),
                        *l->total_kg, l->date.c_str(), l->federation.c_str(),
                        l->meet_name.c_str());
        }

        return 0;
    }
    catch(const std::exception& e){
        std::fprintf(stderr, "error: %s\n", e.what());
        return 1;
    }


}


