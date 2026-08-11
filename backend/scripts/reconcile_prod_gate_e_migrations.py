#!/usr/bin/env python3
"""Reconcile the audited production 173-204 migration-ledger gap safely.

This is deliberately narrower than ``apply_migrations.sh --baseline``.  It
applies the idempotent repair migration 204 *before* recording only the exact
historical files whose final contracts were audited on production.  A SQL
postcondition audit must pass before any missing ledger rows are inserted.

Usage:
    DRY_RUN=1 python backend/scripts/reconcile_prod_gate_e_migrations.py "$DATABASE_URL"
    ALLOW_PROD=1 python backend/scripts/reconcile_prod_gate_e_migrations.py "$DATABASE_URL"
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
from typing import Iterable


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_ROOT = BACKEND_ROOT / "migrations"
APPLY_MIGRATIONS = BACKEND_ROOT / "scripts" / "apply_migrations.sh"
VERIFY_SQL = BACKEND_ROOT / "scripts" / "verify_prod_gate_e_reconcile.sql"
PRODUCTION_PROJECT_REF = "huwsmtubwulikhlmcirx"
MIGRATION_ADVISORY_LOCK = (173204, 1)

# Production already records these three files.  They are intentionally not
# synthesized by this procedure: if one is absent, the audited target no longer
# matches and an operator must stop and re-audit instead of broad-baselining it.
REQUIRED_EXISTING = (
    "197_rls_explicit_on_public_tables.sql",
    "199_user_feedback_vocabulary.sql",
    "203_anonymous_vocabulary_feedback_dedupe.sql",
)

# Exact files whose durable final effects were audited on production.  Do not
# derive this list from the directory: doing so would turn this into a disguised
# --baseline and could mark an unaudited migration as applied.
AUDITED_HISTORY = (
    "173_listening_tests_practice_type.sql",
    "174_fn_insert_listening_answer_once.sql",
    "175_courses.sql",
    "176_class_lessons.sql",
    "177_class_assignments.sql",
    "178_class_assignment_lesson_same_cohort.sql",
    "179_fn_class_assignment_atomic.sql",
    "180_fn_class_assignment_locks.sql",
    "181_test_attempts_class_link.sql",
    "182_speaking_assignment_from_bank.sql",
    "183_speaking_lesson_sets.sql",
    "184_fn_create_assignment_kind.sql",
    "185_speaking_progress_marks.sql",
    "186_quiz_why_wrong_and_lesson.sql",
    "187_class_assignment_course_skill.sql",
    "188_quiz_session_class_link.sql",
    "189_course_mastery_gate.sql",
    "190_course_writing_submissions.sql",
    "191_artifact_kind_course_writing.sql",
    "192_writing_unique_per_item.sql",
    "193_assignment_subgroup_and_backfill.sql",
    "194_course_writing_drafts.sql",
    "195_drop_course_writing_draft_seq.sql",
    "196_delete_rpc_course_evidence.sql",
    "198_class_action_log.sql",
    "200_speaking_full_test_attempt_identity.sql",
    "201_session_create_idempotency.sql",
    "202_response_persisted_at.sql",
)
REPAIR_MIGRATION = "204_reconcile_course_and_gate_e_schema.sql"
RECONCILED_SCOPE = (*AUDITED_HISTORY, *REQUIRED_EXISTING, REPAIR_MIGRATION)


class ReconciliationError(RuntimeError):
    """The database no longer matches the audited reconciliation target."""


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


def _ensure_ledger(database_url: str) -> None:
    _psql(
        database_url,
        "-q",
        "-c",
        "CREATE TABLE IF NOT EXISTS _schema_migrations ("
        "filename text PRIMARY KEY, "
        "applied_at timestamptz NOT NULL DEFAULT now())",
    )


def _read_ledger(database_url: str) -> set[str]:
    result = _psql(
        database_url,
        "-tAc",
        "SELECT filename FROM _schema_migrations ORDER BY filename",
        capture_output=True,
    )
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def _ledger_insert_sql(filenames: Iterable[str]) -> str:
    rows = tuple(filenames)
    if not rows:
        raise ReconciliationError("refusing an empty locked ledger write")
    values = ", ".join(f"('{filename}')" for filename in rows)
    return (
        "INSERT INTO _schema_migrations (filename) "
        f"SELECT filename FROM (VALUES {values}) AS audited(filename) "
        "ON CONFLICT (filename) DO NOTHING"
    )


def _reconcile_locked(
    database_url: str,
    *,
    apply_repair: bool,
    filenames: Iterable[str],
) -> None:
    """Repair, verify and acknowledge history under one database lock/session.

    The standard forward runner takes the same session-level advisory lock and
    re-reads each ledger row only after acquiring it. Keeping this entire
    sequence in one ``psql`` process prevents a runner that took an earlier
    snapshot from replaying superseded history between verification and the
    ledger write. Session close releases the lock on every error path.
    """
    lock_class, lock_object = MIGRATION_ADVISORY_LOCK
    arguments = [
        "-q",
        "-c",
        f"SELECT pg_advisory_lock({lock_class}, {lock_object})",
    ]
    if apply_repair:
        arguments.extend(("-f", str(MIGRATIONS_ROOT / REPAIR_MIGRATION)))
    arguments.extend(
        (
            "-f",
            str(VERIFY_SQL),
            "-c",
            _ledger_insert_sql(filenames),
            "-c",
            f"SELECT pg_advisory_unlock({lock_class}, {lock_object})",
        )
    )
    _psql(database_url, *arguments)


def _standard_forward_dry_run(database_url: str) -> str:
    env = os.environ.copy()
    env["DRY_RUN"] = "1"
    if PRODUCTION_PROJECT_REF in database_url:
        env["ALLOW_PROD"] = "1"
    result = _run(
        [str(APPLY_MIGRATIONS), database_url],
        env=env,
        capture_output=True,
    )
    return result.stdout


def _assert_no_historical_replay(dry_run_output: str) -> None:
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
    if (
        not dry_run
        and PRODUCTION_PROJECT_REF in database_url
        and os.environ.get("ALLOW_PROD") != "1"
    ):
        raise ReconciliationError(
            "target is production; set ALLOW_PROD=1 after reviewing the dry-run"
        )

    if not dry_run:
        _ensure_ledger(database_url)
    ledger = _read_ledger(database_url)

    missing_required = sorted(set(REQUIRED_EXISTING) - ledger)
    if missing_required:
        raise ReconciliationError(
            "production ledger does not match the audited target; required existing "
            "entries are missing: " + ", ".join(missing_required)
        )

    missing_history = tuple(name for name in AUDITED_HISTORY if name not in ledger)
    repair_missing = REPAIR_MIGRATION not in ledger

    if dry_run:
        if repair_missing:
            print(f"would apply first: {REPAIR_MIGRATION}")
        if missing_history:
            print("would record audited history after verification:")
            for filename in missing_history:
                print(f"  {filename}")
        if repair_missing:
            print(f"would record repair after verification: {REPAIR_MIGRATION}")
        if not missing_history and not repair_missing:
            print("no-op: audited 173-204 ledger scope is already reconciled")
        return

    if not missing_history and not repair_missing:
        dry_output = _standard_forward_dry_run(database_url)
        _assert_no_historical_replay(dry_output)
        print("no-op: audited 173-204 ledger scope is already reconciled")
        print(dry_output, end="")
        return

    # This ordering is the safety property the normal forward runner cannot
    # provide on the drifted production ledger: repair the final schema first,
    # prove the audited final state, and only then acknowledge historical files.
    to_record = (*missing_history, *((REPAIR_MIGRATION,) if repair_missing else ()))
    if repair_missing:
        print(f"applying repair first: {REPAIR_MIGRATION}")
    print("verifying audited production postconditions")
    _reconcile_locked(
        database_url,
        apply_repair=repair_missing,
        filenames=to_record,
    )

    post_ledger = _read_ledger(database_url)
    still_missing = sorted(set(RECONCILED_SCOPE) - post_ledger)
    if still_missing:
        raise ReconciliationError(
            "ledger write did not close the audited scope: " + ", ".join(still_missing)
        )

    dry_output = _standard_forward_dry_run(database_url)
    _assert_no_historical_replay(dry_output)
    print(f"reconciled: {len(to_record)} ledger entries recorded")
    print("verified: standard forward dry-run lists no migration from 173-204")
    print(dry_output, end="")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(
            "usage: reconcile_prod_gate_e_migrations.py <DATABASE_URL>",
            file=sys.stderr,
        )
        return 2
    try:
        reconcile(argv[1], dry_run=os.environ.get("DRY_RUN") == "1")
    except ReconciliationError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        # CalledProcessError.__str__ includes the complete argv. Every psql and
        # migration-runner command carries DATABASE_URL in argv, so rendering
        # the exception would leak the production password into CI/operator
        # logs on the exact fail-closed paths this tool is designed to exercise.
        print(
            f"REFUSED: database command exited with status {exc.returncode}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
