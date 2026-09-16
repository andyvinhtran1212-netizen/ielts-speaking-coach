from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "277_close_unstarted_expired_course_retry.sql"
).read_text(encoding="utf-8")


def test_retry_closure_locks_before_proving_no_generation_and_writing_marker():
    lock = SQL.index("FOR UPDATE OF cai")
    session_proof = SQL.index("FROM public.quiz_sessions AS qs")
    marker = SQL.index("UPDATE public.class_assignment_items")
    assert lock < session_proof < marker
    assert "qs.created_at > v_latest_at" in SQL
    assert "section_attempt_pending" in SQL
    assert "section_attempt_started_at" in SQL


def test_retry_closure_rechecks_canonical_cutoff_and_terminal_receipt():
    assert "v_submitted_at IS NULL" in SQL
    assert "make_interval(mins => v_limit_minutes)" in SQL
    assert "COALESCE(v_due_at, 'infinity'::TIMESTAMPTZ)" in SQL
    assert "v_cutoff > clock_timestamp()" in SQL
    assert "timed_retry_closed_at" in SQL


def test_retry_closure_is_service_role_only():
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = public, pg_temp" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "TO service_role" in SQL
