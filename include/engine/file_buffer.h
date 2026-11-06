#pragma once
#include <cstddef>

namespace engine {

    class FileBuffer {
    public:
        explicit FileBuffer(const char* path);   // opens, reads whole file
        ~FileBuffer();                           // frees the buffer

        // No copying
        FileBuffer(const FileBuffer&) = delete;
        FileBuffer& operator=(const FileBuffer&) = delete;

        [[nodiscard]] const char* data() const { return data_; }
        [[nodiscard]] std::size_t size() const { return size_; }

    private:
        char* data_ = nullptr;
        std::size_t size_ = 0;
    };

}