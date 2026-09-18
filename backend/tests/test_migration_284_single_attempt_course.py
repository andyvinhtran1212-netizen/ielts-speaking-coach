"""Static guardrails for the single-attempt database boundary."""

from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "284_single_attempt_course_assignments.sql"
).read_text(encoding="utf-8")
GRANT_FIX_SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "285_lock_single_attempt_guard_functions.sql"
).read_text(encoding="utf-8")


def test_single_attempt_migration_guards_sessions_and_answers():
    assert "BEFORE INSERT ON public.quiz_sessions" in SQL
    assert "BEFORE INSERT ON public.quiz_attempts" in SQL
    assert "FOR UPDATE OF cai, ca" in SQL
    assert "completion_mode" in SQL
    assert "single_attempt_course_retake_forbidden" in SQL
    assert "single_attempt_course_session_closed" in SQL
    assert "single_attempt_course_answer_closed" in SQL


def test_mastery_assignments_are_explicitly_left_unchanged():
    assert "v_mode IS DISTINCT FROM 'single_attempt'" in SQL
    assert SQL.count("RETURN NEW;") >= 4


def test_trigger_only_functions_are_not_directly_callable_by_postgrest_roles():
    assert "guard_single_attempt_course_session()" in GRANT_FIX_SQL
    assert "guard_single_attempt_course_answer()" in GRANT_FIX_SQL
    assert "FROM PUBLIC, anon, authenticated" in GRANT_FIX_SQL
