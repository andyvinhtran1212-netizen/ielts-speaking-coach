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
CLIENT_WRITE_PRIVILEGES = ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")


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
    for role, bypass in (("anon", "f"), ("authenticated", "f"), ("service_role", "t")):
        assert psql(f"SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='{role}'") == f"f|{bypass}", (
            f"Disposable cluster role {role} must have rolsuper=f and rolbypassrls={bypass}")
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
            for privilege in CLIENT_WRITE_PRIVILEGES:
                assert _privilege(schema, role, privilege, table="existing_acl_probe") == "t", (
                    "before 320", role, privilege)
            if _has_maintain():
                assert _privilege(schema, role, "MAINTAIN", table="existing_acl_probe") == "t"
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
def test_client_roles_cannot_write_or_truncate(log_schema, role):
    assert psql(f"SELECT rolsuper FROM pg_roles WHERE rolname='{role}'") == "f"
    # 198 creates this table AFTER 320: only the real default-ACL lockdown
    # can remove these grants, and no later relation REVOKE can hide a defect.
    for privilege in CLIENT_WRITE_PRIVILEGES:
        assert _privilege(log_schema, role, privilege) == "f", ("created after 320", role, privilege)
    _assert_no_column_writes(log_schema, role)
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

    _apply_204_audit_boundary(log_schema)
    for revoked_role in ("anon", "authenticated", "service_role"):
        assert _privilege(log_schema, revoked_role, "TRUNCATE") == "f", ("after 204", revoked_role, "TRUNCATE")
    assert _public_truncate_grants(log_schema) == "0"
    for privilege in CLIENT_WRITE_PRIVILEGES:
        assert _privilege(log_schema, role, privilege) == "f", ("after 204", role, privilege)
    assert _privilege(log_schema, role, "SELECT") == "t"
    assert _privilege(log_schema, "service_role", "TRUNCATE") == "f"
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        assert _privilege(log_schema, "service_role", privilege) == "t", ("backend after 204", privilege)


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_320_revokes_existing_relation_grants(log_schema, role):
    for privilege in CLIENT_WRITE_PRIVILEGES:
        assert _privilege(log_schema, role, privilege, table="existing_acl_probe") == "f", (
            "existing relation after 320", role, privilege)
    _assert_no_column_writes(log_schema, role, table="existing_acl_probe")
    assert _privilege(log_schema, role, "SELECT", table="existing_acl_probe") == "t"
    assert _public_truncate_grants(log_schema, table="existing_acl_probe") == "0"
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
        assert _privilege(log_schema, "service_role", privilege, table="existing_acl_probe") == "t", (
            "existing backend after 320", privilege)


def _apply_204_audit_boundary(schema):
    # Execute the whole committed block, preserving comments and any following
    # GRANT. Matching an isolated REVOKE would execute commented-out SQL and
    # miss a re-grant in the same block. Assert the resulting ACL, not SQL text.
    start = "-- ── Append-only class action log privilege boundary"
    end = "-- ── Course assignment artifact truth"
    assert SQL_204.count(start) == SQL_204.count(end) == 1
    boundary = SQL_204.split(start, 1)[1].split(end, 1)[0]
    psql((start + boundary).replace("public.", f"{schema}."))


def _assert_no_column_writes(schema, role, *, table="class_action_log"):
    for privilege in ("INSERT", "UPDATE", "REFERENCES"):
        assert psql(f"SELECT has_any_column_privilege('{role}', '{schema}.{table}', '{privilege}')") == "f", (
            role, table, privilege)
    assert psql("SELECT count(*) FROM pg_attribute "
                f"WHERE attrelid='{schema}.{table}'::regclass AND attacl IS NOT NULL") == "0"


def _has_maintain():
    return int(psql("SHOW server_version_num")) >= 170000


@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize("table", ["class_action_log", "existing_acl_probe"])
def test_320_revokes_maintain_on_existing_and_future_tables(log_schema, role, table):
    if not _has_maintain():
        pytest.skip("MAINTAIN was introduced in PostgreSQL 17; older servers reject this privilege")
    assert _privilege(log_schema, role, "MAINTAIN", table=table) == "f", (role, table, "MAINTAIN")
    assert _privilege(log_schema, "service_role", "MAINTAIN", table=table) == "t"


