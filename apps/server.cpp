#include <cstdio>
#include <memory>
#include <string>

#include <grpcpp/grpcpp.h>

#include "engine/service.h"
#include "engine/timing.h"

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s <csv> [addr]\n", argv[0]);
        return 1;
    }
    const std::string addr = (argc > 2) ? argv[2] : "0.0.0.0:50051";

    // ===== DECLARATION ORDER IS THE LIFETIME CONTRACT =====
    engine::Timer t;
    engine::ColumnStore store = engine::load_columns(argv[1]);
    std::fprintf(stderr, "store ready: %zu rows in %.1f ms\n",
                 store.size(), t.ms());

    t.reset();
    engine::PercentileIndex index(store);
    std::fprintf(stderr, "percentile index ready: %zu groups in %.1f ms\n",
                 index.group_count(), t.ms());

    engine::EngineService service(store, index);

    grpc::ServerBuilder builder;
    builder.AddListeningPort(addr, grpc::InsecureServerCredentials());
    builder.RegisterService(&service);

    // ===== THE BARRIER =====
    // This creates the handler thread pool. Everything above is fully
    // constructed and, by the happens-before edge of thread creation,
    // visible to every handler thread. That sequencing is the entire
    // correctness argument for lock-free concurrent reads.
    std::unique_ptr<grpc::Server> server = builder.BuildAndStart();
    if (!server) {
        std::fprintf(stderr, "failed to bind %s\n", addr.c_str());
        return 1;
    }

    std::fprintf(stderr, "listening on %s\n", addr.c_str());
    server->Wait();          // blocks until shutdown; Ctrl-C to stop
    return 0;
}