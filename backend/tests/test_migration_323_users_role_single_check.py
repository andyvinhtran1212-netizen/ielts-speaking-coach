"""Migration 323 (A-05 / ROLECHECK-0026): users.role has one correct CHECK.

public.users carried chk_users_role (106: user|student|instructor|admin) and
users_role_check (outside the repo: user|admin). Their intersection {user,
admin} made PATCH /admin/users/{id}/role and the instructor-grant activation
fail with 23514 even as service_role. 323 keeps only chk_users_role.

The static half always runs. The PostgreSQL half builds `users` in a
disposable schema with both CHECKs plus migration 320's real guard trigger,
reproduces A-05, applies 323 twice and proves: service_role can write
instructor/student, garbage is still rejected for every role, client roles
still cannot change role (FR-004), rows are untouched (FR-005), and the
pre-check/postcondition abort atomically on unexpected data or schema.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import DB, psql

BACKEND = Path(__file__).resolve().parents[1]
SQL = (BACKEND / "migrations/323_users_role_single_check.sql").read_text(encoding="utf-8")
SQL_320 = (BACKEND / "migrations/320_client_write_privilege_lockdown.sql").read_text(encoding="utf-8")

CANONICAL = {"user", "student", "instructor", "admin"}
CANONICAL_DEF = ("CHECK ((role = ANY (ARRAY['user'::text, 'student'::text, "
                 "'instructor'::text, 'admin'::text])))")


def _strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


CODE = _strip_sql_comments(SQL)


# ── Static contract ─────────────────────────────────────────────────────────

def test_single_transaction_with_lock_timeout():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert CODE.count("BEGIN;") == 1 and CODE.count("COMMIT;") == 1
    assert "SET LOCAL lock_timeout = '5s';" in CODE


def test_drops_only_users_role_check_and_keeps_the_four_values():
    drops = re.findall(r"DROP CONSTRAINT IF EXISTS (\w+)", CODE)
    # chk_users_role is dropped only inside the drift branch, right before it
    # is re-added with the canonical definition.
    assert sorted(drops) == ["chk_users_role", "users_role_check"]
    drift = re.search(r"IF current_def IS DISTINCT FROM(.*?)END IF;", CODE, re.S)
    assert drift and "DROP CONSTRAINT IF EXISTS chk_users_role" in drift.group(1)
    adds = re.findall(r"ADD CONSTRAINT (\w+)\s+CHECK \(role IN \(([^)]*)\)\) NOT VALID", CODE)
    assert len(adds) == 1 and adds[0][0] == "chk_users_role"
    assert set(re.findall(r"'(\w+)'", adds[0][1])) == CANONICAL
    assert "ALTER TABLE public.users VALIDATE CONSTRAINT chk_users_role;" in CODE
    assert re.search(r"role NOT IN \('user', 'student', 'instructor', 'admin'\)", CODE)
    # The drift check and the postcondition compare against the same string.
    escaped = CANONICAL_DEF.replace("'", "''")
    assert CODE.count(f"'{escaped}'") == 2


def test_has_precheck_postcondition_and_320_trigger_check():
    assert "users_role_outside_canonical_set" in CODE
    assert "users_role_single_check_postcondition_failed" in CODE
    assert "role_attnum = ANY (c.conkey)" in CODE and "n_checks <> 1" in CODE
    assert "c.convalidated" in CODE
    assert re.search(r"tgname = 'trg_users_guard_privileged_columns'\s+AND tgenabled = 'O'", CODE)
    assert "users_privileged_column_guard_missing" in CODE


def test_changes_no_privilege_trigger_policy_or_data():
    upper = CODE.upper()
    for forbidden in ("GRANT", "REVOKE", "DROP TRIGGER", "CREATE TRIGGER", "ALTER TRIGGER",
                      "POLICY", "SECURITY DEFINER", "CREATE FUNCTION", "CREATE OR REPLACE",
                      "SET NOT NULL", "SET DEFAULT", "DROP DEFAULT"):
        assert forbidden not in upper, forbidden
    assert not re.search(r"\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b", CODE, re.I)


def test_application_writes_only_values_the_constraint_allows():
    from routers.admin import _VALID_ROLES

    assert _VALID_ROLES <= CANONICAL and {"instructor", "student"} <= _VALID_ROLES
    auth = (BACKEND / "routers/auth.py").read_text(encoding="utf-8")
    assert 'update_fields["role"] = "instructor"' in auth


# ── PostgreSQL execution ────────────────────────────────────────────────────

def _guard_320(schema: str) -> str:
    """Migration 320's real users guard function and trigger, re-targeted."""
    block = re.search(r"CREATE OR REPLACE FUNCTION public\.fn_guard_users_privileged_columns\(\).*?"
                      r"FOR EACH ROW EXECUTE FUNCTION public\.fn_guard_users_privileged_columns\(\);",
                      SQL_320, re.S)
    assert block, "migration 320 users guard not found"
    return (block.group(0).replace("public.", f"{schema}.")
                          .replace("search_path = public,", f"search_path = {schema},"))


