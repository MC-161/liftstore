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
        engine::Timer t;
        engine::FileBuffer file(argv[1]);
        double io_ms = t.ms();

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


        // Splitting  only
        t.reset();
        {
            std::array<std::string_view, 42> f;
            const char* q = data_start;
            std::size_t sink = 0;
            while (q < end) {
                std::size_t count = 0;
                q = engine::split_line(q, end, f, count);
                sink += f[0].size();
            }
            engine::keep(sink);
        }
        double split_ms = t.ms();

        // splitting + make_lift, not stored
        t.reset();
        {
            std::array<std::string_view, 42> f;
            const char* q = data_start;
            unsigned long sink = 0;
            while (q < end) {
                std::size_t count = 0;
                q = engine::split_line(q, end, f, count);
                engine::Lift lift = engine::make_lift(f);
                sink += lift.place.position + lift.name.size();
            }
            engine::keep(sink);
        }
        double build_ms = t.ms();

        // C2: split + numbers/enums only (no strings)
        t.reset();
        {
            std::array<std::string_view, 42> f;
            const char* q = data_start;
            unsigned long sink = 0;
            while (q < end) {
                std::size_t count = 0;
                q = engine::split_line(q, end, f, count);
                engine::Lift lift = engine::make_lift_numbers_only(f);
                sink += lift.place.position;
            }
            engine::keep(sink);
        }
        double numbers_ms = t.ms();

        t.reset();
        // real load
        // Split that data line into fields.
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
        double load_ms = t.ms();


        std::printf("parsed %ld rows\n", parsed);
        std::printf("stored %zu lifts\n", lifts.size());
        std::printf("A io           %8.1f ms\n", io_ms);
        std::printf("B split        %8.1f ms\n", split_ms);
        std::printf("C split+build  %8.1f ms\n", build_ms);
        std::printf("C2 split+build  %8.1f ms\n", numbers_ms);
        std::printf("D full load    %8.1f ms\n", load_ms);


        // Query

        std::vector<const engine::Lift*> top;
        for (int run = 0; run < 5; ++run) {
            engine::Timer qt;
            top = engine::top_lifters(lifts, engine::Sex::F, engine::Equipment::Raw,
                                      engine::Event::SBD, 10);
            std::printf("query run %d: %.1f ms\n", run + 1, qt.ms());

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


