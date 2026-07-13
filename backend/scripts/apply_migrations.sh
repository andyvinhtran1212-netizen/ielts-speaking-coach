#!/usr/bin/env bash
# Apply forward-only SQL migrations (backend/migrations/) with a ledger.
#
# A `_schema_migrations(filename, applied_at)` table records what already ran,
# so incremental invocations apply ONLY new files — historical migrations are
# never replayed (several contain one-shot seed inserts, e.g. 035; review P2
# 2026-07-13). Two modes:
#
#   ./apply_migrations.sh <DATABASE_URL>              # apply unapplied files
#   ./apply_migrations.sh --baseline <DATABASE_URL>   # record ALL current files
#                                                     # as applied WITHOUT running
#                                                     # (use right after cloning
#                                                     # production schema)
#   DRY_RUN=1 ./apply_migrations.sh <DATABASE_URL>    # list what would run
#
# Safety: refuses the production Supabase project unless ALLOW_PROD=1.
# Notes (see migrations/README.md):
#   - 032_rollback.sql reverses 032 and is never part of a forward run.
#   - 093/094/096 contain CREATE INDEX CONCURRENTLY, so files are NOT wrapped
#     in a single transaction.
set -euo pipefail

BASELINE=0
if [[ "${1:-}" == "--baseline" ]]; then BASELINE=1; shift; fi
DB_URL="${1:?usage: apply_migrations.sh [--baseline] <DATABASE_URL>}"
MIG_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"
PROD_REF="huwsmtubwulikhlmcirx"

if [[ "$DB_URL" == *"$PROD_REF"* && "${ALLOW_PROD:-0}" != "1" ]]; then
  echo "REFUSED: target looks like the production project ($PROD_REF). Set ALLOW_PROD=1 to override." >&2
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS _schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

applied_list="$(psql "$DB_URL" -tAc "SELECT filename FROM _schema_migrations")"

is_applied() {
  grep -qxF "$1" <<<"$applied_list"
}

count=0
skipped=0
for f in $(ls "$MIG_DIR"/*.sql | sort); do
  base="$(basename "$f")"
  [[ "$base" == "032_rollback.sql" ]] && continue
  if is_applied "$base"; then
    skipped=$((skipped + 1))
    continue
  fi
  if [[ "$BASELINE" == "1" ]]; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO _schema_migrations (filename) VALUES ('$base') ON CONFLICT DO NOTHING;"
    echo "baseline: $base"
  elif [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "would apply: $base"
  else
    echo "== $base"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO _schema_migrations (filename) VALUES ('$base') ON CONFLICT DO NOTHING;"
  fi
  count=$((count + 1))
done

echo "----"
mode="applied"
[[ "$BASELINE" == "1" ]] && mode="baselined"
[[ "${DRY_RUN:-0}" == "1" ]] && mode="would apply"
echo "$mode: $count · already in ledger: $skipped"
