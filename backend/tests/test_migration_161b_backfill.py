"""Migration 161b — the retake-deadline backfill must run, and must not collect
a test somebody is sitting.

Two defects Codex found on PR #839, both of which only bite in production:

1. The sittings UPDATE referenced the target alias `s` inside a FROM-clause
   join condition (`LEFT JOIN mock_exam_assignments a ON a.user_id = s.user_id`).
   PostgreSQL does not expose the UPDATE target there, so the statement raises
   "invalid reference to FROM-clause entry for table s" and the whole
   transaction rolls back — leaving every legacy open-ended row untouched while
   the deploy looks successful.

2. Deriving the deadline solely from the ASSIGNMENT's `created_at` gives a
   recently-opened sitting a deadline already in the past. The reaper enabled by
   this same wave then immediately collects every outstanding section of a test
   that is actively being sat.

CI has no PostgreSQL, so these are static assertions on the SQL text. That is
the right level: both defects are visible in the statement's shape, and a live
test would need a seeded multi-table fixture to say the same thing.
"""

from __future__ import annotations

import re
from pathlib import Path

MIG_DIR = Path(__file__).resolve().parents[1] / "migrations"
MIGRATION = MIG_DIR / "161b_backfill_retake_open_until.sql"


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _statements() -> list[str]:
    """The executable statements, with comment lines stripped."""
    body = "\n".join(
        ln for ln in _sql().splitlines() if not ln.strip().startswith("--")
    )
    return [st.strip() for st in body.split(";") if st.strip()]


def test_migration_exists():
    assert MIGRATION.is_file(), f"missing {MIGRATION}"


def test_sittings_update_does_not_reference_the_target_alias_in_a_join():
    """The bug: `FROM ... JOIN ... ON <col> = s.<col>` — `s` is not in scope."""
    for st in _statements():
        if not st.upper().startswith("UPDATE MOCK_EXAM_SITTINGS"):
            continue
        m = re.search(r"\bFROM\b(.*?)\bWHERE\b", st, re.I | re.S)
        assert m, "the sittings UPDATE should still have a FROM clause"
        from_clause = m.group(1)
        # Any JOIN inside FROM must not correlate to the UPDATE target.
        for join in re.findall(r"\bON\b(.*?)(?=\bJOIN\b|$)", from_clause, re.I | re.S):
            assert not re.search(r"\bs\.", join), (
                "UPDATE target alias `s` referenced inside a FROM-clause join: "
                f"{join.strip()!r}"
            )


def test_the_assignment_lookup_is_a_correlated_subquery():
    sql = _sql()
    assert re.search(
        r"\(SELECT\s+a\.open_until\s+FROM\s+mock_exam_assignments\s+a\s+"
        r"WHERE\s+a\.exam_id\s*=\s*s\.mock_exam_id",
        sql, re.I | re.S,
    ), "the assignment deadline must be read via a correlated subquery"


def test_an_active_sitting_cannot_inherit_a_past_deadline():
    """The deadline is the LATEST of the assignment's value and the sitting's
    own creation / start activity — never the assignment's alone."""
    sql = _sql()
    assert re.search(r"SET\s+retake_open_until\s*=\s*GREATEST\(", sql, re.I), (
        "the sitting deadline must be a GREATEST(...), not a bare COALESCE"
    )
    for col in ("listening_started_at", "reading_started_at", "writing_started_at"):
        assert re.search(rf"COALESCE\(s\.{col},\s*s\.created_at\)", sql), (
            f"{col} must participate in the floor"
        )
    assert "s.created_at + INTERVAL '14 days'" in sql


def test_only_non_terminal_sittings_are_stamped():
    assert "s.status IN ('registered', 'lrw_in_progress')" in _sql()


def test_the_write_is_wrapped_in_one_transaction():
    body = _sql().upper()
    assert body.count("BEGIN;") == 1 and body.count("COMMIT;") == 1


def test_it_sorts_before_the_unique_index_migration():
    """The whole point of the `b` suffix.

    scripts/apply_migrations.sh applies files in FILENAME order. A file numbered
    164 would have run AFTER 162's unique index — so the ordering note in the
    header would have been a lie the runner ignored, and the stuck legacy rows
    this backfill clears would first have become a permanent per-student lock on
    every future exam.
    """
    names = sorted(p.name for p in MIG_DIR.glob("*.sql"))
    unique_idx = "162_mock_sitting_one_live_per_user.sql"
    if unique_idx not in names:
        # 162 arrives on a later branch in the stack; nothing to order against
        # yet. Once both are present (every branch from #841 onward, and main
        # after the merge) the assertion below is live.
        return
    assert names.index(MIGRATION.name) < names.index(unique_idx), (
        "the retake backfill must sort before the one-live-sitting index"
    )
