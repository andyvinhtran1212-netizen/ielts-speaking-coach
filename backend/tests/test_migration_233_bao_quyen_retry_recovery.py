"""Static safety contract for the production-only Bao Quyen recovery."""

from pathlib import Path


SQL = (Path(__file__).parents[1] / "migrations"
       / "233_recover_bao_quyen_course_retries.sql").read_text()


def test_migration_is_tightly_scoped_to_the_two_audited_items():
    assert "0ef1abb9-b7db-4c45-ad29-04dc8eb52477" in SQL
    assert "8ce31e76-a81d-445c-9dc3-b41eb53bd2f5" in SQL
    assert "2094f802-05ee-4e9c-a2d8-267dfa0be052" in SQL
    assert "cardinality(target.session_ids)" in SQL
    assert "audited_sessions.total_questions = 90" in SQL
    assert "audited_sessions.total_correct = target.expected_correct" in SQL


def test_migration_only_opens_attempt_and_preserves_learning_evidence():
    update = SQL.split("UPDATE class_assignment_items AS item", 1)[1]
    assert "active_section_attempt_no" in update
    assert "section_attempt_pending" in update
    assert "section_attempt_started_at" in update
    assert "score =" not in update
    assert "passed_at =" not in update
    assert "submitted_at =" not in update
    assert "DELETE" not in SQL.upper()
    assert "TRUNCATE" not in SQL.upper()


def test_migration_is_idempotent_and_compare_and_swap_guarded():
    assert "active_section_attempt_no' IS NULL" in SQL
    assert "section_attempt_pending')::BOOLEAN" in SQL
    assert "item.updated_at = eligible.updated_at" in SQL
    assert "item.mastery -> 'attempts' -> -1 ->> 'next_action' = 'retry_full'" in SQL
