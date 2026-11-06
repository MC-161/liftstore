add_executable(engine_bench bench_main.cpp)
target_link_libraries(engine_bench PRIVATE engine_core engine_warnings benchmark::benchmark_main)

# Same reason as the tests: the binary runs from the build tree.
target_compile_definitions(engine_bench PRIVATE ENGINE_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
