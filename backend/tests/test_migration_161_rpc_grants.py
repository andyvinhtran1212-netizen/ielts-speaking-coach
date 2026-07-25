"""Migration 161 — fn_upsert_listening_answer must be backend-only.

Codex review on PR #838 (P1, correct): the function is SECURITY DEFINER, and
PostgreSQL grants EXECUTE on a new function to PUBLIC by default. Without an
explicit REVOKE it is callable straight through PostgREST by any `anon` /
`authenticated` client — which bypasses BOTH listening_test_attempts' RLS and
the router's ownership + q_num validation, so anyone holding an in-progress
attempt UUID could overwrite someone else's answers.

Scoped to this one migration on purpose. A blanket "every SECURITY DEFINER
function is revoked" lint would fail on migrations 033/042/106, which are
hardened retroactively by 108/160 rather than in place — so it would report
false positives instead of protecting anything.
"""

from __future__ import annotations

import re
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations" / "161_fn_upsert_listening_answer.sql"
)
FN = "fn_upsert_listening_answer"


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_migration_exists():
    assert MIGRATION.is_file(), f"missing {MIGRATION}"


def test_function_is_security_definer():
    # If this ever stops being SECURITY DEFINER the grant requirement changes,
    # so the assertion below would be guarding nothing.
    assert re.search(r"SECURITY\s+DEFINER", _sql(), re.I)


def test_execute_is_revoked_from_client_roles():
    sql = _sql()
    revoke = re.search(
        rf"REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+[\w.]*{FN}\s*\([^)]*\)\s*FROM\s+([^;]+);",
        sql, re.I | re.S,
    )
    assert revoke, "no REVOKE EXECUTE for the function — it is PUBLIC by default"
    roles = revoke.group(1).lower()
    for role in ("public", "anon", "authenticated"):
        assert role in roles, f"EXECUTE still reachable by {role}"


def test_execute_is_granted_to_service_role():
    """The backend calls this through supabase_admin; revoking without granting
    would break every Listening answer save instead of securing it."""
    assert re.search(
        rf"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[\w.]*{FN}\s*\([^)]*\)\s*TO\s+service_role",
        _sql(), re.I | re.S,
    )


def test_revoke_precedes_nothing_that_regrants_public():
    """A later GRANT ... TO PUBLIC in the same file would silently undo it."""
    assert not re.search(
        rf"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[\w.]*{FN}[^;]*TO\s+(PUBLIC|anon|authenticated)",
        _sql(), re.I | re.S,
    )
