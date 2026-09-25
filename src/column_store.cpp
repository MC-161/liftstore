#include "engine/column_store.h"
#include <cstdio>
#include "engine/file_buffer.h"
#include "engine/parse.h"
#include <array>
#include <stdexcept>
#include <string>
namespace engine {


    ColumnStore load_columns(const char* path) {
        FileBuffer file(path);
        ColumnStore store;

        // ROW COUNT
        const char* buf = file.data();
        long size = static_cast<long>(file.size());


        std::size_t rows = 0;
        const char* end = buf + size;
        for (const char* p = buf; p < end; ++p) {
            if (*p == '\n') {
                ++rows;
            }
        }

        if (size > 0 && buf[size - 1] != '\n') {
            ++rows;
        }




        // SKIP HEADER
        // The first data line starts one byte after it.
        const char* data_start = nullptr;
        for (const char* p = buf; p < end; ++p) {
            if (*p == '\n') {
                data_start = p + 1;
                break;
            }
        }
        if (data_start == nullptr || data_start >= end) {
            throw std::runtime_error("no data line after header");
        }


        store.reserve(rows - 1);

        // REAL LOAD
        // Split that data line into fields.
        std::array<std::string_view, 42> fields;
        const char* p = data_start;
        long parsed = 0;



        while (p < end) {
            std::size_t count = 0;
            p = split_line(p, end, fields, count);
            ++parsed;

            if (count != 42) {
                throw std::runtime_error("row " + std::to_string(parsed) +
                                         ": expected 42 fields, got " + std::to_string(count));
            }

            store.name.push_back(store.name_dict.intern(fields[0]));
            store.sex.push_back(parse_sex(fields[1]));
            store.event.push_back(parse_event(fields[2]));
            store.equipment.push_back(parse_equipment(fields[3]));
            store.total_kg.push_back(parse_float_or_missing(fields[25]));
            Place place = parse_place(fields[26]);
            store.place_code.push_back(place.code);
            store.place_position.push_back(place.position);
            store.date.push_back(parse_date(fields[36]));

        }

        store.name_dict.done_loading();   // keys point into the file buffer, which dies now
        if (!store.check_invariant()) {
            throw std::runtime_error("columns out of sync after load");
        }

        return store;
    }

    void ColumnStore::reserve(std::size_t n) {
        name.reserve(n);
        sex.reserve(n);
        event.reserve(n);
        equipment.reserve(n);
        total_kg.reserve(n);
        place_code.reserve(n);
        place_position.reserve(n);
        date.reserve(n);
    }

    bool ColumnStore::check_invariant() const {
        const std::size_t n = total_kg.size();
        for (std::size_t s : {name.size(), sex.size(), event.size(), equipment.size(),
                              place_code.size(), place_position.size(), date.size(),
                              /* ... */}) {
            if (s != n) { return false; }
                              }
        return true;
    }

    static_assert(std::is_nothrow_move_constructible_v<ColumnStore>);
    static_assert(!std::is_copy_constructible_v<ColumnStore>);


}