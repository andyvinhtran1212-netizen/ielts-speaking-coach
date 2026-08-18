"""Migration 220 keeps Dictation attempts resumable and renderer-sticky."""

from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "220_dictation_attempt_affinity.sql"
).read_text()


def test_dictation_attempt_schema_has_one_active_run_and_atomic_affinity():
    assert "CREATE TABLE IF NOT EXISTS public.dictation_attempts" in SQL
    assert "WHERE status = 'in_progress'" in SQL
    assert "renderer_affinity  TEXT DEFAULT 'legacy'" in SQL
    assert "units_snapshot     JSONB NOT NULL" in SQL
    assert "jsonb_array_length(units_snapshot) > 0" in SQL
    assert "CHECK (renderer_affinity IN ('legacy', 'next'))" in SQL
    assert "COALESCE(target.renderer_affinity, p_renderer_affinity)" in SQL
    assert "target.user_id = p_user_id" in SQL
    assert "target.status = 'in_progress'" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "TO service_role" in SQL


def test_dictation_answers_and_completion_are_canonically_linked():
    assert "CREATE TABLE IF NOT EXISTS public.dictation_attempt_answers" in SQL
    assert "PRIMARY KEY (attempt_id, sentence_idx)" in SQL
    assert "ADD COLUMN IF NOT EXISTS attempt_id UUID" in SQL
    assert "uq_dictation_sessions_attempt" in SQL
    assert "ENABLE ROW LEVEL SECURITY" in SQL
    assert "auth.uid() = user_id" in SQL
    assert "trg_guard_dictation_attempt_answer_mutation" in SQL
    assert "FOR UPDATE" in SQL
    assert "trg_finalize_dictation_attempt_from_session" in SQL
    assert "dictation_attempt_payload_mismatch" in SQL
    assert "UPDATE public.dictation_attempts" in SQL
