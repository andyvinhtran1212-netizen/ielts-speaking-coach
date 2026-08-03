"""migration 181 — cột nối lượt làm đề với mục bài tập lớp.

The column replaces an inference engine. These assertions guard the properties
that make it safe to trust, and the two that an ordinary `ADD COLUMN` would get
wrong here.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from tests.test_migration_175_178_class_model import _strip_comments

MIG = Path(__file__).resolve().parents[1] / "migrations" / \
    "181_test_attempts_class_link.sql"


@pytest.fixture(scope="module")
def sql() -> str:
    assert MIG.is_file(), f"missing {MIG.name}"
    return _strip_comments(MIG.read_text(encoding="utf-8"))


def test_both_attempt_tables_get_the_link(sql):
    for table in ("reading_test_attempts", "listening_test_attempts"):
        assert re.search(
            rf"ALTER\s+TABLE\s+{table}\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"
            r"class_assignment_item_id", sql, re.I,
        ), f"{table} needs the link too"


def test_deleting_a_give_does_not_delete_the_students_work(sql):
    """ON DELETE CASCADE here would erase a learner's attempt because a teacher
    removed the homework. The work is theirs, not the class's."""
    assert len(re.findall(r"ON\s+DELETE\s+SET\s+NULL", sql, re.I)) == 2
    assert not re.search(r"class_assignment_items\s*\(\s*id\s*\)\s*ON\s+DELETE\s+CASCADE",
                         sql, re.I)


def test_the_link_is_not_unique(sql):
    """The test pages allow a retake, so one item legitimately carries several
    attempts — a UNIQUE constraint would make "làm lại" fail at the insert."""
    assert not re.search(r"UNIQUE[^\n]*class_assignment_item_id", sql, re.I)
    assert not re.search(r"CREATE\s+UNIQUE\s+INDEX[^;]*class_assignment_item_id",
                         sql, re.I | re.S)


def test_the_index_is_partial(sql):
    """Almost every attempt ever made is free practice and carries NULL; the
    repair path only ever asks for the class ones."""
    hits = re.findall(r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS[^;]*?"
                      r"WHERE\s+class_assignment_item_id\s+IS\s+NOT\s+NULL",
                      sql, re.I | re.S)
    assert len(hits) == 2


def test_the_delete_guard_reads_the_link_not_the_clock(sql):
    """The point of the redesign: evidence is a join. Any reappearance of a
    time or paper comparison here means it is guessing again."""
    for banned in ("attempts_from", "GREATEST", "submitted_at >=", "content_id"):
        assert banned not in sql, f"{banned} belongs to the inference version"
    assert len(re.findall(r"r\.class_assignment_item_id\s*=\s*i\.id", sql, re.I)) >= 1
    assert len(re.findall(r"l\.class_assignment_item_id\s*=\s*i\.id", sql, re.I)) >= 1


def test_the_attempt_rows_are_locked_before_they_are_read(sql):
    """Same reason mig 180 locks sessions: an in-flight submit must wait for the
    delete transaction rather than slip between the read and the DELETE."""
    assert re.search(r"FOR\s+UPDATE\s+OF\s+r\b", sql, re.I)
    assert re.search(r"FOR\s+UPDATE\s+OF\s+l\b", sql, re.I)


def test_the_earlier_two_kinds_of_evidence_survive(sql):
    """181 REPLACES the function. Dropping what 180 added would reopen the
    Speaking hole while closing the Reading one."""
    assert "s.status = 'completed'" in sql
    assert "i.submitted_at IS NOT NULL" in sql
