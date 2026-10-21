#pragma once

#include <cstdint>
#include <optional>

#include <grpcpp/grpcpp.h>

#include "engine.grpc.pb.h"          // generated: engine::v1::Engine::Service
#include "engine/column_store.h"
#include "engine/percentile.h"

namespace engine {

// =================================================================
// NAMING RULE
//
// proto declares `package engine.v1`, so protobuf generates
// everything into namespace engine::v1. This file is inside namespace
// engine, so:
//
//     Sex        -> engine::Sex      (domain type, yours)
//     v1::Sex    -> engine::v1::Sex  (wire type, generated)
//
// Convention for this whole project: wire types ALWAYS carry the
// `v1::` prefix, domain types never do. One glance tells you which
// side of the boundary a type is on.
// =================================================================


// -----------------------------------------------------------------
// Translation: wire -> domain.
//
// FREE FUNCTIONS, not private methods. A test can call these without
// constructing a service or starting a server -- which is the entire
// reason `service` is a separate library rather than living in
// apps/server.cpp.
//
// optional<> because every one of these CAN fail: the proto3 zero
// value is *_UNSPECIFIED, and a client that sets nothing sends it.
// optional makes the failure impossible to forget -- you cannot reach
// the value without first acknowledging it might not be there. A
// version returning plain `Sex` with some "invalid" sentinel would
// compile fine at every call site that forgot to check.
// -----------------------------------------------------------------

std::optional<Sex>       from_proto(v1::Sex s);
std::optional<Equipment> from_proto(v1::Equipment e);
std::optional<Event>     from_proto(v1::Event e);

// 0 means "unset" -> kDefaultLimit. Over kMaxLimit is an
// error, not a clamp. kDefaultLimit matches top_lifters_columnar's
// tuned partial_sort k, so the common request never hits the doubling
// retry. kMaxLimit is derived from gRPC's 4 MB default max message
// size divided by ~100 B per LifterResult.
inline constexpr std::uint32_t kDefaultLimit = 200;
inline constexpr std::uint32_t kMaxLimit     = 30000;

// nullopt => requested exceeds kMaxLimit.
std::optional<std::uint32_t> resolve_limit(std::uint32_t requested);


// -----------------------------------------------------------------
// The service.
//
// `final`: nothing derives from this, and saying so lets the compiler
// devirtualise.
//
// Members are const references: non-null by construction, no
// ownership, zero cost.
//
// LIFETIME INVARIANT: the store and index must outlive this object.
// main() guarantees it by declaring them before the service, since
// destruction runs in reverse declaration order. Violating it is a
// use-after-free; ASan reports heap-use-after-free in the Debug build.
//
// NO MUTABLE MEMBERS, NO CACHES. That is the no-locks precondition,
// visible right here in the header: several gRPC handler threads run
// these methods concurrently on the same store, and nothing they
// touch is written. Anything added below this line that is `mutable`
// or lazily initialised breaks that guarantee silently.
// -----------------------------------------------------------------

std::string format_date(std::uint32_t yyyymmdd);
std::optional<std::uint32_t> resolve_limit(std::uint32_t requested);

class EngineService final : public v1::Engine::Service {
public:
    EngineService(const ColumnStore& store, const PercentileIndex& index)
        : store_(store), index_(index) {}

    // `override` is not decoration. If a signature here does not match
    // the base class EXACTLY, without it you have quietly declared a
    // NEW function -- the base's UNIMPLEMENTED stays in the vtable,
    // the code compiles, and the RPC fails at runtime. With `override`
    // it is a compile error. Plausible-but-wrong, converted into
    // loud-and-early.
    grpc::Status TopLifters(grpc::ServerContext* context,
                            const v1::TopLiftersRequest* request,
                            v1::TopLiftersResponse* response) override;

    grpc::Status Percentile(grpc::ServerContext* context,
                            const v1::PercentileRequest* request,
                            v1::PercentileResponse* response) override;



private:
    const ColumnStore&    store_;
    const PercentileIndex& index_;
};

}  // namespace engine