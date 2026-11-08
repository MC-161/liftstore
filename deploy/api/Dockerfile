# Weak Link API: the C++ engine and the Go gateway in one image. One public
# port (7860, the gateway), the engine on loopback, run as an unprivileged user.
# Build context: assembled by deploy/api/assemble.sh (no data, no build trees).

# ---- the engine (C++20). Alpine's gRPC/protobuf ship the CMake config files
# find_package(... CONFIG) needs; Debian's protobuf doesn't.
FROM alpine:3.20 AS engine
RUN apk add --no-cache build-base cmake samurai grpc-dev grpc-plugins protobuf-dev
WORKDIR /src
COPY CMakeLists.txt ./
COPY include include
COPY src src
COPY proto proto
COPY service service
COPY apps apps
RUN cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DENGINE_BUILD_TESTS=OFF -DENGINE_BUILD_BENCH=OFF \
    && cmake --build build --target engine_server -j"$(nproc)"

# ---- the gateway (Go; protobuf code generated here, it isn't committed)
FROM golang:1.27-bookworm AS gateway
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
RUN go install google.golang.org/protobuf/cmd/protoc-gen-go@latest \
    && go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
WORKDIR /src/go
COPY go/go.mod go/go.sum ./
RUN go mod download
COPY go/cmd cmd
COPY go/internal internal
COPY proto /src/proto
RUN mkdir -p gen/engine/v1 && protoc --proto_path=../proto \
      --go_out=gen/engine/v1 --go_opt=paths=source_relative \
      --go_opt=Mengine.proto=github.com/MC-161/liftstore/gen/engine/v1 \
      --go-grpc_out=gen/engine/v1 --go-grpc_opt=paths=source_relative \
      --go-grpc_opt=Mengine.proto=github.com/MC-161/liftstore/gen/engine/v1 \
      ../proto/engine.proto \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# ---- the data: OpenPowerlifting's public-domain bulk CSV
FROM debian:bookworm-slim AS data
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*
ARG OPL_URL=https://openpowerlifting.gitlab.io/opl-csv/files/openpowerlifting-latest.zip
RUN curl -fsSL "$OPL_URL" -o /tmp/opl.zip \
    && mkdir /data && unzip -j /tmp/opl.zip '*.csv' -d /data \
    && mv /data/*.csv /data/openpowerlifting.csv && rm /tmp/opl.zip

# ---- runtime
FROM alpine:3.20
RUN apk add --no-cache bash libstdc++ grpc-cpp libprotobuf \
    && adduser -D -u 1000 user
COPY --from=engine /src/build/apps/engine_server /app/engine_server
COPY --from=gateway /out/api /app/api
COPY --from=data /data/openpowerlifting.csv /app/openpowerlifting.csv
COPY deploy/api/start.sh /app/start.sh
USER user
EXPOSE 7860
CMD ["bash", "/app/start.sh"]
