#!/usr/bin/env bash
# Apply forward-only SQL migrations (backend/migrations/) in numeric order.
#
# Usage:
#   ./apply_migrations.sh "<DATABASE_URL>"            # apply all, stop on first error
#   DRY_RUN=1 ./apply_migrations.sh "<DATABASE_URL>"  # list what would run, touch nothing
#
# Safety: refuses the production Supabase project unless ALLOW_PROD=1.
# Notes (see migrations/README.md):
#   - 032_rollback.sql reverses 032 and is never part of a forward run.
#   - 093/094/096 contain CREATE INDEX CONCURRENTLY, so files are NOT wrapped
#     in a single transaction; intended for fresh/disposable databases (staging).
set -euo pipefail

DB_URL="${1:?usage: apply_migrations.sh <DATABASE_URL>}"
MIG_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"
PROD_REF="huwsmtubwulikhlmcirx"

if [[ "$DB_URL" == *"$PROD_REF"* && "${ALLOW_PROD:-0}" != "1" ]]; then
  echo "REFUSED: target looks like the production project ($PROD_REF). Set ALLOW_PROD=1 to override." >&2
  exit 1
fi

count=0
for f in $(ls "$MIG_DIR"/*.sql | sort); do
  base="$(basename "$f")"
  [[ "$base" == "032_rollback.sql" ]] && continue
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "would apply: $base"
  else
    echo "== $base"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  fi
  count=$((count + 1))
done

echo "----"
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "dry run: $count migrations would be applied"
else
  echo "applied: $count migrations"
fi
