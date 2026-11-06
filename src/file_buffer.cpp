#include "engine/file_buffer.h"
#include <cstdio>
#include <cstdlib>
#include <string_view>
#include <engine/parse.h>
#include <optional>
#include <stdexcept>
#include <string>

namespace engine {

    FileBuffer::FileBuffer(const char* path) {
        std::FILE* f = std::fopen(path, "rb");
        if (!f) { throw std::runtime_error(std::string("cannot open: ") + path); }

        std::fseek(f, 0, SEEK_END);
        long size = std::ftell(f);
        if (size < 0) { std::fclose(f); throw std::runtime_error(std::string("cannot get size: ") + path); }
        std::fseek(f, 0, SEEK_SET);


        // size >= 0 was checked above, so this cast cannot wrap.
        const auto usize = static_cast<std::size_t>(size);
        char* buf = new char[usize];
        size_t got = std::fread(buf, 1, usize, f);
        std::fclose(f);
        if (got != usize) {
            delete[] buf;
            throw std::runtime_error("short read: got " + std::to_string(got) + " of " +
                                     std::to_string(usize) + " bytes: " + path);
        }

        data_ = buf;
        size_ = usize;
    }

    FileBuffer::~FileBuffer() {
        delete[] data_;
    }
}



