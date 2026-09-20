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


        char* buf = new char[size];
        size_t got = std::fread(buf, 1, size, f);
        std::fclose(f);
        if (got != static_cast<size_t>(size)) {
            delete[] buf;
            throw std::runtime_error(std::string("short read: got %zu of %ld bytes ") + path);
        }

        data_ = buf;
        size_ = size;
    }

    FileBuffer::~FileBuffer() {
        delete[] data_;
    }
}



