"""Migration 169 — fn_set_exam_mode must be ONE statement, and backend-only.

The point of this migration is atomicity: mock_exams.exam_mode is the contract
every sitting is READ under (_sitting_sections resolves it from the exam row on
each read, nothing stores it on the sitting), so checking for dependents and
then PATCHing as two PostgREST requests let a sitting inserted between them be
interpreted under the wrong mode — empty retake menu, skipped by the reaper,
papers that can never be collected (Codex review, PR #859).

Static assertions on the SQL, matching the house style of
test_migration_161_rpc_grants.py: a real round-trip needs a live database, but
the properties that make this safe are visible in the text and are exactly what
a careless edit would drop.
"""

from __future__ import annotations

import re
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations" / "169_fn_set_exam_mode.sql"
)
FN = "fn_set_exam_mode"


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_the_migration_exists():
    assert MIGRATION.is_file(), f"{MIGRATION.name} missing"


def test_the_guard_lives_in_the_update_statement():
    """Both predicates must sit INSIDE the UPDATE. Split into a preceding
    SELECT they would reintroduce exactly the read-then-write gap this
    migration exists to close."""
    sql = _sql()
    update = sql[sql.index("UPDATE mock_exams"):sql.index("RETURNING")]
    assert "NOT EXISTS" in update
    assert re.search(r"FROM\s+mock_exam_sittings", update), "sitting guard not in the UPDATE"
    assert re.search(r"FROM\s+mock_exam_assignments", update), "assignment guard not in the UPDATE"


def test_a_voided_sitting_does_not_block_the_change():
    """A cancelled row is a closed record nothing reads a skill set out of, so
    it must leave the admin a way to convert an exam."""
    sql = _sql()
    assert re.search(r"s\.status\s*<>\s*'void'", sql)


def test_a_no_op_change_is_refused_rather_than_written():
    """Rewriting the same mode is not a mode change — the admin console PATCHes
    the whole form, so it resends exam_mode on every edit."""
    assert "IS DISTINCT FROM p_mode" in _sql()


def test_the_mode_value_is_validated():
    sql = _sql()
    assert "p_mode NOT IN ('sequential', 'retake')" in sql


def test_it_is_backend_only():
    """SECURITY DEFINER + PostgreSQL's default grant to PUBLIC means an explicit
    REVOKE is the only thing keeping this off the public PostgREST surface —
    otherwise any authenticated client could flip an exam's mode."""
    sql = _sql()
    assert "SECURITY DEFINER" in sql
    assert re.search(
        rf"REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.{FN}\([^)]*\)\s*"
        r"FROM\s+PUBLIC,\s*anon,\s*authenticated",
        sql,
    ), "missing REVOKE from PUBLIC/anon/authenticated"
    assert re.search(rf"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.{FN}\([^)]*\)\s*TO\s+service_role", sql)


def test_it_pins_the_search_path():
    """SECURITY DEFINER without a fixed search_path is a privilege-escalation
    footgun — the same hardening every other fn_* migration carries."""
    assert "SET search_path = public, pg_temp" in _sql()


def test_it_is_replayable():
    assert "CREATE OR REPLACE FUNCTION" in _sql()


def test_it_documents_what_it_does_not_close():
    """The residual race is real and must stay written down: under READ
    COMMITTED a sitting committing DURING this statement is invisible to the
    subquery snapshot. Claiming full serialisation would be a lie that the next
    reader builds on."""
    sql = _sql().upper()
    assert "READ COMMITTED" in sql
