"""Static contract for the flashcard lost-ACK reliability migration."""

from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "212_flashcard_review_idempotency.sql"
).read_text(encoding="utf-8").lower()


def test_migration_is_additive_and_retry_identity_is_per_user():
    assert "add column if not exists client_review_id uuid" in SQL
    assert "create unique index if not exists" in SQL
    assert "on flashcard_review_log (user_id, client_review_id)" in SQL
    assert "where client_review_id is not null" in SQL
    executable = SQL.split("-- rollback (manual):", 1)[0]
    assert "drop table" not in executable
    assert "drop column" not in executable


def test_receipt_and_srs_mutation_share_one_transaction():
    assert "create or replace function fn_apply_srs_review_idempotent" in SQL
    assert "insert into flashcard_review_log" in SQL
    assert "on conflict (user_id, client_review_id)" in SQL
    assert "insert into flashcard_reviews" in SQL
    assert "'replayed', true" in SQL
    assert "'replayed', false" in SQL
    assert "already bound to different input" in SQL


def test_rpc_uses_caller_identity_and_is_not_public():
    assert "v_user_id uuid := auth.uid()" in SQL
    assert "set search_path = public, pg_temp" in SQL
    assert "revoke all on function fn_apply_srs_review_idempotent" in SQL
    assert "to authenticated" in SQL
