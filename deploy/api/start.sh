#!/usr/bin/env bash
# Engine on loopback, gateway on the public port (7860). The engine loads the
# CSV (a few seconds) before it listens; the gateway starts once it does, so
# the first request never meets a half-loaded engine.
set -euo pipefail

/app/engine_server /app/openpowerlifting.csv 127.0.0.1:50051 &
ENGINE=$!

for _ in $(seq 1 180); do
  if (exec 3<>/dev/tcp/127.0.0.1/50051) 2>/dev/null; then break; fi
  kill -0 "$ENGINE" 2>/dev/null || { echo "engine exited during load" >&2; exit 1; }
  sleep 1
done

# The browser never calls this origin directly (Vercel proxies /api), so CORS
# is only for opening the API by hand; ALLOW_ORIGIN narrows it if set.
exec /app/api -engine 127.0.0.1:50051 -listen :7860 -cors-origin "${ALLOW_ORIGIN:-*}"
