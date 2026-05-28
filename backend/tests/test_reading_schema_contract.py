"""Schema contract tests for the Sprint 20.1 Reading foundation (cluster 20.x).

There is no live DB in the test environment (mirrors test_content_import.py,
which mocks supabase). So this "migration sentinel" parses the reading
migration SQL and pins the table/column/CHECK/RLS shape — the same pattern as
test_speaking_schema_contract.py (anti-pattern #37 prevention). It catches:
a renamed table, a dropped column the future grader/router will SELECT, a
skill_tag/question_type CHECK that drifts from the D2 enum / content spec, or a
missing RLS policy on the user-scoped attempt table.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_MIGRATIONS = Path(__file__).parent.parent / "migrations"
_M086 = _MIGRATIONS / "086_reading_module_foundation.sql"
_M087 = _MIGRATIONS / "087_reading_test_attempts.sql"


def _all_sql() -> str:
    return _M086.read_text(encoding="utf-8") + "\n" + _M087.read_text(encoding="utf-8")


def _create_table_block(sql: str, table: str) -> str:
    """Return the parenthesised body of `CREATE TABLE [IF NOT EXISTS] <table> ( … )`."""
    m = re.search(
        rf"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+{re.escape(table)}\s*\((.*?)\n\);",
        sql, re.IGNORECASE | re.DOTALL,
    )
    assert m, f"CREATE TABLE for `{table}` not found"
    return m.group(1)


# ── Files exist + idempotent + contiguous numbering ───────────────────


def test_migration_files_exist():
    assert _M086.exists(), "086_reading_module_foundation.sql missing"
    assert _M087.exists(), "087_reading_test_attempts.sql missing"


def test_migrations_are_idempotent():
    sql = _all_sql()
    # Every reading table is created with IF NOT EXISTS (forward-only, re-runnable).
    for table in ("reading_tests", "reading_passages", "reading_questions",
                  "reading_test_attempts"):
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{table}\b", sql, re.IGNORECASE
        ), f"{table} not created IF NOT EXISTS"


def test_numbering_is_contiguous_from_085():
    # 086/087 exist; the next slot (088) must not yet (avoids a numbering gap).
    assert not (_MIGRATIONS / "088_reading_module_foundation.sql").exists()
    nums = sorted(int(p.name[:3]) for p in _MIGRATIONS.glob("0*.sql")
                  if p.name[:3].isdigit())
    assert 86 in nums and 87 in nums
    assert max(nums) == 87, f"unexpected migrations beyond 087: {nums}"


# ── reading_passages ──────────────────────────────────────────────────


def test_reading_passages_has_expected_columns():
    block = _create_table_block(_all_sql(), "reading_passages")
    expected = {
        "id", "library", "slug", "title", "body_markdown", "difficulty_level",
        "topic_tags", "image_url", "image_public_id", "glossary", "skill_focus",
        "test_id", "passage_order", "word_count", "estimated_minutes",
        "metadata", "status", "created_by", "created_at", "updated_at",
    }
    cols = {m.group(1) for m in re.finditer(r"^\s{4}([a-z_]+)\s", block, re.MULTILINE)}
    missing = expected - cols
    assert not missing, f"reading_passages missing columns: {missing}"


def test_reading_passages_library_check_values():
    block = _create_table_block(_all_sql(), "reading_passages")
    for v in ("l1_vocab", "l2_skill", "l3_test"):
        assert f"'{v}'" in block, f"library CHECK missing {v}"


def test_reading_passages_difficulty_check_values():
    block = _create_table_block(_all_sql(), "reading_passages")
    for v in ("foundation", "intermediate", "advanced"):
        assert f"'{v}'" in block, f"difficulty_level CHECK missing {v}"


def test_reading_passages_slug_unique_and_test_fk():
    block = _create_table_block(_all_sql(), "reading_passages")
    assert re.search(r"slug\s+TEXT\s+UNIQUE", block, re.IGNORECASE), "slug not UNIQUE"
    assert re.search(r"test_id\s+UUID\s+REFERENCES\s+reading_tests", block, re.IGNORECASE)


# ── reading_questions ─────────────────────────────────────────────────


def test_reading_questions_has_answer_and_passage_fk():
    block = _create_table_block(_all_sql(), "reading_questions")
    assert re.search(r"passage_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+reading_passages",
                     block, re.IGNORECASE), "passage_id FK missing"
    assert re.search(r"\banswer\s+JSONB", block, re.IGNORECASE), "answer column missing"
    assert "UNIQUE (passage_id, q_num)" in block


def test_reading_questions_skill_tag_matches_d2_enum():
    block = _create_table_block(_all_sql(), "reading_questions")
    d2 = ("skimming", "scanning", "detail", "main_idea", "inference",
          "vocabulary_in_context", "reference_cohesion", "writer_view_TFNG")
    for tag in d2:
        assert f"'{tag}'" in block, f"skill_tag CHECK missing {tag}"


def test_reading_questions_type_check_covers_phase1():
    block = _create_table_block(_all_sql(), "reading_questions")
    phase1 = ("mcq_single", "true_false_not_given", "yes_no_not_given",
              "sentence_completion", "summary_completion", "short_answer",
              "matching_headings")
    for t in phase1:
        assert f"'{t}'" in block, f"question_type CHECK missing Phase 1 type {t}"


# ── reading_tests ─────────────────────────────────────────────────────


def test_reading_tests_module_and_unique_test_id():
    block = _create_table_block(_all_sql(), "reading_tests")
    assert re.search(r"test_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE", block, re.IGNORECASE)
    for v in ("academic", "general_training"):
        assert f"'{v}'" in block, f"module CHECK missing {v}"


# ── reading_test_attempts (RLS) ───────────────────────────────────────


def test_attempts_has_rls_policy():
    sql = _M087.read_text(encoding="utf-8")
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "user_id = auth.uid()" in sql
    assert re.search(r"CREATE\s+POLICY", sql, re.IGNORECASE)


def test_attempts_status_and_grading_columns():
    block = _create_table_block(_all_sql(), "reading_test_attempts")
    for v in ("in_progress", "submitted", "abandoned"):
        assert f"'{v}'" in block, f"status CHECK missing {v}"
    for col in ("answers", "score", "grading_details", "skill_breakdown",
                "band_estimate", "started_at", "submitted_at"):
        assert re.search(rf"\b{col}\b", block), f"attempts missing {col}"


def test_attempts_test_and_user_fks():
    block = _create_table_block(_all_sql(), "reading_test_attempts")
    assert re.search(r"test_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+reading_tests",
                     block, re.IGNORECASE)
    assert re.search(r"user_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+users",
                     block, re.IGNORECASE)
