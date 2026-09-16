from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "273_atomic_timed_course_timeout_close.sql"
).read_text(encoding="utf-8")


def test_timeout_close_locks_the_session_before_writing_any_final_answers():
    lock = SQL.index("FOR UPDATE;")
    insert = SQL.index("INSERT INTO public.quiz_attempts")
    close = SQL.index("UPDATE public.quiz_sessions")
    assert lock < insert < close
    assert "v_session.ended_at IS NOT NULL OR v_session.ended_by IS NOT NULL" in SQL


def test_final_attempts_and_time_cap_close_share_one_function_transaction():
    assert "ON CONFLICT (client_id) DO NOTHING" in SQL
    assert "x.client_id IS NOT NULL" in SQL
    assert "x.attempt_no, v_cutoff" in SQL
    assert "ended_at = v_cutoff" in SQL
    assert "ended_by = 'time_cap'" in SQL


def test_only_an_expired_owned_timed_course_session_can_use_the_envelope():
    assert "qs.user_id = p_user_id" in SQL
    assert "ca.skill = 'course'" in SQL
    assert "ca.content_id = v_session.bank_id" in SQL
    assert "IF v_cutoff > v_now" in SQL
    assert "timed_course_finalize_not_expired" in SQL
    assert "TO service_role" in SQL
