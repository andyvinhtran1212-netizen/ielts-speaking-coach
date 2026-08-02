"""Migrations 175–178 — nền dữ liệu Lớp & Học viên (GĐ 0).

Static assertions on the SQL text, not a live-DB test: CI has no Postgres. The
three files were applied against a throwaway local Postgres during development
(schema, seed, idempotent re-run, every CHECK, and both ON DELETE SET NULL
paths verified), so what is worth pinning here is not "does it parse" but the
handful of DESIGN DECISIONS a later patch could silently undo:

  * lateness / missed-ness is DERIVED, never stored. The obvious "helpful"
    change is to add 'late' or 'missed' to the state CHECK — which reintroduces
    exactly the drift the column was shaped to avoid (extend a deadline and the
    stored flag disagrees with the timestamps it claims to summarise).
  * due_at gets NO SQL DEFAULT, so composing "19:00 giờ Việt Nam" lives in one
    place in the backend. A DEFAULT here would put half of a timezone rule in
    SQL and half in Python — this repo has already shipped one day-boundary bug
    from exactly that split, invisible to CI because CI runs at UTC.
  * deleting a course must not delete its classes, and deleting an assignment
    must not delete graded speaking sessions. Both are ON DELETE SET NULL, and
    a CASCADE typo there destroys data with no error.

Kept text-level on purpose: each of these is a property of the migration file,
and the failure mode is a future edit, not a runtime path.
"""

from __future__ import annotations

import re
from pathlib import Path

MIG_DIR = Path(__file__).resolve().parents[1] / "migrations"

M175 = MIG_DIR / "175_courses.sql"
M176 = MIG_DIR / "176_class_lessons.sql"
M177 = MIG_DIR / "177_class_assignments.sql"
M178 = MIG_DIR / "178_class_assignment_lesson_same_cohort.sql"
ALL = (M175, M176, M177, M178)

NEW_TABLES = (
    "courses",
    "class_lessons",
    "class_assignments",
    "class_assignment_items",
)


def _strip_comments(sql: str) -> str:
    """Drop `--` comments, leaving string literals alone.

    Every assertion below is about DDL, and these files carry long rationale
    headers — so an un-stripped scan both misfires (the phrase "its CREATE TABLE
    is IF NOT EXISTS" in a comment reads as a CREATE statement) and, worse, lets
    prose satisfy an existence check that the schema does not actually meet.
    Quote-aware because COMMENT ON … IS '…' bodies are real content."""
    out: list[str] = []
    in_str = False
    i = 0
    while i < len(sql):
        ch = sql[i]
        if in_str:
            out.append(ch)
            if ch == "'":
                in_str = False
            i += 1
        elif ch == "'":
            in_str = True
            out.append(ch)
            i += 1
        elif sql.startswith("--", i):
            nl = sql.find("\n", i)
            if nl == -1:
                break
            i = nl                      # keep the newline; drop the comment body
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _sql(path: Path) -> str:
    """DDL only — see _strip_comments for why the rationale headers are removed
    before any structural assertion runs."""
    return _strip_comments(path.read_text(encoding="utf-8"))


# ── existence + shape ────────────────────────────────────────────────────


def test_all_three_migrations_exist():
    for path in ALL:
        assert path.is_file(), f"missing {path}"


def test_each_migration_is_one_transaction():
    """A half-applied migration leaves the class model in a state no later run
    repairs — the files are applied by hand, so the transaction is the only
    thing making a failed paste recoverable."""
    for path in ALL:
        sql = _sql(path)
        assert re.search(r"^BEGIN;", sql, re.M), f"{path.name}: no BEGIN"
        assert re.search(r"^COMMIT;", sql, re.M), f"{path.name}: no COMMIT"


def test_every_create_is_idempotent():
    """Re-running a migration must be a no-op: these are pasted by hand into the
    Supabase console, where a double-paste is an ordinary accident."""
    for path in ALL:
        sql = _sql(path)
        for stmt in re.findall(r"CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(\S+)", sql, re.I):
            kind, nxt = stmt
            assert nxt.upper() == "IF", (
                f"{path.name}: CREATE {kind} without IF NOT EXISTS"
            )
        # Policies and triggers have no IF NOT EXISTS form — they must be
        # dropped first instead.
        for name in re.findall(r"CREATE\s+POLICY\s+(\w+)", sql, re.I):
            assert f"DROP POLICY IF EXISTS {name}" in sql, (
                f"{path.name}: policy {name} created without a preceding DROP"
            )
        for name in re.findall(r"CREATE\s+TRIGGER\s+(\w+)", sql, re.I):
            assert f"DROP TRIGGER IF EXISTS {name}" in sql, (
                f"{path.name}: trigger {name} created without a preceding DROP"
            )


