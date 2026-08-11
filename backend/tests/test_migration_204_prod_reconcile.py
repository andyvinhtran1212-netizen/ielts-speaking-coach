"""Source contract for production schema reconciliation migration 204.

The production audit found a partially provisioned 173–203 range.  This guard
keeps the repair additive/idempotent and pins the four final contracts that must
exist before the historical ledger can be reconciled.
"""

from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "204_reconcile_course_and_gate_e_schema.sql"
).read_text(encoding="utf-8")


def test_pairing_constraint_fails_closed_before_validation():
    assert "class_assignment_items_artifact_pairing_violation" in SQL
    assert "(artifact_kind IS NULL) <> (artifact_id IS NULL)" in SQL
    assert "DROP CONSTRAINT IF EXISTS class_assignment_items_artifact_pairing" in SQL
    assert "ADD CONSTRAINT class_assignment_items_artifact_pairing" in SQL
    assert "VALIDATE CONSTRAINT class_assignment_items_artifact_pairing" in SQL


def test_full_test_identity_contract_is_reconciled():
    assert "ADD COLUMN IF NOT EXISTS full_test_attempt_id UUID" in SQL
    assert "WHERE mode = 'test_full'" in SQL
    assert "CREATE TRIGGER trg_sessions_full_test_attempt_id" in SQL
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_full_test_attempt_part" in SQL
    assert "CHECK (mode <> 'test_full' OR full_test_attempt_id IS NOT NULL)" in SQL


def test_session_create_retry_remains_idempotent_and_conflict_safe():
    assert "CREATE OR REPLACE FUNCTION fn_create_session_daily_capped_v2(" in SQL
    assert "pg_advisory_xact_lock(hashtext(p_session_id::text)::bigint)" in SQL
    assert "RAISE EXCEPTION 'session_id_conflict'" in SQL
    assert "RETURN NEXT v_existing" in SQL
    assert "RAISE EXCEPTION 'daily_quota_exceeded'" in SQL


def test_response_timestamp_is_server_authored_and_stable():
    assert (
        "ADD COLUMN IF NOT EXISTS persisted_at TIMESTAMP WITH TIME ZONE "
        "NOT NULL DEFAULT NOW()"
    ) in SQL


def test_reconciliation_is_atomic_and_does_not_drop_schema():
    assert SQL.count("BEGIN;") == 1
    assert SQL.count("COMMIT;") == 1
    assert "DROP TABLE" not in SQL
    assert "DROP COLUMN" not in SQL
