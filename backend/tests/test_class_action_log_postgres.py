"""Execute 198's append-only trigger and 204/320's ACLs on LOCAL PostgreSQL.

TEST_PG_URL/REQUIRE_PG use the shared localhost-only psql harness. Each test owns
one random schema with owner-scoped Supabase defaults. Migration SQL is only
transplanted from public into that schema; no hosted database or product data
is used. Migration 320 runs first, before 198 creates the log; 204's TRUNCATE
boundary is challenged separately so another revoke cannot mask its removal.
"""

import os
import re
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql


MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
SQL = (MIGRATIONS / "198_class_action_log.sql").read_text(encoding="utf-8")
SQL_204 = (MIGRATIONS / "204_reconcile_course_and_gate_e_schema.sql").read_text(encoding="utf-8")
SQL_320 = (MIGRATIONS / "320_client_write_privilege_lockdown.sql").read_text(encoding="utf-8")
MESSAGE = (
    "class_action_log chỉ THÊM: không sửa, không xoá (mig 198). Cần dọn thì "
    "tắt trigger trg_class_action_log_append_only một cách có ý thức."
)


@pytest.fixture
def log_schema():
    try:
        available = psql("SELECT 1") == "1"
    except (RuntimeError, OSError):
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 198 verification")
        pytest.skip("Local PostgreSQL unavailable")
    assert psql("SELECT rolsuper FROM pg_roles WHERE rolname=current_user") == "t", "Disposable cluster requires a superuser"
    psql("""DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    END $$;""")
    schema = "class_log_" + uuid4().hex
    psql(f"CREATE SCHEMA {schema}")
    try:
        # Supabase grants table privileges by default. Prove the committed
        # boundaries remove them, rather than testing PostgreSQL's empty ACL.
        owner = psql("SELECT quote_ident(current_user)")
        psql(f"GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role; " +
             "; ".join(f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {schema} "
                       f"GRANT {privilege} ON {kind} TO anon, authenticated, service_role"
                       for privilege, kind in (("ALL", "TABLES"), ("ALL", "SEQUENCES"),
                                               ("EXECUTE", "FUNCTIONS"))))
        # A pre-existing relation exercises 320's catalog scan, independently
        # of its default-ACL protection for tables created by later migrations.
        psql(f"CREATE TABLE {schema}.existing_acl_probe (id integer); "
             f"GRANT TRUNCATE ON {schema}.existing_acl_probe TO PUBLIC")
        for role in ("anon", "authenticated", "service_role"):
            for privilege in ("TRUNCATE", "UPDATE", "DELETE"):
                assert _privilege(schema, role, privilege, table="existing_acl_probe") == "t", (
                    "before 320", role, privilege)
        # The FIRST migration executed is 320. Keep its real relation scan,
        # owner discovery, default ACLs and PG17 branch. Only the two relevant
        # sections are needed; the remainder depends on unrelated product tables.
        lockdown = re.search(
            r"-- ── 1\. Client write privileges[^\n]*\n(.*?)-- ── 3\. public\.users:",
            SQL_320, re.S,
        )
        assert lockdown, "320's relation and default privilege boundaries must exist"
        psql(lockdown[1].replace("public.", f"{schema}.")
             .replace("'public'", f"'{schema}'").replace("SCHEMA public", f"SCHEMA {schema}"))
        # 198 has no foreign keys; only its policy predicate is a dependency.
        psql(f"CREATE FUNCTION {schema}.is_current_user_admin() RETURNS boolean "
             "LANGUAGE sql AS $$ SELECT false $$")
        migrated = SQL.replace("public.", f"{schema}.").replace("search_path = public,", f"search_path = {schema},")
        psql(f"SET search_path = {schema}, pg_temp;\n" + migrated)
        yield schema
    finally:
        psql(f"DROP SCHEMA {schema} CASCADE")


def _insert(schema):
    row, cohort = uuid4(), uuid4()
    assert psql(f"INSERT INTO {schema}.class_action_log (id, action, cohort_id, details) "
                f"VALUES ('{row}', 'due_change', '{cohort}', '{{\"before\":1}}') RETURNING id") == str(row)
    return row