def test_rls_is_enabled_on_every_new_table():
    """Every admin-managed table here runs with RLS on and admin-only policies;
    student reads go through service-role endpoints. A table shipped without RLS
    is readable by any authenticated JWT."""
    joined = "".join(_sql(p) for p in ALL)
    for table in NEW_TABLES:
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in joined.replace(
            "      ENABLE", " ENABLE"
        ), f"{table}: RLS not enabled"


# ── 175: courses ─────────────────────────────────────────────────────────


def test_seed_is_conflict_safe_and_has_the_five_courses():
    sql = _sql(M175)
    assert "ON CONFLICT (code) DO NOTHING" in sql, (
        "seed must not clobber a name the admin has since edited, nor duplicate "
        "on re-run"
    )
    codes = re.findall(r"^\s*\('(C\d)',", sql, re.M)
    assert codes == ["C1", "C2", "C3", "C4", "C5"], codes


def test_deleting_a_course_must_not_delete_its_classes():
    sql = _sql(M175)
    m = re.search(
        r"ADD COLUMN IF NOT EXISTS course_id[^;]*?REFERENCES\s+courses\(id\)\s+"
        r"ON DELETE (\w+)",
        sql, re.I | re.S,
    )
    assert m, "cohorts.course_id FK not found"
    assert m.group(1).upper() == "SET", (
        f"cohorts.course_id is ON DELETE {m.group(1)} — a course must never take "
        f"its classes (and every student's membership) with it"
    )


def test_course_id_is_nullable():
    """Every cohort predating mig 175 is unclassified. NOT NULL would force a
    guessed backfill, and fabricated admin data is what the project rules
    forbid — NULL reads as 'chưa gán khoá', which is honest."""
    sql = _sql(M175)
    m = re.search(r"ADD COLUMN IF NOT EXISTS course_id[^;]*", sql, re.I | re.S)
    assert m and "NOT NULL" not in m.group(0).upper()


# ── 177: the ledger's load-bearing decisions ─────────────────────────────


def _item_state_values() -> set[str]:
    m = re.search(
        r"state\s+TEXT NOT NULL DEFAULT 'assigned'\s*CHECK\s*\(\s*state\s+IN\s*\(([^)]*)\)",
        _sql(M177), re.I | re.S,
    )
    assert m, "class_assignment_items.state CHECK not found"
    return {v.strip().strip("'") for v in m.group(1).split(",")}


def test_state_records_only_what_happened():
    """'late' and 'missed' are DERIVED (submitted_at vs due_at) and must never
    become stored states — a stored flag goes stale the moment a deadline
    moves, and 'missed' would additionally need a cron job to stay true."""
    values = _item_state_values()
    assert values == {"assigned", "opened", "submitted", "graded"}, values


def test_submitted_rows_must_carry_a_timestamp():
    """Without submitted_at, lateness is unanswerable for that row — the
    question the whole ledger exists to answer."""
    sql = _sql(M177)
    assert "class_assignment_items_submitted_at_required" in sql
    assert re.search(
        r"state NOT IN \('submitted', 'graded'\) OR submitted_at IS NOT NULL", sql
    ), "the submitted_at guard no longer covers both terminal states"


def test_artifact_kind_and_id_travel_together():
    """A half-linked row reads as 'submitted, but nothing to open'."""
    sql = _sql(M177)
    assert "class_assignment_items_artifact_pairing" in sql
    assert re.search(
        r"\(artifact_kind IS NULL AND artifact_id IS NULL\)\s*OR\s*"
        r"\(artifact_kind IS NOT NULL AND artifact_id IS NOT NULL\)",
        sql, re.I | re.S,
    )


def test_one_row_per_student_per_assignment():
    """Re-running a fan-out must be a no-op, not a second copy of the homework."""
    assert "UNIQUE (assignment_id, student_id)" in _sql(M177)


def test_due_at_has_no_sql_default():
    """The 19:00 Asia/Ho_Chi_Minh composition stays entirely in the backend —
    see the module docstring for why splitting it is a known bug shape here."""
    m = re.search(r"due_at\s+TIMESTAMPTZ([^,]*),", _sql(M177), re.I)
    assert m, "due_at column not found"
    assert "DEFAULT" not in m.group(1).upper(), (
        "due_at must not get a SQL DEFAULT — timezone composition belongs in one "
        "place, in Python"
    )


