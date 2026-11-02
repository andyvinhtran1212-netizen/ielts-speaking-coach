"""CALAPPEND-0041 FR-001..004 on disposable LOCAL PostgreSQL, PG16/PG17.

Replay the real 198/204 audit boundary, 320 and 344 files under Supabase
default grants with a non-superuser owner. No hosted data or credentials.
The down migration is outside PC-J286's explicitly assigned UP-only scope.
"""
import json
import re
from pathlib import Path
from uuid import uuid4

import pytest

import test_client_write_invariant_postgres as invariant

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "356_class_action_log_no_truncate.sql"
TABLE = "public.class_action_log"
OWNER = invariant.OWNER
PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")
sql = invariant.sql
run = invariant._script


def migration():
    return (MIGRATIONS / NAME).read_text(encoding="utf-8")


def snapshot(db):
    return json.loads(sql(db, """
        SELECT jsonb_build_object(
          'acl', c.relacl::text, 'rls', c.relrowsecurity,
          'columns', (SELECT jsonb_agg(jsonb_build_array(attname,attacl::text) ORDER BY attnum)
                        FROM pg_attribute WHERE attrelid=c.oid AND attnum>0),
          'policies', (SELECT jsonb_agg(jsonb_build_array(p.polname,
                         pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),
                         obj_description(p.oid,'pg_policy')) ORDER BY p.polname)
                        FROM pg_policy p WHERE p.polrelid=c.oid),
          'triggers', (SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid))
                                       ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid))
        FROM pg_class c WHERE c.oid='public.class_action_log'::regclass
    """))


@pytest.fixture(params=["after344", "legacy"])
def before356(request):
    db, created_admin = invariant._create_database()
    try:
        for role, bypass in (("anon", "f"), ("authenticated", "f"), ("service_role", "t")):
            assert sql(db, f"SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='{role}'") == f"f|{bypass}"
        assert sql(db, f"SELECT rolsuper FROM pg_roles WHERE rolname='{OWNER}'") == "f"
        run(db, invariant._pre_320() + invariant._pre_320_history())
        # _pre_320_history replays 198's full function, row trigger and policies.
        text = (MIGRATIONS / "204_reconcile_course_and_gate_e_schema.sql").read_text()
        boundary = text.split("-- ── Append-only class action log privilege boundary", 1)[1]
        run(db, "-- ── Append-only class action log privilege boundary" +
            boundary.split("-- ── Course assignment artifact truth", 1)[0])
        invariant._apply(db, MIGRATIONS / "320_client_write_privilege_lockdown.sql")
        if request.param == "after344":
            invariant._apply(db, MIGRATIONS / "344_rls_admin_policy_cleanup.sql")
            assert snapshot(db)["policies"] is None
        else:
            run(db, "DROP TABLE public._schema_migrations;")
            assert len(snapshot(db)["policies"]) == 2
        # Service role starts with all extra grants from Supabase defaults.
        assert sql(db, f"SELECT has_table_privilege('service_role','{TABLE}','UPDATE,DELETE,TRIGGER,REFERENCES')") == "t"
        row = str(uuid4())
        run(db, f"INSERT INTO {TABLE} (id,action,cohort_id) VALUES ('{row}','due_change','{uuid4()}');")
        yield db, request.param, row
    finally:
        invariant._drop_database(db, created_admin)


@pytest.fixture
def applied(before356):
    db, state, row = before356
    run(db, migration())
    return db, state, row


def attempt(db, statement, *, role=OWNER, prefix=""):
    # Identity and the challenged statement execute in the same invoker block.
    return run(db, f"BEGIN; {prefix} SET LOCAL ROLE {role}; DO $probe$ BEGIN "
               f"ASSERT current_user='{role}'; {statement}; "
               "EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SQLSTATE=% %', SQLSTATE, SQLERRM; "
               "END $probe$; ROLLBACK;", role=None)


def assert_denied(db, statement, code, *, role=OWNER, prefix="", message=""):
    with pytest.raises(RuntimeError, match=f"SQLSTATE={code}.*{message}"):
        attempt(db, statement, role=role, prefix=prefix)


