#!/usr/bin/env bash
# Deploys the Weak Link API (engine + gateway, deploy/api/Dockerfile) to
# Google Cloud Run. Cloud Build builds the image remotely; the image fetches
# the latest OpenPowerlifting CSV as it builds. Safe to re-run.
#
# Sized for the free tier: 1 vCPU / 2 GiB, scales to zero when idle, at most
# one instance. Cold start (load ~4M rows) is about 10-20 s; the gateway only
# opens its port once the engine is ready, so Cloud Run holds the first
# request rather than failing it.
#   deploy/cloudrun/deploy.sh <project-id> [region=europe-west1]
set -euo pipefail
PROJECT="${1:?usage: deploy.sh <project-id> [region]}"
REGION="${2:-europe-west1}"
SERVICE=weaklink-api
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT
"$ROOT/deploy/api/assemble.sh" "$CTX"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  --project "$PROJECT"

gcloud run deploy "$SERVICE" --source "$CTX" --project "$PROJECT" --region "$REGION" \
  --port 7860 --cpu 1 --memory 2Gi --cpu-boost --execution-environment gen2 \
  --startup-probe tcpSocket.port=7860,initialDelaySeconds=0,periodSeconds=5,timeoutSeconds=3,failureThreshold=48 \
  --min-instances 0 --max-instances 1 --concurrency 80 --timeout 60 \
  --allow-unauthenticated --quiet

# Keep only the two newest images so stored images stay inside the free 0.5 GB.
cat > "$CTX/cleanup.json" <<'JSON'
[{"name": "keep-two", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 2}},
 {"name": "delete-rest", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}]
JSON
gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy \
  --project "$PROJECT" --location "$REGION" --policy "$CTX/cleanup.json" --no-dry-run --quiet || true

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "service: $URL"
curl -sf "$URL/api/dataset-stats" && echo
