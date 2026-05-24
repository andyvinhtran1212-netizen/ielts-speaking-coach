"""
Sprint 14.8.1 — Codex audit P0/P1 fixes, source-level sentinels.

These pin the fixes at the source without a live database (the suite mocks
Supabase; CI has no Postgres — Andy decision 2026-05-24):

  F1  grading.py persists the off-topic / length / grammar signals into
      responses.feedback (built before the save, merged into the saved JSON).
  F2  migration 076 enables RLS + deny-client policies on the telemetry tables.
  F3  migration 077 de-dups responses then adds a partial UNIQUE index.
"""

from pathlib import Path

_BACKEND = Path(__file__).parent.parent
GRADING_PY = (_BACKEND / "routers" / "grading.py").read_text(encoding="utf-8")
MIG_076 = (_BACKEND / "migrations" / "076_telemetry_tables_rls.sql").read_text(encoding="utf-8")
MIG_077 = (_BACKEND / "migrations" / "077_responses_unique_session_question.sql").read_text(encoding="utf-8")


# ── F1: signal persistence in grading.py ───────────────────────────────────────

def test_f1_signals_dict_built_before_db_save():
    """The `signals` dict must be constructed before the feedback is serialised
    so it can be merged into the persisted row."""
    signals_idx = GRADING_PY.index("signals: dict = {")
    save_idx = GRADING_PY.index('db_row["feedback"]')
    assert signals_idx < save_idx, "signals must be built before the DB save (F1)"


def test_f1_saved_feedback_merges_signals():
    """The persisted feedback merges grading + signals (additive)."""
    assert 'json.dumps({**grading, **signals}' in GRADING_PY


def test_f1_signals_contains_all_five_persisted_fields():
    for field in (
        '"off_topic_verdict"',
        '"length_warning"',
        '"audio_duration_seconds"',
        '"length_soft_threshold"',
        '"grammar_check"',
    ):
        assert field in GRADING_PY, f"signals must carry {field} (F1 L2)"


def test_f1_signals_dict_defined_exactly_once():
    """The block was moved, not duplicated."""
    assert GRADING_PY.count("signals: dict = {") == 1


# ── F2: telemetry RLS migration 076 ─────────────────────────────────────────────

def test_f2_migration_enables_rls_on_both_tables():
    assert "ALTER TABLE grading_events ENABLE ROW LEVEL SECURITY" in MIG_076
    assert "ALTER TABLE grammar_check_cache ENABLE ROW LEVEL SECURITY" in MIG_076


def test_f2_migration_denies_client_roles():
    # Two deny policies, each scoped to anon + authenticated with USING (false).
    assert MIG_076.count("TO anon, authenticated") == 2
    assert MIG_076.count("USING (false)") == 2


# ── F3: responses uniqueness migration 077 ──────────────────────────────────────

def test_f3_migration_creates_partial_unique_index():
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_responses_session_question" in MIG_077
    assert "ON responses (session_id, question_id)" in MIG_077
    assert "WHERE session_id IS NOT NULL AND question_id IS NOT NULL" in MIG_077


def test_f3_migration_dedups_before_index_and_avoids_unknown_columns():
    """Dedup DELETE must precede the index, and must order only by guaranteed
    columns (feedback, id) — not created_at/updated_at, which the responses
    table is not guaranteed to have."""
    delete_idx = MIG_077.index("DELETE FROM responses")
    # Anchor on the full statement (the header comment also mentions the index).
    index_idx = MIG_077.index("CREATE UNIQUE INDEX IF NOT EXISTS uq_responses_session_question")
    assert delete_idx < index_idx, "dedup must run before the UNIQUE index"
    # Positive check: the ordering uses only guaranteed columns.
    assert "ORDER BY (feedback IS NOT NULL) DESC, id DESC" in MIG_077
    # And it must not ORDER BY the not-guaranteed timestamp columns.
    assert "updated_at DESC" not in MIG_077
    assert "created_at DESC" not in MIG_077
