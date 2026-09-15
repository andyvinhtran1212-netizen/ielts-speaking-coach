from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "276_reject_late_timed_course_answers.sql"
).read_text(encoding="utf-8")


def test_timeout_finalizer_is_verification_only():
    assert "INSERT INTO public.quiz_attempts" not in SQL
    assert "timed_course_final_batch_missing" in SQL
    assert "stored.session_id = p_session_id" in SQL
    assert "stored.user_id = p_user_id" in SQL
    assert "stored.client_id = submitted.client_id" in SQL


def test_missing_proof_is_rejected_before_open_or_terminal_success():
    lock = SQL.index("FOR UPDATE;")
    proof = SQL.index("timed_course_final_batch_missing")
    terminal = SQL.index(
        "v_session.ended_at IS NOT NULL OR v_session.ended_by IS NOT NULL"
    )
    assert lock < proof < terminal


def test_timeout_score_is_derived_only_from_canonical_attempts():
    aggregate = SQL.index("FROM public.quiz_attempts AS qa")
    update = SQL.index("UPDATE public.quiz_sessions")
    assert aggregate < update
    assert "total_questions = v_total" in SQL
    assert "total_correct = v_correct" in SQL
    assert "total_wrong = v_total - v_correct" in SQL
    assert "p_summary ->> 'total_correct'" not in SQL
    assert "ended_at = v_cutoff" in SQL
    assert "ended_by = 'time_cap'" in SQL
    assert "TO service_role" in SQL