def test_insert_preserves_the_audit_record(log_schema):
    row = _insert(log_schema)
    assert psql(f"SELECT action, details->>'before', created_at IS NOT NULL "
                f"FROM {log_schema}.class_action_log WHERE id='{row}'") == "due_change|1|t"


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_update_and_delete_reject_real_rows_with_the_append_only_message(log_schema, operation):
    row = _insert(log_schema)
    command = (f"UPDATE {log_schema}.class_action_log SET action='return_work'" if operation == "UPDATE"
               else f"DELETE FROM {log_schema}.class_action_log")
    # Run as the table owner (bypasses RLS), so the trigger must do the work.
    with pytest.raises(RuntimeError) as error:
        psql(command + f" WHERE id='{row}'")
    assert MESSAGE in str(error.value)
    assert psql(f"SELECT action, details->>'before' FROM {log_schema}.class_action_log WHERE id='{row}'") == "due_change|1"


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_client_roles_cannot_truncate_update_or_delete(log_schema, role):
    assert psql(f"SELECT rolsuper FROM pg_roles WHERE rolname='{role}'") == "f"
    # 198 creates this table AFTER 320: only the real default-ACL lockdown
    # can remove these grants, and no later relation REVOKE can hide a defect.
    for privilege in ("TRUNCATE", "UPDATE", "DELETE"):
        assert _privilege(log_schema, role, privilege) == "f", ("created after 320", role, privilege)
    assert _privilege(log_schema, role, "SELECT") == "t"
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
        assert _privilege(log_schema, "service_role", privilege) == "t", ("backend before 204", privilege)

    # Re-open only TRUNCATE to challenge 204 independently of 320. Check all
    # explicit grantees plus PUBLIC; never compensate with fixture REVOKEs.
    psql(f"GRANT TRUNCATE ON TABLE {log_schema}.class_action_log "
         "TO PUBLIC, anon, authenticated, service_role")
    assert _public_truncate_grants(log_schema) == "1"
    for granted_role in ("anon", "authenticated", "service_role"):
        assert _privilege(log_schema, granted_role, "TRUNCATE") == "t", ("before 204", granted_role)

    # Run only the actual 204 audit-log statement, not its unrelated course and
    # Speaking schema reconciliation. No migration runs after it to mask removal.
    revoke = re.search(r"^REVOKE TRUNCATE ON TABLE public\.class_action_log\b.*?;", SQL_204, re.M | re.S)
    assert revoke, "204's audit-log TRUNCATE boundary must exist"
    psql(revoke[0].replace("public.", f"{log_schema}."))
    for revoked_role in ("anon", "authenticated", "service_role"):
        assert _privilege(log_schema, revoked_role, "TRUNCATE") == "f", ("after 204", revoked_role, "TRUNCATE")
    assert _public_truncate_grants(log_schema) == "0"
    for privilege in ("TRUNCATE", "UPDATE", "DELETE"):
        assert _privilege(log_schema, role, privilege) == "f", ("after 204", role, privilege)
    assert _privilege(log_schema, role, "SELECT") == "t"
    assert _privilege(log_schema, "service_role", "TRUNCATE") == "f"
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        assert _privilege(log_schema, "service_role", privilege) == "t", ("backend after 204", privilege)


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_320_revokes_existing_relation_grants(log_schema, role):
    for privilege in ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"):
        assert _privilege(log_schema, role, privilege, table="existing_acl_probe") == "f", (
            "existing relation after 320", role, privilege)
    assert _privilege(log_schema, role, "SELECT", table="existing_acl_probe") == "t"
    assert _public_truncate_grants(log_schema, table="existing_acl_probe") == "0"
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
        assert _privilege(log_schema, "service_role", privilege, table="existing_acl_probe") == "t", (
            "existing backend after 320", privilege)


def _privilege(schema, role, privilege, *, table="class_action_log"):
    return psql(f"SELECT has_table_privilege('{role}', '{schema}.{table}', '{privilege}')")


def _public_truncate_grants(schema, *, table="class_action_log"):
    return psql("SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl "
                f"WHERE c.oid='{schema}.{table}'::regclass "
                "AND acl.grantee=0 AND acl.privilege_type='TRUNCATE'")


def test_append_only_function_has_a_pinned_search_path(log_schema):
    assert psql(f"SELECT array_to_string(proconfig, ';') FROM pg_proc "
                f"WHERE oid='{log_schema}.fn_class_action_log_append_only()'::regprocedure") == f"search_path={log_schema}, pg_temp"
