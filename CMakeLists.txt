cmake_minimum_required(VERSION 3.16)
project(engine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "" FORCE)
endif()

option(ENGINE_BUILD_TESTS "Build unit tests" ON)
option(ENGINE_BUILD_BENCH "Build benchmarks" ON)

# Whole program must agree on sanitizers → project-wide
add_compile_options($<$<CONFIG:Debug>:-fsanitize=address,undefined>)
add_link_options($<$<CONFIG:Debug>:-fsanitize=address,undefined>)

# Warning flags bundled into one reusable target
add_library(engine_warnings INTERFACE)
target_compile_options(engine_warnings INTERFACE -Wall -Wextra)

add_subdirectory(src)
add_subdirectory(apps)

include(FetchContent)

if(ENGINE_BUILD_TESTS)
    FetchContent_Declare(googletest
            GIT_REPOSITORY https://github.com/google/googletest.git
            GIT_TAG v1.14.0)
    FetchContent_MakeAvailable(googletest)
    enable_testing()
    add_subdirectory(tests)
endif()

if(ENGINE_BUILD_BENCH)
    set(BENCHMARK_ENABLE_TESTING OFF)
    FetchContent_Declare(benchmark
            GIT_REPOSITORY https://github.com/google/benchmark.git
            GIT_TAG v1.8.3)
    FetchContent_MakeAvailable(benchmark)
    add_subdirectory(bench)
endif()