def test_rls_and_policies_match_migration_198(log_schema):
    assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid='{log_schema}.class_action_log'::regclass") == "t"
    predicate = f"{log_schema}.is_current_user_admin()"
    assert psql("SELECT policyname, cmd, roles::text, qual, with_check FROM pg_policies "
                f"WHERE schemaname='{log_schema}' AND tablename='class_action_log' ORDER BY policyname") == (
        f"cal_admin_append|INSERT|{{authenticated}}||{predicate}\n"
        f"cal_admin_read|SELECT|{{authenticated}}|{predicate}|"
    )
    _insert(log_schema)
    for role in ("anon", "authenticated"):
        assert psql(f"SET ROLE {role}; SELECT count(*) FROM {log_schema}.class_action_log") == "0"


def test_authenticated_admin_reads_exact_rows_but_cannot_insert_after_320(log_schema):
    rows = sorted(str(_insert(log_schema)) for _ in range(2))
    psql(f"CREATE OR REPLACE FUNCTION {log_schema}.is_current_user_admin() RETURNS boolean "
         "LANGUAGE sql AS $$ SELECT true $$")
    assert psql(f"BEGIN; SET LOCAL ROLE authenticated; DO $$ BEGIN "
                f"ASSERT current_user = 'authenticated'; ASSERT {log_schema}.is_current_user_admin(); "
                "END $$; "
                f"SELECT id FROM {log_schema}.class_action_log ORDER BY id; ROLLBACK;") == "\n".join(rows)
    # cal_admin_append permits admins at the RLS layer, but 320 has already
    # revoked authenticated's INSERT privilege. Do not re-grant it in the test.
    assert _privilege(log_schema, "authenticated", "INSERT") == "f"
    with pytest.raises(RuntimeError, match="SQLSTATE=42501.*permission denied for table class_action_log"):
        psql(f"BEGIN; SET LOCAL ROLE authenticated; DO $$ BEGIN "
             f"ASSERT current_user = 'authenticated'; ASSERT {log_schema}.is_current_user_admin(); "
             f"INSERT INTO {log_schema}.class_action_log (action, cohort_id) "
             f"VALUES ('due_change', '{uuid4()}'); "
             "EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SQLSTATE=% %', SQLSTATE, SQLERRM; "
             "END $$; ROLLBACK;")
    assert psql(f"SELECT id FROM {log_schema}.class_action_log ORDER BY id") == "\n".join(rows)


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_service_role_cannot_bypass_append_only_trigger(log_schema, operation):
    row = _insert(log_schema)
    for privilege in ("SELECT", "UPDATE", "DELETE"):
        assert _privilege(log_schema, "service_role", privilege) == "t"
    assert psql("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'") == "t"
    command = (f"UPDATE {log_schema}.class_action_log SET action='return_work'" if operation == "UPDATE"
               else f"DELETE FROM {log_schema}.class_action_log")
    with pytest.raises(RuntimeError, match=re.escape(MESSAGE)):
        psql("BEGIN; SET LOCAL ROLE service_role; DO $$ BEGIN "
             "ASSERT current_user = 'service_role'; " + command + f" WHERE id='{row}'; "
             "END $$; ROLLBACK;")
    assert psql(f"SELECT action, details->>'before' FROM {log_schema}.class_action_log WHERE id='{row}'") == "due_change|1"


@pytest.mark.parametrize("role,operation", [("service_role", "TRUNCATE"), ("authenticated", "INSERT")])
def test_role_writes_denied_by_acl_with_42501(log_schema, role, operation):
    row = _insert(log_schema)
    _apply_204_audit_boundary(log_schema)
    command = (f"TRUNCATE {log_schema}.class_action_log" if operation == "TRUNCATE" else
               f"INSERT INTO {log_schema}.class_action_log (action, cohort_id) VALUES ('due_change', '{uuid4()}')")
    # Surface the server SQLSTATE through the shared psql helper. The block is
    # SECURITY INVOKER; both the role assertion and command run as the client.
    with pytest.raises(RuntimeError, match="SQLSTATE=42501.*permission denied for table class_action_log"):
        psql(f"BEGIN; SET LOCAL ROLE {role}; DO $$ BEGIN "
             f"ASSERT current_user = '{role}'; {command}; "
             "EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SQLSTATE=% %', SQLSTATE, SQLERRM; "
             "END $$; ROLLBACK;")
    assert psql(f"SELECT id FROM {log_schema}.class_action_log") == str(row)


