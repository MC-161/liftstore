#include <benchmark/benchmark.h>
#include "engine/engine.h"

static void BM_Add(benchmark::State& state) {
    for (auto _ : state) {
        benchmark::DoNotOptimize(engine::add(2, 3));
    }
}
BENCHMARK(BM_Add);