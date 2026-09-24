#pragma once

#include <chrono>
#include <cstdio>

namespace engine {

    // Measures elapsed wall-clock time. steady_clock is monotonic: it only moves
    // forward at a constant rate, unlike system_clock (which can jump when the
    // system clock is adjusted) or clock() (which measures CPU time).
    class Timer {
    public:
        Timer() : start_(Clock::now()) {}

        void reset() { start_ = Clock::now(); }

        // Elapsed milliseconds since construction or the last reset().
        double ms() const {
            std::chrono::duration<double, std::milli> d = Clock::now() - start_;
            return d.count();
        }

    private:
        using Clock = std::chrono::steady_clock;
        Clock::time_point start_;
    };

    // RAII timer: prints its label and elapsed time when it goes out of scope.
    // Useful for timing a block without adding start/stop lines:
    //
    //     {
    //         ScopedTimer t("parse");
    //         ... work ...
    //     }                         // prints "parse: 123.4 ms" here
    //
    class ScopedTimer {
    public:
        explicit ScopedTimer(const char* label) : label_(label) {}

        ~ScopedTimer() {
            std::fprintf(stderr, "%-24s %8.1f ms\n", label_, timer_.ms());
        }

        ScopedTimer(const ScopedTimer&) = delete;
        ScopedTimer& operator=(const ScopedTimer&) = delete;

    private:
        const char* label_;
        Timer timer_;
    };

    // Stops the optimiser from deleting work whose result is never used.
    // Tells the compiler "something outside my control may read this", so the
    // value must actually be computed. (Google Benchmark's DoNotOptimize does
    // the same thing.)
    template <typename T>
    inline void keep(const T& value) {
        asm volatile("" : : "r,m"(value) : "memory");
    }

}  // namespace engine