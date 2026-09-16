from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "275_verify_terminal_timed_final_batch.sql"
).read_text(encoding="utf-8")


def test_terminal_retry_rejects_any_missing_submitted_client_id():
    terminal = SQL.index(
        "v_session.ended_at IS NOT NULL OR v_session.ended_by IS NOT NULL"
    )
    proof = SQL.index("timed_course_final_batch_missing")
    terminal_return = SQL.index("RETURN NEXT v_session;", terminal)

    assert terminal < proof < terminal_return
    assert "stored.session_id = p_session_id" in SQL
    assert "stored.user_id = p_user_id" in SQL
    assert "stored.client_id = submitted.client_id" in SQL


def test_terminal_retry_proof_and_reaper_are_serialized_on_the_session_row():
    lock = SQL.index("FOR UPDATE;")
    proof = SQL.index("timed_course_final_batch_missing")
    assert lock < proof


def test_replacement_preserves_the_bounded_atomic_close_contract():
    assert "v_cutoff + interval '15 seconds'" in SQL
    assert "ON CONFLICT (client_id) DO NOTHING" in SQL
    assert "ended_at = v_cutoff" in SQL
    assert "ended_by = 'time_cap'" in SQL
    assert "TO service_role" in SQL
