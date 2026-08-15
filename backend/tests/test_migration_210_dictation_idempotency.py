"""Migration 210 — retry-safe Listening Dictation completion receipts."""

from pathlib import Path


SQL = (
    Path(__file__).parents[1]
    / "migrations"
    / "210_dictation_session_idempotency.sql"
).read_text(encoding="utf-8")


def test_migration_adds_receipt_and_payload_binding_columns():
    assert "ADD COLUMN IF NOT EXISTS client_request_id UUID" in SQL
    assert "ADD COLUMN IF NOT EXISTS submission_fingerprint TEXT" in SQL


def test_migration_closes_parallel_retry_races_per_learner():
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_dictation_sessions_user_client_request" in SQL
    assert "(user_id, client_request_id)" in SQL
    assert "WHERE client_request_id IS NOT NULL" in SQL


def test_migration_is_forward_only_and_idempotent():
    upper = SQL.upper()
    assert "DROP TABLE" not in upper
    assert "DROP COLUMN" not in upper
    assert "ADD COLUMN IF NOT EXISTS" in upper
    assert "CREATE UNIQUE INDEX IF NOT EXISTS" in upper