def test_double_apply_preserves_policy_client_acl_and_data(before356):
    db, state, row = before356
    before = snapshot(db)
    for _ in range(2):
        run(db, migration())
        after = snapshot(db)
        assert after["policies"] == before["policies"]
        assert after["columns"] == before["columns"]
        assert after["rls"] is True
        assert sql(db, f"SELECT id FROM {TABLE}") == row
        assert sql(db, f"SELECT tgtype,tgenabled FROM pg_trigger WHERE tgrelid='{TABLE}'::regclass "
                       "AND tgname='trg_class_action_log_no_truncate'") == "34|O"
        assert [t for t in after["triggers"] if t[0] == "trg_class_action_log_append_only"] == before["triggers"]
        assert sql(db, "SELECT proconfig::text,prosecdef FROM pg_proc "
                       "WHERE oid='public.fn_class_action_log_no_truncate()'::regprocedure") == '{"search_path=pg_catalog, pg_temp"}|f'
        assert sql(db, "SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a "
                       "WHERE p.oid='public.fn_class_action_log_no_truncate()'::regprocedure "
                       "AND a.grantee=0 AND a.privilege_type='EXECUTE'") == "0"
        for role in ("anon", "authenticated", "service_role"):
            privileges = PRIVILEGES + (("MAINTAIN",) if int(sql(db, "SHOW server_version_num")) >= 170000 else ())
            for privilege in privileges:
                allowed = privilege in (("SELECT", "INSERT") if role == "service_role" else
                                        (("SELECT",) if state == "legacy" else ()))
                assert sql(db, f"SELECT has_table_privilege('{role}','{TABLE}','{privilege}')") == ("t" if allowed else "f")
            for privilege in ("SELECT", "INSERT", "UPDATE", "REFERENCES"):
                expected = privilege in (("SELECT", "INSERT") if role == "service_role" else
                                         (("SELECT",) if state == "legacy" else ()))
                assert sql(db, f"SELECT has_any_column_privilege('{role}','{TABLE}','{privilege}')") == ("t" if expected else "f")
        assert sql(db, f"SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a "
                       f"WHERE c.oid='{TABLE}'::regclass AND a.grantee=0") == "0"


@pytest.mark.parametrize("operation", ["TRUNCATE", "UPDATE", "DELETE"])
def test_trigger_and_acl_layers(applied, operation):
    db, _, row = applied
    statement = {"TRUNCATE": f"TRUNCATE {TABLE}",
                 "UPDATE": f"UPDATE {TABLE} SET action='return_work' WHERE id='{row}'",
                 "DELETE": f"DELETE FROM {TABLE} WHERE id='{row}'"}[operation]
    message = "trg_class_action_log_no_truncate" if operation == "TRUNCATE" else "mig 198"
    assert_denied(db, statement, "P0001", message=message)
    assert_denied(db, statement, "42501", role="service_role")
    assert_denied(db, statement, "P0001", role="service_role", message=message,
                  prefix=f"SET LOCAL ROLE {OWNER}; GRANT {operation} ON {TABLE} TO service_role;")
    if operation != "TRUNCATE":
        assert_denied(db, statement, "42501", role="service_role",
                      prefix=f"SET LOCAL ROLE {OWNER}; ALTER TABLE {TABLE} DISABLE TRIGGER trg_class_action_log_append_only;")
    assert sql(db, f"SELECT id,action FROM {TABLE}") == f"{row}|due_change"


@pytest.mark.parametrize("clause", ["FOR UPDATE", "FOR NO KEY UPDATE", "FOR SHARE", "FOR KEY SHARE"])
def test_service_role_row_locks_denied(applied, clause):
    db, _, _ = applied
    assert_denied(db, f"PERFORM * FROM {TABLE} {clause}", "42501", role="service_role")


@pytest.mark.parametrize("mode", ["SHARE", "SHARE ROW EXCLUSIVE", "EXCLUSIVE", "ACCESS EXCLUSIVE"])
def test_service_role_blocking_table_locks_denied(applied, mode):
    db, _, _ = applied
    assert_denied(db, f"LOCK TABLE {TABLE} IN {mode} MODE", "42501", role="service_role")


def test_backend_insert_select_and_allowed_locks(applied):
    db, _, row = applied
    inserted = str(uuid4())
    run(db, f"BEGIN; SET LOCAL ROLE service_role; DO $$ BEGIN ASSERT current_user='service_role'; END $$; "
            f"INSERT INTO {TABLE} (id,action,cohort_id) VALUES ('{inserted}','return_work','{uuid4()}'); COMMIT;", role=None)
    assert run(db, f"SELECT id FROM {TABLE} ORDER BY id;", role="service_role") == "\n".join(sorted([row, inserted]))
    for mode in ("ACCESS SHARE", "ROW SHARE", "ROW EXCLUSIVE"):
        attempt(db, f"LOCK TABLE {TABLE} IN {mode} MODE", role="service_role")


def test_public_grants_are_removed_too(before356):
    db, _, _ = before356
    extras = ("UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES")
    if int(sql(db, "SHOW server_version_num")) >= 170000:
        extras += ("MAINTAIN",)
    run(db, f"GRANT {','.join(extras)} ON {TABLE} TO PUBLIC;")
    run(db, migration())
    for role in ("anon", "authenticated", "service_role"):
        for privilege in extras:
            assert sql(db, f"SELECT has_table_privilege('{role}','{TABLE}','{privilege}')") == "f"


