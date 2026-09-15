from pathlib import Path


SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "268_guard_assigned_assessment_replacement.sql").read_text(encoding="utf-8")


def test_replacement_locks_bank_then_rejects_assignment_or_session_history():
    lock_at = SQL.index("FOR UPDATE")
    assignment_at = SQL.index("FROM public.class_assignments", lock_at)
    session_at = SQL.index("FROM public.quiz_sessions", assignment_at)
    replace_at = SQL.index("v_written := public.quiz_replace_questions", session_at)
    assert lock_at < assignment_at < session_at < replace_at
    assert "course_assessment_bank_in_use" in SQL


def test_guarded_replacement_remains_private_and_transactional():
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = public, pg_temp" in SQL
    assert "is_published = FALSE" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "TO service_role" in SQL
