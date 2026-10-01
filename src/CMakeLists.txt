add_library(engine_core engine.cpp parse.cpp file_buffer.cpp query.cpp
        column_store.cpp
        load_lifts.cpp
        ipf_class.cpp
        percentile.cpp)
target_include_directories(engine_core PUBLIC ${PROJECT_SOURCE_DIR}/include)
target_link_libraries(engine_core PRIVATE engine_warnings)