def test_service_role_public_overloads_cannot_regrant_privileges(before356):
    db, _, _ = before356
    # Match the hosted schema ACL: the non-owner service role can plant
    # overloads that win resolution of unknown/text arguments in public.
    run(db, "GRANT CREATE ON SCHEMA public TO service_role;", role=None)
    run(db, """
        DO $$ BEGIN ASSERT current_user = 'service_role'; END $$;
        CREATE FUNCTION public.has_table_privilege(r text, t text, p text)
        RETURNS boolean LANGUAGE plpgsql AS $$
        BEGIN
            IF current_user <> 'service_role' THEN
                EXECUTE 'GRANT UPDATE, DELETE, TRUNCATE, TRIGGER '
                        'ON public.class_action_log TO service_role';
            END IF;
            RETURN r = 'service_role' AND p IN ('SELECT', 'INSERT');
        END;
        $$;
        CREATE FUNCTION public.has_any_column_privilege(r text, t text, p text)
        RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    """, role="service_role")
    assert sql(db, "SELECT proowner = 'service_role'::regrole FROM pg_catalog.pg_proc "
                   "WHERE oid = 'public.has_table_privilege(text,text,text)'::regprocedure") == "t"

    run(db, migration())

    # Qualify the oracle so the planted functions cannot falsify the result.
    for privilege in ("UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"):
        assert sql(db, f"SELECT pg_catalog.has_table_privilege('service_role','{TABLE}',"
                       f"'{privilege}')") == "f", privilege
    for privilege in ("SELECT", "INSERT"):
        assert sql(db, f"SELECT pg_catalog.has_table_privilege('service_role','{TABLE}',"
                       f"'{privilege}')") == "t", privilege


@pytest.mark.parametrize("setup", [
    "DELETE FROM public._schema_migrations WHERE filename LIKE '344\\_%' ESCAPE '\\';",
    "CREATE POLICY cal_admin_read ON public.class_action_log FOR SELECT TO authenticated USING (true);",
    "CREATE POLICY cal_admin_append ON public.class_action_log FOR INSERT TO authenticated WITH CHECK (true);",
])
def test_344_precondition_fails_before_any_change(before356, setup):
    db, state, _ = before356
    if state == "legacy":
        run(db, "CREATE TABLE public._schema_migrations (filename text PRIMARY KEY);")
    else:
        run(db, setup)
    before = snapshot(db)
    with pytest.raises(RuntimeError, match="class_action_log_356_requires_344"):
        run(db, migration())
    assert snapshot(db) == before


@pytest.mark.parametrize("setup,marker", [
    ("ALTER TABLE public.class_action_log DISABLE TRIGGER trg_class_action_log_append_only;", "row_trigger"),
    ("GRANT UPDATE(action) ON public.class_action_log TO act334_runner; "
     "GRANT act334_runner TO service_role;", "privilege"),
    ("GRANT client_invariant_runner TO service_role;", "owner"),
    ("GRANT SET ON PARAMETER session_replication_role TO service_role;", "replication"),
])
def test_postconditions_fail_closed_and_rollback(before356, setup, marker):
    db, _, _ = before356
    try:
        run(db, setup, role=None)
        before = snapshot(db)
        with pytest.raises(RuntimeError, match=f"class_action_log_356_.*{marker}"):
            run(db, migration())
        assert snapshot(db) == before
    finally:
        run(db, "REVOKE client_invariant_runner FROM service_role; "
                "REVOKE act334_runner FROM service_role; "
                "REVOKE SET ON PARAMETER session_replication_role FROM service_role;", role=None)


def test_owner_truncate_negative_control(applied):
    db, _, row = applied
    assert_denied(db, f"TRUNCATE {TABLE}", "P0001")
    # Removing only the new trigger must break the SAME refusal assertion.
    with pytest.raises(pytest.fail.Exception, match="DID NOT RAISE"):
        with pytest.raises(RuntimeError, match="SQLSTATE=P0001"):
            attempt(db, f"TRUNCATE {TABLE}", prefix=f"SET LOCAL ROLE {OWNER}; "
                    f"DROP TRIGGER trg_class_action_log_no_truncate ON {TABLE};")
    assert sql(db, f"SELECT id FROM {TABLE}") == row


def test_up_is_held_no_policy_ddl_or_grants():
    code = invariant.m320._strip_sql_comments(migration())
    assert not re.search(r"\bGRANT\b|(?:CREATE|DROP|ALTER|COMMENT ON)\s+POLICY", code, re.I)
    assert "SET LOCAL lock_timeout = '5s'" in code
    assert "SET LOCAL search_path = pg_catalog, pg_temp;" in code
    assert f"{NAME}\tpending_feature\tclass_action_log_append_only\t" in (MIGRATIONS / "forward-policy.tsv").read_text()
