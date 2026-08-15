"""Static contract for migration 211 — safe to run without a live database."""

from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "211_d1_attempt_session_reliability.sql"
).read_text(encoding="utf-8").lower()


def test_migration_is_additive_and_idempotent():
    assert "add column if not exists client_attempt_id uuid" in SQL
    assert "add column if not exists exercise_snapshot jsonb" in SQL
    assert "create unique index if not exists" in SQL
    executable = SQL.split("-- rollback (manual):", 1)[0]
    assert "drop table" not in executable
    assert "drop column" not in executable


def test_idempotency_is_scoped_to_one_user_and_ignores_legacy_nulls():
    assert "on vocabulary_exercise_attempts (user_id, client_attempt_id)" in SQL
    assert "where client_attempt_id is not null" in SQL


def test_session_snapshot_remains_nullable_for_historical_rows():
    alter = SQL.split("alter table d1_sessions", 1)[1].split(";", 1)[0]
    assert "not null" not in alter
    assert "default" not in alter
