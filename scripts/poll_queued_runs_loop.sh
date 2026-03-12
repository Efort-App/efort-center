#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env.scheduler.local" ]]; then
  set -a
  source "$ROOT_DIR/.env.scheduler.local"
  set +a
fi

POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-60}"

while true; do
  printf '[%s] polling queued runs\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  node "$ROOT_DIR/scripts/poll_queued_runs.mjs" || true
  sleep "$POLL_INTERVAL_SECONDS"
done
