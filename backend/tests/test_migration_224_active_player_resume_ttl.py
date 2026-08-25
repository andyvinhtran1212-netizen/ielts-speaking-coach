from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "224_active_player_resume_ttl.sql"
).read_text()
VERIFY_SQL = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "verify_active_player_ttl_224.sql"
).read_text()


def test_migration_adds_all_canonical_expiry_contracts_and_indexes():
    for table in (
        "public.sessions",
        "public.reading_test_attempts",
        "public.listening_test_attempts",
        "public.dictation_attempts",
    ):
        assert f"ALTER TABLE {table}" in SQL
    assert SQL.count("ADD COLUMN IF NOT EXISTS resume_expires_at TIMESTAMPTZ") == 4
    assert SQL.count("ALTER COLUMN resume_expires_at DROP DEFAULT") == 4
    assert SQL.count("INTERVAL '24 hours'") >= 9
    assert SQL.count("resume_expires_at <= started_at + INTERVAL '24 hours'") == 3
    assert (
        "resume_expires_at <= COALESCE(started_at, created_at)\n"
        "                                      + INTERVAL '24 hours'"
    ) in SQL
    assert SQL.count("resume_expiry_within_ttl") == 8
    assert "ix_sessions_active_resume_expiry" in SQL
    assert "ix_reading_attempts_active_resume_expiry" in SQL
    assert "ix_listening_attempts_active_resume_expiry" in SQL
    assert "ix_dictation_attempts_active_resume_expiry" in SQL


def test_n_minus_one_inserts_derive_expiry_from_the_persisted_row_anchor():
    assert "fn_set_active_player_resume_expiry" in SQL
    assert "IF NEW.resume_expires_at IS NULL" in SQL
    assert "COALESCE(NEW.started_at, NEW.created_at)" in SQL
    assert "NEW.resume_expires_at := NEW.started_at + INTERVAL '24 hours'" in SQL
    for trigger in (
        "trg_set_session_resume_expiry",
        "trg_set_reading_attempt_resume_expiry",
        "trg_set_listening_attempt_resume_expiry",
        "trg_set_dictation_attempt_resume_expiry",
    ):
        assert trigger in SQL


def test_migration_guards_claim_and_atomic_answer_writes_after_expiry():
    assert SQL.count("active_player_expired") >= 10
    assert "fn_guard_speaking_question_mutation" in SQL
    assert "trg_guard_speaking_question_mutation" in SQL
    assert "fn_guard_speaking_response_mutation" in SQL
    assert "trg_guard_speaking_response_mutation" in SQL
    assert "NEW.audio_storage_path IS DISTINCT FROM OLD.audio_storage_path" in SQL
    assert "NEW.raw_transcript_text IS DISTINCT FROM OLD.raw_transcript_text" in SQL
    assert "fn_guard_reading_attempt_answer_mutation" in SQL
    assert "fn_upsert_listening_answer" in SQL
    assert "fn_insert_listening_answer_once" in SQL
    assert "fn_guard_dictation_attempt_answer_mutation" in SQL
    assert "fn_guard_dictation_session_completion" in SQL
    assert "trg_00_guard_dictation_session_completion" in SQL
    assert "fn_guard_active_player_terminal_mutation" in SQL
    for trigger in (
        "trg_guard_session_terminal_mutation",
        "trg_guard_reading_attempt_terminal_mutation",
        "trg_guard_listening_attempt_terminal_mutation",
        "trg_guard_writing_assignment_terminal_mutation",
    ):
        assert trigger in SQL
    assert "active_player_state_conflict" in SQL
    assert "links_learner_artifact" in SQL
    assert "to_jsonb(NEW)->>'essay_id'" in SQL
    assert SQL.count("BEFORE UPDATE OF status") == 4
    assert SQL.count("resume_expires_at > now()") >= 7


def test_writing_uses_a_reclaimable_lease_and_preserves_assignment_data():
    assert "renderer_affinity_claimed_at TIMESTAMPTZ" in SQL
    assert "renderer_affinity_expires_at TIMESTAMPTZ" in SQL
    assert "target.renderer_affinity_expires_at <= now()" in SQL
    assert "THEN p_renderer_affinity ELSE target.renderer_affinity END" in SQL
    assert "fn_guard_writing_draft_mutation" in SQL
    assert "trg_guard_writing_draft_mutation" in SQL
    assert "parent_student_id IS DISTINCT FROM NEW.student_id" in SQL
    assert "parent_affinity IS NULL AND parent_expiry IS NULL" in SQL
    assert "RETURNING renderer_affinity_expires_at INTO parent_expiry" in SQL
    assert "DELETE FROM" not in SQL.upper()
    assert "DROP TABLE" not in SQL.upper()
    assert "DROP COLUMN" not in SQL.upper()


def test_read_only_verifier_covers_every_224_postcondition_layer():
    for token in (
        "column-contract:",
        "column-default-must-be-triggered:",
        "constraint-contract:",
        "index-contract:",
        "function-security:",
        "function-body:",
        "function-acl:",
        "trigger-contract:",
        "data:resume-expiry-outside-hard-ttl",
        "data:writing-renderer-lease-invalid",
    ):
        assert token in VERIFY_SQL
    assert "verified active-player TTL migration contract 224" in VERIFY_SQL
    assert "con.conrelid = to_regclass" in VERIFY_SQL
    assert "idx.indrelid = to_regclass" in VERIFY_SQL
    assert "pg_get_triggerdef(trg.oid)" in VERIFY_SQL
    assert "BEFORE INSERT OR UPDATE" in VERIFY_SQL
    assert "trg_00_guard_dictation_session_completion" in VERIFY_SQL
    assert "trg_guard_session_terminal_mutation" in VERIFY_SQL
    assert "trg_guard_reading_attempt_terminal_mutation" in VERIFY_SQL
    assert "trg_guard_listening_attempt_terminal_mutation" in VERIFY_SQL
    assert "trg_guard_writing_assignment_terminal_mutation" in VERIFY_SQL
    assert "fn_guard_active_player_terminal_mutation" in VERIFY_SQL
    assert "BEFORE UPDATE OF status" in VERIFY_SQL

    import re

    statements = re.sub(r"--[^\n]*", "", VERIFY_SQL)
    assert not re.search(
        r"^\s*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|"
        r"GRANT|REVOKE)\b",
        statements,
        flags=re.IGNORECASE | re.MULTILINE,
    )
