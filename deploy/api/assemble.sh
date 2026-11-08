#!/usr/bin/env bash
# Copies just what the API image needs into <dir>, for `docker build <dir>`.
# No data, no build trees, no web app.
#   deploy/api/assemble.sh <dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:?usage: assemble.sh <dir>}"
mkdir -p "$OUT"

rsync -a --delete --exclude '.git' \
  --include 'CMakeLists.txt' \
  --include 'include/***' --include 'src/***' --include 'proto/***' \
  --include 'service/***' --include 'apps/***' \
  --include 'go/' --include 'go/go.mod' --include 'go/go.sum' \
  --include 'go/cmd/***' --include 'go/internal/***' \
  --include 'deploy/' --include 'deploy/api/' --include 'deploy/api/start.sh' \
  --exclude '*' \
  "$ROOT/" "$OUT/"

cp "$ROOT/deploy/api/Dockerfile" "$OUT/Dockerfile"
echo "assembled $(du -sh "$OUT" | cut -f1) in $OUT"
