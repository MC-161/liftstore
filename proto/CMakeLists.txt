set(GEN_DIR ${CMAKE_CURRENT_BINARY_DIR}/gen)
set(PROTO_DIR ${CMAKE_CURRENT_SOURCE_DIR})

# Locate Homebrew grpc_cpp_plugin
find_program(GRPC_CPP_PLUGIN_EXECUTABLE
        NAMES grpc_cpp_plugin
        HINTS /opt/homebrew/bin /usr/local/bin
)

if(NOT GRPC_CPP_PLUGIN_EXECUTABLE)
    message(FATAL_ERROR "Could not find grpc_cpp_plugin at /opt/homebrew/bin/grpc_cpp_plugin")
endif()

file(MAKE_DIRECTORY ${GEN_DIR})
add_custom_command(
        OUTPUT
        ${GEN_DIR}/engine.pb.cc
        ${GEN_DIR}/engine.pb.h
        ${GEN_DIR}/engine.grpc.pb.cc
        ${GEN_DIR}/engine.grpc.pb.h
        COMMAND ${CMAKE_COMMAND} -E make_directory ${GEN_DIR}
        COMMAND protobuf::protoc --proto_path=${PROTO_DIR} --cpp_out=${GEN_DIR} ${PROTO_DIR}/engine.proto
        COMMAND protobuf::protoc --proto_path=${PROTO_DIR} --grpc_out=${GEN_DIR}
        "--plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN_EXECUTABLE}" ${PROTO_DIR}/engine.proto
        DEPENDS ${PROTO_DIR}/engine.proto protobuf::protoc
        COMMENT "Generating protobuf + gRPC code from engine.proto"
        VERBATIM
)

add_library(engine_proto STATIC
        ${GEN_DIR}/engine.pb.cc
        ${GEN_DIR}/engine.grpc.pb.cc
)



target_include_directories(engine_proto PUBLIC ${GEN_DIR})
target_link_libraries(engine_proto PUBLIC protobuf::libprotobuf gRPC::grpc++)