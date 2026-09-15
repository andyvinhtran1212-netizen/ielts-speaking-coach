from pathlib import Path


SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "264_lock_timed_course_start_authorization.sql").read_text(encoding="utf-8")


def test_timed_start_transaction_locks_and_rechecks_every_live_access_fact():
    assert "CREATE OR REPLACE FUNCTION public.quiz_start_timed_course_session" in SQL
    assert "JOIN public.student_cohort_memberships AS scm" in SQL
    assert "scm.cohort_id = ca.cohort_id" in SQL
    assert "scm.is_active = TRUE" in SQL
    assert "FOR UPDATE OF cai, ca, scm" in SQL
    assert "v_now := clock_timestamp();" in SQL
    assert "v_status <> 'published'" in SQL
    assert "v_publish_at IS NOT NULL AND v_publish_at > v_now" in SQL
    assert "v_due_at IS NOT NULL AND v_due_at <= v_now" in SQL


def test_timed_start_rpc_remains_service_role_only():
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "TO service_role" in SQL
