"""Migration 203 — race-safe anonymous Vocabulary report deduplication."""

from pathlib import Path


SQL = (
    Path(__file__).parents[1]
    / "migrations"
    / "203_anonymous_vocabulary_feedback_dedupe.sql"
).read_text(encoding="utf-8")


def test_migration_adds_a_server_only_dedupe_slot():
    assert "ADD COLUMN IF NOT EXISTS anonymous_dedupe_key TEXT" in SQL
    assert "skill = 'vocabulary'" in SQL
    assert "type = 'report'" in SQL
    assert "created_by IS NULL" in SQL


def test_migration_closes_parallel_insert_races_with_a_partial_unique_index():
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_anon_vocab_daily" in SQL
    assert "anonymous_dedupe_key IS NOT NULL" in SQL


def test_migration_is_additive_and_idempotent():
    upper = SQL.upper()
    assert "DROP TABLE" not in upper
    assert "DROP COLUMN" not in upper
    assert "ADD COLUMN IF NOT EXISTS" in upper
    assert "CREATE UNIQUE INDEX IF NOT EXISTS" in upper
