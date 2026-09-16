from pathlib import Path


SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "266_allow_timed_course_retry_start.sql").read_text(encoding="utf-8")


def test_failed_submitted_items_remain_retryable_but_passed_items_do_not():
    assert "cai.passed_at" in SQL
    assert "v_passed_at IS NOT NULL" in SQL
    assert "cai.submitted_at" not in SQL
    assert "v_submitted_at" not in SQL


def test_open_run_reuse_is_scoped_to_the_current_full_retry_generation():
    assert "section_attempt_started_at" in SQL
    assert "qs.created_at >= v_generation_started_at" in SQL
    assert "RETURN QUERY SELECT v_session_id, v_opened_at" in SQL


def test_redefined_start_rpc_remains_backend_only():
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = public, pg_temp" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "TO service_role" in SQL