def test_speaking_link_never_cascades_into_graded_sessions():
    sql = _sql(M177)
    m = re.search(
        r"ADD COLUMN IF NOT EXISTS class_assignment_item_id[^;]*?"
        r"REFERENCES class_assignment_items\(id\)\s+ON DELETE (\w+)",
        sql, re.I | re.S,
    )
    assert m, "sessions.class_assignment_item_id FK not found"
    assert m.group(1).upper() == "SET", (
        f"ON DELETE {m.group(1)} — purging an assignment would delete graded "
        f"speaking sessions"
    )


def test_deleting_a_lesson_keeps_its_homework():
    """Students may already have submitted and been graded on it."""
    m = re.search(
        r"lesson_id\s+UUID REFERENCES class_lessons\(id\)\s+ON DELETE (\w+)",
        _sql(M177), re.I,
    )
    assert m and m.group(1).upper() == "SET", m


# ── 178: bài tập và buổi học phải cùng lớp ───────────────────────────────
#
# Both of these pin a trap that a plausible rewrite walks straight into, and
# neither shows up by reading the SQL — one surfaces only when a lesson is
# deleted, the other only on a second paste.


def test_lesson_link_is_scoped_to_the_cohort():
    """Two independent FKs let class A's homework hang off class B's lesson, so
    the class page renders another class's lesson heading and body."""
    sql = _sql(M178)
    assert re.search(
        r"FOREIGN KEY \(lesson_id, cohort_id\)\s*"
        r"REFERENCES class_lessons \(id, cohort_id\)",
        sql, re.I | re.S,
    ), "the composite FK is what scopes a lesson link to its own cohort"
    assert "UNIQUE (id, cohort_id)" in sql, (
        "a composite FK can only target a declared unique constraint on exactly "
        "those columns"
    )


def test_set_null_touches_only_lesson_id():
    """Plain `ON DELETE SET NULL` on a composite FK nulls EVERY column of it —
    including cohort_id, which is NOT NULL — so deleting a lesson aborts with a
    not-null violation. The PG15+ column-list form is load-bearing, and the
    failure appears at DELETE time, long after the migration looked fine."""
    m = re.search(
        r"REFERENCES class_lessons \(id, cohort_id\)\s*ON DELETE SET NULL\s*(\([^)]*\))?",
        _sql(M178), re.I | re.S,
    )
    assert m, "composite FK's ON DELETE clause not found"
    assert m.group(1) is not None, (
        "ON DELETE SET NULL must name a column list — the bare form also nulls "
        "cohort_id (NOT NULL) and makes lesson deletion impossible"
    )
    assert "lesson_id" in m.group(1) and "cohort_id" not in m.group(1), m.group(1)


def test_foreign_keys_are_dropped_before_the_unique_they_depend_on():
    """Second run: the composite FK already exists and depends on the unique
    index, so dropping the unique first fails with 'other objects depend on it'.
    These files are pasted by hand, where a double-paste is ordinary."""
    sql = _sql(M178)
    drop_fk = sql.find("DROP CONSTRAINT IF EXISTS class_assignments_lesson_cohort_fkey")
    drop_uq = sql.find("DROP CONSTRAINT IF EXISTS class_lessons_id_cohort_key")
    add_uq = sql.find("ADD CONSTRAINT class_lessons_id_cohort_key")
    add_fk = sql.find("ADD CONSTRAINT class_assignments_lesson_cohort_fkey")
    assert -1 not in (drop_fk, drop_uq, add_uq, add_fk)
    assert drop_fk < drop_uq, "the dependent FK must be dropped before the unique"
    assert add_uq < add_fk, "the unique must exist before the FK targets it"


def test_the_superseded_single_column_fk_is_removed():
    """Leaving mig 177's `class_assignments_lesson_id_fkey` in place would keep
    accepting the cross-cohort row this migration exists to reject."""
    assert (
        "DROP CONSTRAINT IF EXISTS class_assignments_lesson_id_fkey" in _sql(M178)
    )


def test_skill_check_covers_every_shipped_skill():
    m = re.search(
        r"skill\s+TEXT NOT NULL CHECK \(skill IN\s*\(([^)]*)\)", _sql(M177), re.I | re.S
    )
    assert m, "skill CHECK not found"
    values = {v.strip().strip("'") for v in m.group(1).split(",")}
    assert {"speaking", "writing", "reading", "listening"} <= values, values
