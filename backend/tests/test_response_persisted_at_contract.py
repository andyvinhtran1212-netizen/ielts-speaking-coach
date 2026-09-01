"""Canonical response persistence time must exist before evidence relies on it."""

from pathlib import Path


ROOT = Path(__file__).parents[1]
MIGRATION = (ROOT / "migrations" / "202_response_persisted_at.sql").read_text()
SESSIONS = (ROOT / "routers" / "sessions.py").read_text()


def test_migration_adds_server_authored_non_null_response_timestamp():
    assert "ADD COLUMN IF NOT EXISTS persisted_at" in MIGRATION
    assert "TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()" in MIGRATION
    assert "DROP COLUMN" not in MIGRATION


def test_session_receipt_exposes_canonical_persisted_at():
    receipt_block = SESSIONS[SESSIONS.index("response_receipts = ["):]
    receipt_block = receipt_block[:receipt_block.index("# Sealed 4-skill mock")]
    assert '"persisted_at": row.get("persisted_at")' in receipt_block
