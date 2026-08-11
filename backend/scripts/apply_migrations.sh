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
LOCKED_APPLIER="$(cd "$(dirname "$0")" && pwd)/apply_migration_locked.sql"
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
  # An entry already present in the immutable forward ledger is safe to skip.
  # A row missing from this snapshot is never trusted: it always reaches the
  # locked helper, which re-checks after waiting for a concurrent reconciler.
  if is_applied "$base"; then
    skipped=$((skipped + 1))
    continue
  fi
  # The helper acquires the same PostgreSQL session lock as the production
  # reconciler, then re-checks this exact ledger row under the lock before it
  # can include the migration. The helper emits one namespaced status marker;
  # actual psql/migration failures keep their native non-zero exit code.
  if output="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
      -v MIGRATION_NAME="$base" \
      -v MIGRATION_PATH="$f" \
      -v BASELINE="$BASELINE" \
      -v DRY_RUN="${DRY_RUN:-0}" \
      -f "$LOCKED_APPLIER")"; then
    status=0
  else
    status=$?
  fi
  [[ "$status" == "0" ]] || exit "$status"
  printf '%s\n' "$output"
  case "$output" in
    *"__apply_migration_status__=skipped"*) skipped=$((skipped + 1)) ;;
    *"__apply_migration_status__=would-apply"*) count=$((count + 1)) ;;
    *"__apply_migration_status__=processed"*) count=$((count + 1)) ;;
    *) echo "REFUSED: locked migration helper returned no status for $base" >&2; exit 1 ;;
  esac
done

echo "----"
mode="applied"
[[ "$BASELINE" == "1" ]] && mode="baselined"
[[ "${DRY_RUN:-0}" == "1" ]] && mode="would apply"
echo "$mode: $count · already in ledger: $skipped"
