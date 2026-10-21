add_executable(engine main.cpp)
target_link_libraries(engine PRIVATE engine_core engine_warnings)

add_executable(engine_server server.cpp)
target_link_libraries(engine_server PRIVATE service engine_warnings)