def _migrated(schema: str) -> str:
    return SQL.replace("public.", f"{schema}.")


def _run(sql: str) -> subprocess.CompletedProcess:
    """psql with SQLSTATE in error messages (VERBOSITY=verbose)."""
    parsed = urlparse(DB)
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query:
        raise RuntimeError("Migration tests require a local disposable database URL")
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment["PGCONNECT_TIMEOUT"] = "3"
    return subprocess.run(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
                           "-tAq", "-c", sql], capture_output=True, text=True, timeout=30, env=environment)


def _as(role: str, user_id: str | None, sql: str) -> subprocess.CompletedProcess:
    claims = json.dumps({"role": role} if user_id is None else {"sub": user_id, "role": role})
    return _run(f"SET ROLE {role}; SELECT set_config('request.jwt.claims', '{claims}', false); {sql}")


def _ok(result: subprocess.CompletedProcess) -> None:
    assert result.returncode == 0, result.stderr


def _error(result: subprocess.CompletedProcess) -> str:
    assert result.returncode != 0, "statement unexpectedly succeeded"
    return result.stderr


def _role_checks(schema: str) -> str:
    return psql(f"""SELECT string_agg(c.conname || ':' || c.convalidated || ':' || pg_get_constraintdef(c.oid),
                                      ' | ' ORDER BY c.conname)
                      FROM pg_constraint c
                     WHERE c.conrelid = '{schema}.users'::regclass AND c.contype = 'c'""")


def _distribution(schema: str) -> str:
    return psql(f"SELECT string_agg(coalesce(role, '<null>') || '=' || n, ',' ORDER BY role)"
                f" FROM (SELECT role, count(*) n FROM {schema}.users GROUP BY role) d")


@pytest.fixture(scope="module")
def pg():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 323 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.skip("migration 323 probe needs a superuser to SET ROLE")
    # Supabase's service_role bypasses RLS; never create it without BYPASSRLS
    # on the shared CI cluster (tests 240–256 depend on it).
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    psql("ALTER ROLE service_role BYPASSRLS")
    created: list[str] = []

    def make(*, role_checks: tuple[str, ...] = (
                 "CONSTRAINT chk_users_role CHECK (role IN ('user', 'student', 'instructor', 'admin'))",
                 "CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))"),
             guard: bool = True, rows: tuple[str, ...] = ("'user'", "'user'", "'admin'", "NULL")) -> str:
        schema = "users_role_single_check_" + uuid4().hex
        created.append(schema)
        checks = "".join(f", {check}" for check in role_checks)
        values = ", ".join(f"(gen_random_uuid(), {role})" for role in rows)
        psql(f"""
            CREATE SCHEMA {schema};
            GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role;
            -- Hosted shape: role TEXT nullable DEFAULT 'user'.
            CREATE TABLE {schema}.users (
                id UUID PRIMARY KEY, email TEXT, role TEXT DEFAULT 'user',
                is_active BOOLEAN NOT NULL DEFAULT FALSE, permissions TEXT[],
                display_name VARCHAR(100), updated_at TIMESTAMPTZ{checks});
            -- Post-320 privileges: clients read only, service_role writes.
            GRANT SELECT ON {schema}.users TO anon, authenticated;
            GRANT ALL ON {schema}.users TO service_role;
            {"INSERT INTO " + schema + ".users (id, role) VALUES " + values + ";" if rows else ""}
            {_guard_320(schema) if guard else ""}
        """)
        return schema

    try:
        yield make
    finally:
        for schema in created:
            psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.fixture(scope="module")