def _privilege(schema, role, privilege, *, table="class_action_log"):
    return psql(f"SELECT has_table_privilege('{role}', '{schema}.{table}', '{privilege}')")


def _public_truncate_grants(schema, *, table="class_action_log"):
    return psql("SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl "
                f"WHERE c.oid='{schema}.{table}'::regclass "
                "AND acl.grantee=0 AND acl.privilege_type='TRUNCATE'")


def test_append_only_function_has_a_pinned_search_path(log_schema):
    assert psql(f"SELECT array_to_string(proconfig, ';') FROM pg_proc "
                f"WHERE oid='{log_schema}.fn_class_action_log_append_only()'::regprocedure") == f"search_path={log_schema}, pg_temp"


def _assert_no_audit_truncate_grants(migrations):
    # Offline guard: 204's known audit block only REVOKEs. No migration or
    # marker grants an exemption. BEFORE TRUNCATE protection belongs to PC-J286.
    # Preserve quoted identifiers; mask comments and data literals, retaining
    # newlines so a failure identifies the migration and original line.
    tokens = re.compile(r'''"(?:[^"]|"")*"|'(?:[^']|'')*'|--[^\n]*|/\*.*?\*/''', re.S)
    for path in sorted(migrations.glob("*.sql")):
        code = tokens.sub(lambda m: m[0] if m[0].startswith('"') else
                          re.sub(r"[^\n]", " ", m[0]), path.read_text(encoding="utf-8"))
        for grant in re.finditer(r"\bGRANT\s+([^;]*?)\s+ON\s+(?:TABLE\s+)?([^;]*?)\s+TO\s+[^;]+", code, re.I):
            if not re.search(r"\b(?:TRUNCATE|ALL)\b", grant[1], re.I):
                continue
            targets = grant[2].replace('"', '')
            audit_table = re.search(r"(?:^|,)\s*(?:public\s*\.\s*)?class_action_log\s*(?:,|$)", targets, re.I)
            all_public_tables = re.search(r"^ALL\s+TABLES\s+IN\s+SCHEMA\s+(?:\w+\s*,\s*)*public\s*(?:,|$)", targets, re.I)
            assert not (audit_table or all_public_tables), (
                f"{path.name}:{code.count(chr(10), 0, grant.start()) + 1}: "
                "GRANT TRUNCATE/ALL can reopen class_action_log truncation")


def test_migrations_never_regrant_audit_log_truncate():
    _assert_no_audit_truncate_grants(MIGRATIONS)


@pytest.mark.parametrize("filename,grant", [
    ("204_reconcile_course_and_gate_e_schema.sql", "GRANT TRUNCATE ON class_action_log TO service_role;"),
    ("999_future.sql", "GRANT TRUNCATE ON TABLE public.class_action_log TO service_role;"),
    ("999_future.sql", "GRANT ALL PRIVILEGES ON TABLE public.class_action_log TO authenticated;"),
    ("999_future.sql", 'grant select, truncate on table public.other, "public"."class_action_log" to another_role;'),
    ("999_future.sql", "GRANT ALL ON class_action_log TO PUBLIC;"),
    ("999_future.sql", "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;"),
])
def test_audit_truncate_guard_rejects_grants_anywhere(tmp_path, filename, grant):
    # In 204 this is deliberately OUTSIDE the block executed by the PG test.
    (tmp_path / filename).write_text(SQL_204 + "\n" + grant, encoding="utf-8")
    with pytest.raises(AssertionError, match=rf"{re.escape(filename)}:\d+: GRANT TRUNCATE/ALL"):
        _assert_no_audit_truncate_grants(tmp_path)


def test_audit_truncate_guard_ignores_comments_literals_and_safe_privileges(tmp_path):
    (tmp_path / "999_safe.sql").write_text('''
-- GRANT TRUNCATE ON class_action_log TO service_role;
/* GRANT ALL PRIVILEGES ON TABLE public.class_action_log TO PUBLIC; */
COMMENT ON TABLE class_action_log IS 'GRANT ALL ON class_action_log TO anon;';
REVOKE TRUNCATE ON TABLE public.class_action_log FROM PUBLIC, service_role;
GRANT SELECT, INSERT ON public.class_action_log TO service_role;
GRANT ALL ON public.other_log TO service_role;
''', encoding="utf-8")
    _assert_no_audit_truncate_grants(tmp_path)
