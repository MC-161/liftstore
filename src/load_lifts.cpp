#include "engine/load_lifts.h"

#include <array>
#include <stdexcept>
#include <string>
#include <string_view>

#include "engine/file_buffer.h"
#include "engine/parse.h"

namespace engine {

    std::vector<Lift> load_lifts(const char* path) {
        FileBuffer file(path);

        const char* buf = file.data();
        const char* end = buf + file.size();

        // Row count: used to reserve the vector up front (M1 measured this
        // as -39% load time and -1.23 GB peak memory).
        std::size_t rows = 0;
        for (const char* p = buf; p < end; ++p) {
            if (*p == '\n') {
                ++rows;
            }
        }
        if (file.size() > 0 && *(end - 1) != '\n') {
            ++rows;
        }

        // Header: the first data line starts one byte after the first '\n'.
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

        std::vector<Lift> lifts;
        lifts.reserve(rows - 1);   // minus the header

        std::array<std::string_view, 42> fields;
        const char* p = data_start;
        std::size_t parsed = 0;

        while (p < end) {
            std::size_t count = 0;
            p = split_line(p, end, fields, count);
            ++parsed;

            if (count != 42) {
                throw std::runtime_error("row " + std::to_string(parsed) +
                                         ": expected 42 fields, got " + std::to_string(count));
            }

            lifts.push_back(make_lift(fields));
        }

        return lifts;
    }

}  // namespace engine