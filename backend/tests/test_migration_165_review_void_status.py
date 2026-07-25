"""Migration 165 — 'void' must be a legal mock_exam_reviews.status.

Codex review on PR #840 (P1, correct): `void_sitting()` writes status='void' on
the linked review so a stale review page cannot call release_results() and
publish an exam that was explicitly cancelled. Migration 147 pinned the column
to CHECK (status IN ('queued','claimed','edited','reviewed','released')), so
that UPDATE is rejected by Postgres — and the call site catches broadly, which
makes the failure invisible: the review stays in the active queue as work
someone is expected to finish for a cancelled exam.

These are static assertions on the SQL, not a live-DB test. CI has no Postgres,
and the point is to catch the schema value being USED before it is MIGRATED —
which is exactly a text-level property of the two files.
"""

from __future__ import annotations

import re
from pathlib import Path

MIG_DIR = Path(__file__).resolve().parents[1] / "migrations"
MIGRATION = MIG_DIR / "165_mock_review_void_status.sql"
SERVICE = Path(__file__).resolve().parents[1] / "services" / "mock_exam_service.py"


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_migration_exists():
    assert MIGRATION.is_file(), f"missing {MIGRATION}"


def test_old_constraint_is_dropped_before_the_new_one_is_added():
    sql = _sql()
    drop = sql.find("DROP CONSTRAINT IF EXISTS mock_exam_reviews_status_check")
    add = sql.find("ADD CONSTRAINT mock_exam_reviews_status_check")
    assert drop != -1, "the 147 constraint must be dropped, not just re-added"
    assert add > drop, "ADD must come after DROP"


def test_new_constraint_keeps_every_old_value_and_adds_void():
    sql = _sql()
    m = re.search(
        r"ADD\s+CONSTRAINT\s+mock_exam_reviews_status_check\s*"
        r"CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)",
        sql, re.I | re.S,
    )
    assert m, "new CHECK constraint not found"
    values = {v.strip().strip("'") for v in m.group(1).split(",")}
    # dropping any of these would break the existing workflow, not just add to it
    assert {"queued", "claimed", "edited", "reviewed", "released"} <= values
    assert "void" in values


def test_the_service_actually_writes_the_value_this_migration_allows():
    # The pairing is the whole point: if the write is ever removed, this
    # migration is dead weight; if the migration is ever dropped, the write
    # starts failing silently again.
    src = SERVICE.read_text(encoding="utf-8")
    assert re.search(r'table\("mock_exam_reviews"\)\.update\(\{\s*\n?\s*"status":\s*"void"', src)


def test_the_historical_backfill_actually_runs():
    """Codex #840 (correct): extending the constraint only fixes FUTURE voids.
    Reviews whose sitting was voided BEFORE this migration are the rows whose
    update silently failed the old CHECK — they stay queued/claimed/reviewed and
    keep appearing in get_queue() as work someone is expected to finish for a
    cancelled exam. Leaving the corrective UPDATE commented out shipped that."""
    body = "\n".join(
        ln for ln in _sql().splitlines() if not ln.strip().startswith("--")
    )
    assert re.search(
        r"UPDATE\s+mock_exam_reviews\s+r\s+SET\s+status\s*=\s*'void'",
        body, re.I | re.S,
    ), "the backfill UPDATE must be executable, not commented out"
    assert "s.status = 'void'" in body
    assert "r.status NOT IN ('released', 'void')" in body


def test_constraint_change_and_backfill_share_one_transaction():
    """Either both land or neither does — a backfill that runs against the OLD
    constraint would fail on every row it tries to move."""
    body = "\n".join(
        ln for ln in _sql().splitlines() if not ln.strip().startswith("--")
    )
    begin = body.index("BEGIN;")
    commit = body.index("COMMIT;")
    add = body.index("ADD CONSTRAINT mock_exam_reviews_status_check")
    upd = body.upper().index("UPDATE MOCK_EXAM_REVIEWS")
    assert begin < add < upd < commit, "backfill must sit after ADD, before COMMIT"
