"""migration 181 — hàm xoá bài giao phải nói CÙNG một luật với Python.

`fn_delete_class_assignment_if_unsubmitted` and `reconcile_test_attempts()` both
decide "has this Reading/Listening homework been handed in?". They read the same
two tables and they must agree, because a disagreement is visible and confusing
in exactly one direction each way:

  * SQL stricter than Python → the tab shows "0 đã nộp" with a delete button
    that answers 409. The admin is told someone submitted while the screen says
    nobody did.
  * SQL looser than Python  → the delete succeeds and ON DELETE CASCADE takes
    the item with it. That is the outcome the whole guard exists to prevent.

So the four conditions are pinned here as text. A structural test cannot run
plpgsql, but it can stop the two implementations drifting silently — which is
how they would drift, since nothing else connects them.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from tests.test_migration_175_178_class_model import _strip_comments

# 182 REPLACES the function 181 defines, so the live definition — the one these
# rules must hold for — is 182's.
MIG = Path(__file__).resolve().parents[1] / "migrations" / \
    "182_class_assignments_attempts_from.sql"


@pytest.fixture(scope="module")
def sql() -> str:
    assert MIG.is_file(), f"missing {MIG.name}"
    return _strip_comments(MIG.read_text(encoding="utf-8"))


def test_the_guard_reads_both_attempt_tables(sql):
    for table in ("reading_test_attempts", "listening_test_attempts"):
        assert table in sql, f"{table} is evidence of a hand-in and must be read"


def test_the_attempt_rows_are_locked_before_they_are_read(sql):
    """Same reason mig 180 locks sessions: an in-flight submit has to wait for
    us rather than slip between the read and the DELETE."""
    assert len(re.findall(r"FOR\s+UPDATE\s+OF\s+r\b", sql, re.I)) >= 1
    assert len(re.findall(r"FOR\s+UPDATE\s+OF\s+l\b", sql, re.I)) >= 1


def test_the_lower_bound_is_the_later_of_created_and_published(sql):
    """created_at alone counts work done while the give was still hidden."""
    assert re.search(r"COALESCE\s*\(\s*a\.attempts_from", sql, re.I), (
        "the stored cutoff is the answer — it is the only one that survives an "
        "archive-then-republish"
    )
    assert re.search(r"GREATEST\s*\(\s*a\.created_at\s*,\s*COALESCE\s*\(\s*a\.publish_at",
                     sql, re.I), "pre-182 rows still need the old formula"
    assert not re.search(r"submitted_at\s*>=\s*v_created_at", sql, re.I), (
        "the raw created_at must not remain as the cutoff"
    )


def test_an_attempt_spent_on_a_sibling_give_is_not_evidence_here(sql):
    """reconcile_test_attempts() credits one attempt once, oldest give first.
    Without this the later give reads as submitted to SQL and unsubmitted to
    Python."""
    hits = re.findall(
        r"NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+class_assignment_items\s+i2\b",
        sql, re.I | re.S,
    )
    assert len(hits) == 2, "both the reading and the listening branch need it"
    assert len(re.findall(r"i2\.assignment_id\s*<>\s*p_assignment_id", sql, re.I)) == 2


def test_only_this_class_and_only_submitted_attempts_count(sql):
    assert len(re.findall(r"st\.cohort_id\s*=\s*p_cohort_id", sql, re.I)) >= 2
    assert len(re.findall(r"status\s*=\s*'submitted'", sql, re.I)) >= 2


def test_the_earlier_two_kinds_of_evidence_survive(sql):
    """181 REPLACES the function. Dropping what 180 added would reopen the
    Speaking hole while closing the Reading one."""
    assert "s.status = 'completed'" in sql, "a completed session is still evidence"
    assert "i.submitted_at IS NOT NULL" in sql, "the recorded hand-in is still evidence"


def test_speaking_gives_are_not_dragged_into_the_attempt_check(sql):
    """Speaking has no content_id; an unguarded branch would compare NULL and
    quietly change behaviour for the skill this migration is not about."""
    assert len(re.findall(r"v_content_id\s+IS\s+NOT\s+NULL", sql, re.I)) >= 4


def test_the_guard_only_counts_attempts_by_students_still_in_this_class(sql):
    """A transferred learner keeps their old items. Counting their new work as
    evidence for the old class would make that give undeletable on the strength
    of a hand-in that belongs somewhere else."""
    assert len(re.findall(r"st\.cohort_id\s*=\s*p_cohort_id", sql, re.I)) >= 4, (
        "both the lock and the EXISTS branch, for both skills"
    )


def test_an_older_give_of_the_same_paper_claims_the_attempt_first(sql):
    """reconcile_test_attempts() hands an attempt to the OLDEST give still owed.
    Without the same rule here, an attempt landing between the router's repair
    and this call reads as evidence for the give being deleted — so the screen
    says "0 đã nộp" and the delete answers 409."""
    hits = re.findall(
        r"NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+class_assignments\s+a2\b",
        sql, re.I | re.S,
    )
    assert len(hits) == 2, "both the reading and the listening branch need it"
    assert len(re.findall(r"i3\.submitted_at\s+IS\s+NULL", sql, re.I)) == 2, (
        "only a give that is still OWED can claim it"
    )


def test_the_column_is_added_and_backfilled_before_the_function_reads_it(sql):
    """A function reading a column that does not exist yet fails on first call,
    not at deploy — so ordering inside the file is the whole guarantee."""
    add = sql.index("ADD COLUMN IF NOT EXISTS attempts_from")
    backfill = sql.index("SET attempts_from = GREATEST")
    read = sql.index("COALESCE(a.attempts_from")
    assert add < backfill < read


def test_content_id_is_compared_as_a_uuid_not_as_text(sql):
    """class_assignments.content_id is UUID (mig 177). Declaring the local as
    text worked while every comparison went through `::text`; the sibling-give
    check compares against the COLUMN, and Postgres has no `uuid = text`
    operator — the function raises at RUN time, not at apply time, so nothing
    about applying the migration would reveal it."""
    assert re.search(r"v_content_id\s+uuid\s*;", sql, re.I), (
        "declare it as the column's own type"
    )
    assert not re.search(r"::text\s*=\s*v_content_id", sql, re.I), (
        "a cast on one side only papers over the mismatch"
    )


def test_a_scheduled_give_starts_counting_at_reveal_not_at_creation(sql):
    """A column DEFAULT cannot see publish_at, so without this a scheduled give
    would start counting the moment its row is written — the hidden-window hole
    the column exists to close."""
    assert "CREATE TRIGGER set_class_assignment_attempts_from" in sql
    assert re.search(r"BEFORE\s+INSERT\s+ON\s+class_assignments", sql, re.I)
    trig = sql[sql.index("FUNCTION fn_class_assignment_attempts_from"):]
    assert re.search(r"GREATEST\s*\(", trig, re.I), "reveal time must win"
    assert "NEW.publish_at" in trig
