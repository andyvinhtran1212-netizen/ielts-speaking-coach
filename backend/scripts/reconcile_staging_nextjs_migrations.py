#!/usr/bin/env python3
"""Reconcile the audited staging 215-221 migration-ledger gap safely.

The staging schema already contains the durable contracts from migrations
215-221, but an out-of-band rollout left every ledger row except 219 absent.
Replaying the range is unsafe: migration 217 rewrites every NULL Speaking
renderer affinity to ``legacy``, while NULL is now a valid short-lived state
for a fresh claim-v1 session.

This procedure therefore verifies the final database contracts under the same
advisory lock as the forward runner and records only the fixed, audited missing
history.  It is pinned to the staging Supabase project and cannot target
production or another database.

Usage:
    DRY_RUN=1 python backend/scripts/reconcile_staging_nextjs_migrations.py "$DATABASE_URL"
    python backend/scripts/reconcile_staging_nextjs_migrations.py "$DATABASE_URL"
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
from typing import Iterable
from urllib.parse import urlsplit


BACKEND_ROOT = Path(__file__).resolve().parents[1]
APPLY_MIGRATIONS = BACKEND_ROOT / "scripts" / "apply_migrations.sh"
VERIFY_SQL = BACKEND_ROOT / "scripts" / "verify_staging_nextjs_reconcile.sql"
STAGING_PROJECT_REF = "zjphffoujxkpltixsbzj"
STAGING_POOLER_HOSTS = frozenset({
    "aws-1-ap-northeast-1.pooler.supabase.com",
})
MIGRATION_ADVISORY_LOCK = (173204, 1)

# These entries prove the target is the staging ledger audited immediately
# before this reconciler was introduced.  In particular, 219 was applied by
# the locked runner and must not be synthesized as out-of-band history.
REQUIRED_EXISTING = (
    "205_writing_regrade_atomic_transitions.sql",
    "206_writing_assignment_idempotency.sql",
    "207_writing_student_submit_idempotency.sql",
    "208_listening_exercise_block_identity.sql",
    "209_listening_single_published_standalone_block.sql",
    "210_dictation_session_idempotency.sql",
    "211_d1_attempt_session_reliability.sql",
    "212_flashcard_review_idempotency.sql",
    "213_mock_collection_flush_ack.sql",
    "214_mock_collection_sweep_completion.sql",
    "219_listening_attempt_renderer_affinity.sql",
)

# Exact durable history found on staging but absent from its forward ledger.
# Never derive this manifest from the migration directory.
AUDITED_HISTORY = (
    "215_speaking_session_renderer_affinity.sql",
    "216_version_session_renderer_affinity_create.sql",
    "217_backfill_renderer_affinity_migration_gap.sql",
    "218_reading_attempt_renderer_affinity.sql",
    "220_dictation_attempt_affinity.sql",
    "221_writing_assignment_renderer_affinity.sql",
)
RECONCILED_SCOPE = (
    *AUDITED_HISTORY[:4],
    REQUIRED_EXISTING[-1],
    *AUDITED_HISTORY[4:],
)
GAP_BACKFILL = "217_backfill_renderer_affinity_migration_gap.sql"


class ReconciliationError(RuntimeError):
    """The database no longer matches the audited staging target."""


def _run(
    command: list[str],
    *,
    env: dict[str, str] | None = None,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        text=True,
        env=env,
        capture_output=capture_output,
    )


def _psql(database_url: str, *arguments: str, capture_output: bool = False):
    return _run(
        ["psql", database_url, "-v", "ON_ERROR_STOP=1", *arguments],
        capture_output=capture_output,
    )


def _assert_staging_target(database_url: str) -> None:
    parsed = urlsplit(database_url)
    hostname = (parsed.hostname or "").lower()
    username = parsed.username or ""
    direct_host = hostname == f"db.{STAGING_PROJECT_REF}.supabase.co"
    pinned_pooler = (
        hostname in STAGING_POOLER_HOSTS
        and username == f"postgres.{STAGING_PROJECT_REF}"
    )
    if not (direct_host or pinned_pooler):
        raise ReconciliationError(
            "target is not the pinned staging Supabase project"
        )


def _read_ledger(database_url: str) -> set[str]:
    result = _psql(
        database_url,
        "-tAc",
        "SELECT filename FROM public._schema_migrations ORDER BY filename",
        capture_output=True,
    )
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def _ledger_insert_sql(filenames: Iterable[str]) -> str:
    rows = tuple(filenames)
    if not rows:
        raise ReconciliationError("refusing an empty locked ledger write")
    values = ", ".join(f"('{filename}')" for filename in rows)
    return (
        "INSERT INTO public._schema_migrations (filename) "
        f"SELECT filename FROM (VALUES {values}) AS audited(filename) "
        "ON CONFLICT (filename) DO NOTHING"
    )


def _verify_arguments(*, require_gap_closed: bool) -> tuple[str, ...]:
    return (
        "-v",
        f"REQUIRE_GAP_CLOSED={1 if require_gap_closed else 0}",
        "-f",
        str(VERIFY_SQL),
    )


def _verify_read_only(database_url: str, *, require_gap_closed: bool) -> None:
    _psql(
        database_url,
        "-q",
        *_verify_arguments(require_gap_closed=require_gap_closed),
    )


def _verify_and_record_locked(
    database_url: str,
    *,
    filenames: Iterable[str],
    require_gap_closed: bool,
) -> None:
    """Verify and acknowledge history in one locked PostgreSQL session."""
    lock_class, lock_object = MIGRATION_ADVISORY_LOCK
    _psql(
        database_url,
        "-q",
        "-c",
        f"SELECT pg_advisory_lock({lock_class}, {lock_object})",
        *_verify_arguments(require_gap_closed=require_gap_closed),
        "-c",
        _ledger_insert_sql(filenames),
        "-c",
        f"SELECT pg_advisory_unlock({lock_class}, {lock_object})",
    )


def _standard_forward_dry_run(database_url: str) -> str:
    env = os.environ.copy()
    env["DRY_RUN"] = "1"
    result = _run(
        [str(APPLY_MIGRATIONS), database_url],
        env=env,
        capture_output=True,
    )
    return result.stdout


def _assert_no_reconciled_replay(dry_run_output: str) -> None:
    would_apply = {
        line.removeprefix("would apply: ").strip()
        for line in dry_run_output.splitlines()
        if line.startswith("would apply: ")
    }
    leaked = sorted(would_apply.intersection(RECONCILED_SCOPE))
    if leaked:
        raise ReconciliationError(
            "standard forward dry-run would replay reconciled history: "
            + ", ".join(leaked)
        )


def reconcile(database_url: str, *, dry_run: bool) -> None:
    _assert_staging_target(database_url)
    ledger = _read_ledger(database_url)

    missing_required = sorted(set(REQUIRED_EXISTING) - ledger)
    if missing_required:
        raise ReconciliationError(
            "staging ledger does not match the audited target; required existing "
            "entries are missing: " + ", ".join(missing_required)
        )

    missing_history = tuple(name for name in AUDITED_HISTORY if name not in ledger)
    require_gap_closed = GAP_BACKFILL in missing_history

    if dry_run:
        _verify_read_only(
            database_url,
            require_gap_closed=require_gap_closed,
        )
        if missing_history:
            print("would record audited history after locked verification:")
            for filename in missing_history:
                print(f"  {filename}")
        else:
            print("no-op: audited staging 215-221 ledger scope is reconciled")
        return

    if missing_history:
        print("verifying audited staging postconditions under migration lock")
        _verify_and_record_locked(
            database_url,
            filenames=missing_history,
            require_gap_closed=require_gap_closed,
        )
    else:
        _verify_read_only(database_url, require_gap_closed=False)

    post_ledger = _read_ledger(database_url)
    still_missing = sorted(set(RECONCILED_SCOPE) - post_ledger)
    if still_missing:
        raise ReconciliationError(
            "ledger write did not close the audited scope: " + ", ".join(still_missing)
        )

    dry_output = _standard_forward_dry_run(database_url)
    _assert_no_reconciled_replay(dry_output)
    if missing_history:
        print(f"reconciled: {len(missing_history)} ledger entries recorded")
    else:
        print("no-op: audited staging 215-221 ledger scope is reconciled")
    print("verified: standard forward dry-run lists no migration from 215-221")
    print(dry_output, end="")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(
            "usage: reconcile_staging_nextjs_migrations.py <DATABASE_URL>",
            file=sys.stderr,
        )
        return 2
    try:
        reconcile(argv[1], dry_run=os.environ.get("DRY_RUN") == "1")
    except ReconciliationError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        # Never render CalledProcessError: argv contains DATABASE_URL.
        print(
            f"REFUSED: database command exited with status {exc.returncode}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
