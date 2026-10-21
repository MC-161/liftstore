add_executable(engine_tests
        test_engine.cpp
        conditional_percentile_test.cpp
        conditional_percentile_test.cpp)

target_link_libraries(engine_tests PRIVATE engine_core engine_warnings GTest::gtest_main)

# Tests run from the build directory, so a relative "data/..." path would not
# resolve. Hand the test the source tree root at compile time instead.
target_compile_definitions(engine_tests PRIVATE ENGINE_SOURCE_DIR="${CMAKE_SOURCE_DIR}")

include(GoogleTest)
gtest_discover_tests(engine_tests)