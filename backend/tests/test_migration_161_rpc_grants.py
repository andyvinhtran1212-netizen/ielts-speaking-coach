"""The listening-answer write RPCs must be backend-only.

Codex review on PR #838 (P1, correct): the function is SECURITY DEFINER, and
PostgreSQL grants EXECUTE on a new function to PUBLIC by default. Without an
explicit REVOKE it is callable straight through PostgREST by any `anon` /
`authenticated` client — which bypasses BOTH listening_test_attempts' RLS and
the router's ownership + q_num validation, so anyone holding an in-progress
attempt UUID could overwrite someone else's answers.

Covers migration 161 (fn_upsert_listening_answer, the exam answer save) and its
migration 174 sibling (fn_insert_listening_answer_once, the first-attempt-wins
write behind the Luyện nhanh runner). 174 needs the same lock for a sharper
reason: it is the only thing making a practice score mean anything, so a client
able to call it directly could append a "first" answer of its choosing.

Scoped to these migrations on purpose. A blanket "every SECURITY DEFINER
function is revoked" lint would fail on migrations 033/042/106, which are
hardened retroactively by 108/160 rather than in place — so it would report
false positives instead of protecting anything.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

CASES = [
    ("161_fn_upsert_listening_answer.sql",      "fn_upsert_listening_answer"),
    ("174_fn_insert_listening_answer_once.sql", "fn_insert_listening_answer_once"),
    # mig 179 (GĐ 2 giao bài cho lớp) — same lock, found by the same review
    # class. Without the REVOKE an authenticated student who knows a cohort or
    # assignment id — both handed out by the student endpoints — could create or
    # delete class assignments straight past require_admin. Verified on a local
    # Postgres: dropping the REVOKE flips has_function_privilege('anon', …) to
    # true.
    ("179_fn_class_assignment_atomic.sql",      "fn_create_class_assignment"),
    ("179_fn_class_assignment_atomic.sql",      "fn_delete_class_assignment_if_unsubmitted"),
    ("179_fn_class_assignment_atomic.sql",      "fn_bind_session_to_class_item"),
    # mig 181 redefines the delete guard to read the Reading/Listening attempt
    # link. CREATE OR REPLACE preserves existing grants, so mig 180 omitting the
    # REVOKE is not a hole — but a redefinition is exactly where a future edit
    # could rename the function and silently mint a PUBLIC-executable one, so
    # every file that (re)defines it is pinned here.
    ("181_test_attempts_class_link.sql",        "fn_delete_class_assignment_if_unsubmitted"),
]
_ids = [fn for _f, fn in CASES]


def _sql(filename: str) -> str:
    return (_MIGRATIONS / filename).read_text(encoding="utf-8")


@pytest.mark.parametrize("filename,fn", CASES, ids=_ids)
def test_migration_exists(filename, fn):
    assert (_MIGRATIONS / filename).is_file(), f"missing {filename}"


@pytest.mark.parametrize("filename,fn", CASES, ids=_ids)
def test_function_is_security_definer(filename, fn):
    # If this ever stops being SECURITY DEFINER the grant requirement changes,
    # so the assertion below would be guarding nothing.
    assert re.search(r"SECURITY\s+DEFINER", _sql(filename), re.I)


@pytest.mark.parametrize("filename,fn", CASES, ids=_ids)
def test_execute_is_revoked_from_client_roles(filename, fn):
    revoke = re.search(
        rf"REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+[\w.]*{fn}\s*\([^)]*\)\s*FROM\s+([^;]+);",
        _sql(filename), re.I | re.S,
    )
    assert revoke, "no REVOKE EXECUTE for the function — it is PUBLIC by default"
    roles = revoke.group(1).lower()
    for role in ("public", "anon", "authenticated"):
        assert role in roles, f"EXECUTE still reachable by {role}"


@pytest.mark.parametrize("filename,fn", CASES, ids=_ids)
def test_execute_is_granted_to_service_role(filename, fn):
    """The backend calls these through supabase_admin; revoking without granting
    would break every Listening answer save instead of securing it."""
    assert re.search(
        rf"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[\w.]*{fn}\s*\([^)]*\)\s*TO\s+service_role",
        _sql(filename), re.I | re.S,
    )


@pytest.mark.parametrize("filename,fn", CASES, ids=_ids)
def test_revoke_precedes_nothing_that_regrants_public(filename, fn):
    """A later GRANT ... TO PUBLIC in the same file would silently undo it."""
    assert not re.search(
        rf"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[\w.]*{fn}[^;]*TO\s+(PUBLIC|anon|authenticated)",
        _sql(filename), re.I | re.S,
    )
