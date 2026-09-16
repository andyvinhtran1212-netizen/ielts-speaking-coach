from pathlib import Path


SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "265_timed_course_session_and_progress_boundary.sql").read_text(encoding="utf-8")


def test_concurrent_timed_start_returns_the_existing_open_run_session():
    assert "CREATE OR REPLACE FUNCTION public.quiz_start_timed_course_session" in SQL
    assert "SELECT qs.id" in SQL
    assert "qs.class_assignment_item_id = p_item_id" in SQL
    assert "qs.ended_at IS NULL" in SQL
    assert "qs.ended_by IS NULL" in SQL
    assert "RETURN QUERY SELECT v_session_id, v_opened_at" in SQL


def test_timed_progress_uses_one_admission_and_persisted_server_timestamp():
    assert "CREATE OR REPLACE FUNCTION public.quiz_insert_timed_course_attempts" in SQL
    assert "FOR UPDATE OF qs, cai, ca, scm" in SQL
    assert "v_accepted_at := clock_timestamp();" in SQL
    assert "<= v_accepted_at" in SQL
    assert "x.attempt_no, v_accepted_at" in SQL
    assert "ON CONFLICT (client_id) DO NOTHING" in SQL


def test_both_security_definer_rpcs_are_service_role_only_with_safe_search_path():
    assert SQL.count("SECURITY DEFINER") == 2
    assert SQL.count("SET search_path = public, pg_temp") == 2
    assert SQL.count("FROM PUBLIC, anon, authenticated") == 2
    assert SQL.count("TO service_role") == 2