def migrated(pg):
    schema = pg()
    learner = psql(f"SELECT id FROM {schema}.users WHERE role = 'user' ORDER BY id LIMIT 1")
    other = psql(f"SELECT id FROM {schema}.users WHERE role = 'user' ORDER BY id DESC LIMIT 1")
    # Before 323 the probe reproduces A-05 for the service role.
    for role in ("instructor", "student"):
        error = _error(_as("service_role", None,
                           f"UPDATE {schema}.users SET role = '{role}' WHERE id = '{learner}'"))
        assert "23514" in error and "users_role_check" in error
    before = _distribution(schema)
    _ok(_run(_migrated(schema)))
    oid = psql(f"SELECT oid FROM pg_constraint WHERE conrelid = '{schema}.users'::regclass"
               f" AND conname = 'chk_users_role'")
    _ok(_run(_migrated(schema)))  # second apply is a no-op
    return {"schema": schema, "learner": learner, "other": other, "before": before, "oid": oid}


def test_ac1_single_validated_canonical_check(migrated):
    s = migrated["schema"]
    assert _role_checks(s) == f"chk_users_role:true:{CANONICAL_DEF}"
    # The second apply did not recreate the constraint.
    assert psql(f"SELECT oid FROM pg_constraint WHERE conrelid = '{s}.users'::regclass"
                f" AND conname = 'chk_users_role'") == migrated["oid"]


def test_fr005_no_row_changed(migrated):
    s = migrated["schema"]
    assert _distribution(s) == migrated["before"] == "admin=1,user=2,<null>=1"


def test_fr001_fr002_service_role_writes_instructor_and_student(migrated):
    s, me = migrated["schema"], migrated["learner"]
    try:
        # Activation path: role promotion in the same UPDATE as activation.
        _ok(_as("service_role", None, f"UPDATE {s}.users SET role = 'instructor', is_active = TRUE,"
                                      f" permissions = ARRAY['practice_full'] WHERE id = '{me}'"))
        assert psql(f"SELECT role || ':' || is_active FROM {s}.users WHERE id = '{me}'") == "instructor:true"
        # Demote back to student (the only UI path to remove instructor access).
        _ok(_as("service_role", None, f"UPDATE {s}.users SET role = 'student' WHERE id = '{me}'"))
        assert psql(f"SELECT role FROM {s}.users WHERE id = '{me}'") == "student"
        _ok(_as("service_role", None, f"INSERT INTO {s}.users (id, role) VALUES (gen_random_uuid(), 'instructor')"))
    finally:
        psql(f"UPDATE {s}.users SET role = 'user', is_active = FALSE, permissions = NULL WHERE id = '{me}';"
             f" DELETE FROM {s}.users WHERE role = 'instructor'")


def test_fr003_out_of_set_values_are_rejected_for_every_role(migrated):
    s, me = migrated["schema"], migrated["learner"]
    for value in ("bogus", "superadmin", "Instructor", "teacher", ""):
        for result in (_as("service_role", None, f"UPDATE {s}.users SET role = '{value}' WHERE id = '{me}'"),
                       _run(f"UPDATE {s}.users SET role = '{value}' WHERE id = '{me}'"),
                       _as("service_role", None, f"INSERT INTO {s}.users (id, role)"
                                                 f" VALUES (gen_random_uuid(), '{value}')")):
            error = _error(result)
            assert "23514" in error and "chk_users_role" in error, error
    assert psql(f"SELECT role FROM {s}.users WHERE id = '{me}'") == "user"


