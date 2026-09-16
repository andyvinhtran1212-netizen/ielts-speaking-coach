from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "274_bound_timed_course_final_batch.sql"
).read_text(encoding="utf-8")


def test_final_batch_is_bounded_to_the_reaper_grace_window():
    terminal = SQL.index(
        "v_session.ended_at IS NOT NULL OR v_session.ended_by IS NOT NULL"
    )
    grace = SQL.index("v_cutoff + interval '15 seconds'")
    insert = SQL.index("INSERT INTO public.quiz_attempts")
    assert terminal < grace < insert
    assert "timed_course_final_batch_expired" in SQL


def test_lost_response_retry_returns_terminal_truth_before_the_grace_check():
    assert "RETURN NEXT v_session;\n        RETURN;" in SQL
    assert "FOR UPDATE;" in SQL


def test_replacement_keeps_the_atomic_insert_and_close_contract():
    assert "ON CONFLICT (client_id) DO NOTHING" in SQL
    assert "x.attempt_no, v_cutoff" in SQL
    assert "ended_at = v_cutoff" in SQL
    assert "ended_by = 'time_cap'" in SQL
    assert "TO service_role" in SQL
