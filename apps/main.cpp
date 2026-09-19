#include <cstdio>
#include <cstdlib>

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
    delete[] buf;
    return 0;
}