def test_fr004_client_roles_still_cannot_change_role(migrated):
    s, me, other = migrated["schema"], migrated["learner"], migrated["other"]
    psql(f"UPDATE {s}.users SET role = 'instructor' WHERE id = '{other}'")
    try:
        for role in ("authenticated", "anon"):
            for actor in (me, other):  # a learner and a newly promoted instructor
                for target in (me, other):
                    for value in ("admin", "instructor"):
                        error = _error(_as(role, actor, f"UPDATE {s}.users SET role = '{value}'"
                                                        f" WHERE id = '{target}'"))
                        assert "permission denied" in error, error
        # Defence in depth: even with a stray UPDATE grant the 320 trigger
        # still rejects a client-role change of role.
        psql(f"GRANT UPDATE ON {s}.users TO authenticated")
        try:
            for actor, value in ((me, "instructor"), (other, "admin")):
                error = _error(_as("authenticated", actor,
                                   f"UPDATE {s}.users SET role = '{value}' WHERE id = '{actor}'"))
                assert "users_privileged_column_change_forbidden" in error and "42501" in error
        finally:
            psql(f"REVOKE UPDATE ON {s}.users FROM authenticated")
        assert psql(f"SELECT string_agg(role, ',' ORDER BY role) FROM {s}.users"
                    f" WHERE id IN ('{me}', '{other}')") == "instructor,user"
        assert psql(f"SELECT tgenabled FROM pg_trigger WHERE tgrelid = '{s}.users'::regclass"
                    f" AND tgname = 'trg_users_guard_privileged_columns'") == "O"
    finally:
        psql(f"UPDATE {s}.users SET role = 'user' WHERE id = '{other}'")


def test_aborts_on_a_row_outside_the_canonical_set(pg):
    schema = pg(role_checks=("CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'superadmin'))",),
                rows=("'user'", "'superadmin'"))
    error = _error(_run(_migrated(schema)))
    assert "users_role_outside_canonical_set" in error and f"1 {schema}.users rows" in error
    # Nothing changed: the row stays for review and the old constraint remains.
    assert _distribution(schema) == "superadmin=1,user=1"
    assert _role_checks(schema).startswith("users_role_check:true:")


@pytest.mark.parametrize("disable", [False, True], ids=["missing", "disabled"])
def test_aborts_atomically_without_an_enabled_320_trigger(pg, disable):
    schema = pg(guard=disable)
    if disable:
        psql(f"ALTER TABLE {schema}.users DISABLE TRIGGER trg_users_guard_privileged_columns")
    before = _role_checks(schema)
    error = _error(_run(_migrated(schema)))
    assert "users_privileged_column_guard_missing" in error
    assert _role_checks(schema) == before and "users_role_check" in before


def test_aborts_on_a_third_check_on_role(pg):
    schema = pg(role_checks=(
        "CONSTRAINT chk_users_role CHECK (role IN ('user', 'student', 'instructor', 'admin'))",
        "CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))",
        "CONSTRAINT users_role_not_blank CHECK (role <> '')"))
    before = _role_checks(schema)
    error = _error(_run(_migrated(schema)))
    assert "users_role_single_check_postcondition_failed" in error and "count=2" in error
    assert _role_checks(schema) == before


@pytest.mark.parametrize("checks", [
    ("CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))",),
    ("CONSTRAINT chk_users_role CHECK (role IN ('user', 'admin'))",
     "CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))"),
], ids=["chk_missing", "chk_drifted"])
def test_recreates_a_missing_or_drifted_canonical_check(pg, checks):
    schema = pg(role_checks=checks)
    before = _distribution(schema)
    _ok(_run(_migrated(schema)))
    _ok(_run(_migrated(schema)))
    assert _role_checks(schema) == f"chk_users_role:true:{CANONICAL_DEF}"
    assert _distribution(schema) == before
