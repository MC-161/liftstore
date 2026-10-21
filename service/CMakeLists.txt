add_library(service STATIC service.cpp)

target_link_libraries(service
        PUBLIC  engine_core engine_proto
        PRIVATE engine_warnings)
