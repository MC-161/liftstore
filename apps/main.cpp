#include <array>
#include <cstdio>
#include <cstdlib>
#include <string_view>
#include <engine/parse.h>
#include <optional>

static void print_opt(const char* label, std::optional<float> v) {
    if (v) { std::printf("  %-14s %g\n", label, *v); }
    else   { std::printf("  %-14s (none)\n", label); }
}

static void print_lift(const engine::Lift& l) {
    std::printf("  %-14s %s\n", "name", l.name.c_str());
    std::printf("  %-14s %d\n", "sex", static_cast<int>(l.sex));             // M=0 F=1 Mx=2
    std::printf("  %-14s %d\n", "event", static_cast<int>(l.event));         // SBD=0 B=1 D=2 ...
    std::printf("  %-14s %d\n", "equipment", static_cast<int>(l.equipment)); // Raw=0 ...
    print_opt("age", l.age);
    print_opt("bodyweight", l.bodyweight_kg);
    if (l.weight_class) {
        std::printf("  %-14s %g%s\n", "weight_class",
                    l.weight_class->kg, l.weight_class->plus ? "+" : "");
    } else {
        std::printf("  %-14s (none)\n", "weight_class");
    }
    print_opt("bench1", l.bench1_kg);
    print_opt("bench2", l.bench2_kg);
    print_opt("bench3", l.bench3_kg);
    print_opt("best3_bench", l.best3_bench_kg);
    print_opt("total", l.total_kg);
    std::printf("  %-14s code=%d position=%u\n", "place",
                static_cast<int>(l.place.code), l.place.position);    // Placed=0 DQ=1 NS=2 G=3 DD=4
    print_opt("dots", l.dots);
    std::printf("  %-14s %s\n", "tested", l.tested ? "true" : "false");
    std::printf("  %-14s %s\n", "federation", l.federation.c_str());
    std::printf("  %-14s %s\n", "date", l.date.c_str());
    std::printf("  %-14s %s\n", "meet", l.meet_name.c_str());
    std::printf("  %-14s %s\n", "sanctioned", l.sanctioned ? "true" : "false");
}


int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: engine <csv>\n"); return 1; }

    std::FILE* f = std::fopen(argv[1], "rb");
    if (!f) { std::perror("fopen"); return 1; }

    std::fseek(f, 0, SEEK_END);
    long size = std::ftell(f);
    if (size < 0) { std::perror("ftell"); std::fclose(f); return 1; }
    std::fseek(f, 0, SEEK_SET);

    char* buf = new char[size];
    size_t got = std::fread(buf, 1, size, f);
    std::fclose(f);
    if (got != static_cast<size_t>(size)) {
        std::fprintf(stderr, "short read: got %zu of %ld bytes\n", got, size);
        delete[] buf;
        return 1;
    }

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
        delete[] buf;
        return 1;
    }


    // 2. Split that data line into fields.
    std::array<std::string_view, 42> fields;
    const char* p = data_start;
    long parsed = 0;


    while (p < end) {
        std::size_t count = 0;
        p = engine::split_line(p, end, fields, count);
        ++parsed;

        if (count != 42) {
            std::fprintf(stderr, "row %ld: expected 42 fields, got %zu\n", parsed, count);
            delete[] buf;
            return 1;
        }

        engine::Lift lift = engine::make_lift(fields);
        (void)lift;   // not stored yet; just proving every row parses
    }
    std::printf("parsed %ld rows\n", parsed);

    delete[] buf;
    return 0;
}


