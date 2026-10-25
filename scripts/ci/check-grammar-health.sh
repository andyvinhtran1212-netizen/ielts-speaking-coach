#!/usr/bin/env bash
# Smoke gate for /health/grammar-check (see backend/services/grammar_check.py).
#
#   scripts/ci/check-grammar-health.sh https://BACKEND-ORIGIN
#
# Fails when the grammar checker does not run at all: the asset is missing
# (init_failure_reason=asset_missing), the probe errored, or the known-bad
# sample produced 0 findings. A "degraded" verdict caused only by the offline
# LanguageTool server being unavailable passes with a warning: the VI-learner
# local rules still run and transcripts never leave the server.
set -euo pipefail

BASE="${1:?usage: check-grammar-health.sh BACKEND_ORIGIN}"
BODY=""
for attempt in 1 2 3; do
  # The first call after a deploy initialises the checker lazily; retry.
  if BODY=$(curl -fsS --max-time 60 "$BASE/health/grammar-check"); then
    break
  fi
  echo "grammar-check probe attempt $attempt failed; retrying" >&2
  sleep 10
done
if [ -z "$BODY" ]; then
  echo "::error::Cannot reach $BASE/health/grammar-check"
  exit 1
fi

printf '%s' "$BODY" | python3 -c '
import json, sys
d = json.load(sys.stdin)
g = d.get("grammar_check") or {}
status = d.get("status")
reason = g.get("init_failure_reason")
count = g.get("sample_error_count") or 0
mode = g.get("backend_mode")
print(f"status={status} reason={reason} sample_error_count={count} mode={mode}")
problems = []
if status == "error":
    problems.append("probe raised: " + "; ".join(g.get("messages") or []))
if reason == "asset_missing":
    problems.append("grammar asset missing - no grammar check runs")
if count <= 0:
    problems.append("0 findings for the known-bad probe sample")
if problems:
    for p in problems:
        print(f"::error::grammar-check smoke gate: {p}")
    sys.exit(1)
if status != "healthy":
    print("::warning::grammar-check degraded (" + str(reason) + "): local rules only")
'
